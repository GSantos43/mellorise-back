import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { WooCommerceClient } from '../woocommerce/woocommerce.client';
import { LookupTrackingDto } from './dto/lookup-tracking.dto';
import { WiioTrackingWebhookDto } from './dto/wiio-tracking-webhook.dto';

type WooCommerceOrder = {
  id: number;
  number?: string;
  status?: string;
  currency?: string;
  total?: string;
  date_created?: string;
  date_modified?: string;
  billing?: {
    email?: string;
    first_name?: string;
    last_name?: string;
  };
  shipping?: {
    first_name?: string;
    last_name?: string;
  };
  line_items?: Array<{
    name?: string;
    quantity?: number;
  }>;
  meta_data?: Array<{
    key?: string;
    value?: unknown;
  }>;
};

type TrackingDetails = {
  code: string;
  carrier: string | null;
  url: string | null;
  status: string | null;
  shippedAt: string | null;
  updatedAt: string | null;
};

type NormalizedWiioTrackingPayload = {
  orderId?: number;
  orderNumber?: string;
  trackingCode: string;
  carrier?: string;
  trackingUrl?: string;
  status?: string;
  shippedAt?: string;
};

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly wooCommerceClient: WooCommerceClient,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  async lookup(dto: LookupTrackingDto) {
    const order = await this.findOrder(dto.identifier);

    if (!this.emailMatchesOrder(dto.email, order)) {
      throw new NotFoundException('Order was not found for this email.');
    }

    const tracking = this.getTrackingDetails(order);

    return {
      found: true,
      orderId: order.id,
      orderNumber: order.number ?? String(order.id),
      status: order.status ?? 'pending',
      statusLabel: this.toStatusLabel(order.status),
      placedAt: order.date_created ?? null,
      updatedAt: order.date_modified ?? null,
      customerEmail: this.maskEmail(order.billing?.email ?? dto.email),
      tracking,
      items: (order.line_items ?? []).map((item) => ({
        name: item.name ?? 'MelloRise Gummies',
        quantity: item.quantity ?? 1,
      })),
      message: tracking
        ? 'Tracking is available.'
        : 'Your order is confirmed. Tracking will appear here after fulfillment ships it.',
    };
  }

  async receiveWiioTracking(
    dto: WiioTrackingWebhookDto,
    webhookSecret?: string,
  ): Promise<{ received: true; orderId: number; emailQueued: boolean }> {
    this.validateWebhookSecret(webhookSecret);

    const payload = this.normalizeWiioPayload(dto);
    const order = await this.findOrderByWebhookPayload(payload);
    const updatedOrder = await this.wooCommerceClient.put<
      WooCommerceOrder,
      { meta_data: Array<{ key: string; value: string }> }
    >(`/orders/${order.id}`, {
      meta_data: this.toTrackingMeta(payload),
    });

    const emailQueued = await this.mailService.sendOrderTracking({
      to: updatedOrder.billing?.email || order.billing?.email || '',
      orderNumber: updatedOrder.number ?? order.number ?? String(order.id),
      trackingCode: payload.trackingCode,
      trackingUrl: payload.trackingUrl,
      carrier: payload.carrier,
      trackOrderUrl: this.buildTrackOrderUrl(updatedOrder.number ?? order.number ?? String(order.id)),
    });

    return {
      received: true,
      orderId: order.id,
      emailQueued,
    };
  }

  private async findOrder(identifier: string): Promise<WooCommerceOrder> {
    const normalizedIdentifier = identifier.trim();

    if (!normalizedIdentifier) {
      throw new BadRequestException('Order number or tracking code is required.');
    }

    if (/^\d+$/.test(normalizedIdentifier)) {
      try {
        return await this.wooCommerceClient.get<WooCommerceOrder>(
          `/orders/${Number(normalizedIdentifier)}`,
        );
      } catch (error) {
        this.logger.warn(
          `Could not load WooCommerce order by id ${normalizedIdentifier}; trying order search.`,
        );
      }
    }

    const orders = [
      ...(await this.searchOrdersByText(normalizedIdentifier)),
      ...(await this.searchOrdersByTrackingCode(normalizedIdentifier)),
    ];

    const order = orders.find((item) => this.identifierMatchesOrder(normalizedIdentifier, item));

    if (!order) {
      throw new NotFoundException('Order was not found.');
    }

    return order;
  }

  private async searchOrdersByText(identifier: string): Promise<WooCommerceOrder[]> {
    return this.wooCommerceClient.get<WooCommerceOrder[]>('/orders', {
      params: {
        search: identifier,
        per_page: 20,
        orderby: 'date',
        order: 'desc',
      },
    });
  }

  private async searchOrdersByTrackingCode(
    identifier: string,
  ): Promise<WooCommerceOrder[]> {
    try {
      return await this.wooCommerceClient.get<WooCommerceOrder[]>('/orders', {
        params: {
          meta_key: '_wiio_tracking_code',
          meta_value: identifier,
          per_page: 20,
        },
      });
    } catch (error) {
      this.logger.warn('WooCommerce did not accept tracking meta lookup.');
      return [];
    }
  }

  private async findOrderByWebhookPayload(
    dto: NormalizedWiioTrackingPayload,
  ): Promise<WooCommerceOrder> {
    if (dto.orderId) {
      return this.wooCommerceClient.get<WooCommerceOrder>(`/orders/${dto.orderId}`);
    }

    if (dto.orderNumber) {
      return this.findOrder(dto.orderNumber);
    }

    throw new BadRequestException('Wiio payload must include orderId or orderNumber.');
  }

  private identifierMatchesOrder(identifier: string, order: WooCommerceOrder): boolean {
    const normalized = identifier.toLowerCase();
    const values = [
      String(order.id),
      order.number,
      this.getOrderMeta(order, '_wiio_tracking_code'),
      this.getOrderMeta(order, '_headless_tracking_code'),
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    return values.includes(normalized);
  }

  private emailMatchesOrder(email: string, order: WooCommerceOrder): boolean {
    const customerEmail = order.billing?.email?.trim().toLowerCase();
    return Boolean(customerEmail && customerEmail === email.trim().toLowerCase());
  }

  private getTrackingDetails(order: WooCommerceOrder): TrackingDetails | null {
    const code =
      this.getOrderMeta(order, '_wiio_tracking_code') ||
      this.getOrderMeta(order, '_headless_tracking_code');

    if (!code) return null;

    return {
      code: String(code),
      carrier: this.toNullableString(this.getOrderMeta(order, '_wiio_carrier')),
      url: this.toNullableString(this.getOrderMeta(order, '_wiio_tracking_url')),
      status: this.toNullableString(this.getOrderMeta(order, '_wiio_tracking_status')),
      shippedAt: this.toNullableString(this.getOrderMeta(order, '_wiio_shipped_at')),
      updatedAt: this.toNullableString(this.getOrderMeta(order, '_wiio_tracking_updated_at')),
    };
  }

  private toTrackingMeta(dto: NormalizedWiioTrackingPayload) {
    return [
      {
        key: '_wiio_tracking_code',
        value: dto.trackingCode.trim(),
      },
      {
        key: '_wiio_tracking_url',
        value: dto.trackingUrl?.trim() ?? '',
      },
      {
        key: '_wiio_carrier',
        value: dto.carrier?.trim() ?? 'Wiio',
      },
      {
        key: '_wiio_tracking_status',
        value: dto.status?.trim() ?? 'shipped',
      },
      {
        key: '_wiio_shipped_at',
        value: dto.shippedAt?.trim() ?? new Date().toISOString(),
      },
      {
        key: '_wiio_tracking_updated_at',
        value: new Date().toISOString(),
      },
    ];
  }

  private normalizeWiioPayload(
    dto: WiioTrackingWebhookDto,
  ): NormalizedWiioTrackingPayload {
    const trackingCode = this.firstString(
      dto.trackingCode,
      dto.tracking_code,
      dto.trackingNumber,
      dto.tracking_number,
      dto.trackNumber,
    );

    if (!trackingCode) {
      throw new BadRequestException('Wiio payload must include a tracking code.');
    }

    return {
      orderId: this.firstPositiveNumber(dto.orderId, dto.order_id, dto.wooOrderId),
      orderNumber: this.firstString(dto.orderNumber, dto.order_number, dto.orderNo),
      trackingCode,
      carrier: this.firstString(dto.carrier, dto.logisticName) || 'Wiio',
      trackingUrl: this.firstString(dto.trackingUrl, dto.tracking_url, dto.trackUrl),
      status: this.firstString(dto.status, dto.orderStatus) || 'shipped',
      shippedAt: this.firstString(dto.shippedAt, dto.shipped_at),
    };
  }

  private firstString(...values: Array<string | undefined>): string | undefined {
    return values.map((value) => value?.trim()).find(Boolean);
  }

  private firstPositiveNumber(...values: Array<number | undefined>): number | undefined {
    return values.find((value) => Number.isInteger(value) && Number(value) > 0);
  }

  private validateWebhookSecret(webhookSecret?: string): void {
    const expectedSecret = this.configService.get<string>('WIIO_WEBHOOK_SECRET')?.trim();

    if (!expectedSecret) {
      throw new UnauthorizedException('Wiio tracking webhook is not configured.');
    }

    if (!webhookSecret || webhookSecret !== expectedSecret) {
      throw new UnauthorizedException('Invalid Wiio webhook secret.');
    }
  }

  private buildTrackOrderUrl(orderNumber: string): string {
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ||
      this.configService.get<string>('FRONTEND_ORIGIN')?.split(',')[0] ||
      'https://mellorise-front.vercel.app';

    const url = new URL('/track-order', frontendUrl.trim());
    url.searchParams.set('order', orderNumber);
    return url.toString();
  }

  private getOrderMeta(order: WooCommerceOrder, key: string): unknown {
    return order.meta_data?.find((item) => item.key === key)?.value;
  }

  private toNullableString(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    return String(value);
  }

  private toStatusLabel(status?: string): string {
    const labels: Record<string, string> = {
      pending: 'Payment pending',
      processing: 'Awaiting shipment',
      'on-hold': 'Waiting for confirmation',
      completed: 'Delivered',
      cancelled: 'Cancelled',
      refunded: 'Refunded',
      failed: 'Payment failed',
    };

    return labels[status ?? ''] ?? 'Order received';
  }

  private maskEmail(email: string): string {
    const [name, domain] = email.split('@');
    if (!name || !domain) return email;

    return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
  }
}
