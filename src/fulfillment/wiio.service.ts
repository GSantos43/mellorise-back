import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import Stripe from 'stripe';

type WooCommerceOrderAddress = {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
};

type WooCommerceOrderLineItem = {
  id?: number;
  name?: string;
  product_id?: number;
  variation_id?: number;
  quantity?: number;
  total?: string;
  sku?: string;
  meta_data?: Array<{
    key?: string;
    value?: unknown;
  }>;
};

export type WooCommerceFulfillmentOrder = {
  id: number;
  number?: string;
  status?: string;
  currency?: string;
  total?: string;
  billing?: WooCommerceOrderAddress;
  shipping?: WooCommerceOrderAddress;
  line_items?: WooCommerceOrderLineItem[];
  shipping_lines?: Array<{
    method_id?: string;
    method_title?: string;
    total?: string;
  }>;
  coupon_lines?: Array<{
    code?: string;
  }>;
  meta_data?: Array<{
    key?: string;
    value?: unknown;
  }>;
};

export type WiioDispatchStatus =
  | 'disabled'
  | 'queued_in_woocommerce'
  | 'missing_endpoint'
  | 'sent'
  | 'failed';

@Injectable()
export class WiioService {
  private readonly logger = new Logger(WiioService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async dispatchPaidOrder(
    order: WooCommerceFulfillmentOrder,
    session: Stripe.Checkout.Session,
  ): Promise<WiioDispatchStatus> {
    if (this.configService.get<string>('WIIO_FULFILLMENT_ENABLED') !== 'true') {
      return 'disabled';
    }

    const mode = this.getSyncMode();
    const endpoint = this.configService.get<string>('WIIO_API_URL')?.trim();

    if (!endpoint) {
      this.logger.log(
        `WooCommerce order ${order.id} is paid and ready for Wiio sync through the connected WooCommerce store.`,
      );
      return mode === 'direct_api' ? 'missing_endpoint' : 'queued_in_woocommerce';
    }

    const payload = this.buildPayload(order, session);
    const headers = this.buildHeaders(String(payload.idempotencyKey));

    try {
      await firstValueFrom(
        this.httpService.post(endpoint, payload, {
          headers,
          timeout: this.getTimeoutMs(),
        }),
      );
      this.logger.log(`Dispatched WooCommerce order ${order.id} to Wiio.`);
      return 'sent';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Could not dispatch WooCommerce order ${order.id} to Wiio: ${message}`,
      );
      return 'failed';
    }
  }

  private buildHeaders(idempotencyKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    };
    const apiKey = this.configService.get<string>('WIIO_API_KEY')?.trim();
    const authHeader = this.configService.get<string>('WIIO_AUTH_HEADER')?.trim();
    const authScheme =
      this.configService.get<string>('WIIO_AUTH_SCHEME')?.trim() || 'Bearer';

    if (apiKey) {
      headers[authHeader || 'Authorization'] = authHeader
        ? apiKey
        : `${authScheme} ${apiKey}`;
    }

    return headers;
  }

  private buildPayload(
    order: WooCommerceFulfillmentOrder,
    session: Stripe.Checkout.Session,
  ) {
    const billing = order.billing ?? {};
    const shipping = order.shipping ?? {};
    const stripeShipping = session.shipping_details?.address;
    const stripeBilling = session.customer_details?.address;
    const shippingName = this.splitName(session.shipping_details?.name);
    const billingName = this.splitName(session.customer_details?.name);
    const customerEmail =
      session.customer_details?.email || billing.email || undefined;
    const customerPhone =
      session.customer_details?.phone || shipping.phone || billing.phone || undefined;
    const orderNumber = order.number ?? String(order.id);

    return {
      source: 'mellorise-headless-woocommerce',
      idempotencyKey: `mellorise-woo-${order.id}`,
      order: {
        id: order.id,
        number: orderNumber,
        status: order.status,
        currency: order.currency,
        total: order.total,
        paymentStatus: 'paid',
        paymentProvider: 'stripe',
        stripeSessionId: session.id,
        stripePaymentIntent:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id,
      },
      customer: {
        email: customerEmail,
        phone: customerPhone,
        name:
          session.customer_details?.name ||
          [billing.first_name, billing.last_name].filter(Boolean).join(' ') ||
          undefined,
      },
      shippingAddress: {
        firstName: shipping.first_name || shippingName.firstName,
        lastName: shipping.last_name || shippingName.lastName,
        company: shipping.company,
        address1: shipping.address_1 || stripeShipping?.line1 || undefined,
        address2: shipping.address_2 || stripeShipping?.line2 || undefined,
        city: shipping.city || stripeShipping?.city || undefined,
        state: shipping.state || stripeShipping?.state || undefined,
        postcode: shipping.postcode || stripeShipping?.postal_code || undefined,
        country: shipping.country || stripeShipping?.country || undefined,
        phone: customerPhone,
      },
      billingAddress: {
        firstName: billing.first_name || billingName.firstName,
        lastName: billing.last_name || billingName.lastName,
        company: billing.company,
        address1: billing.address_1 || stripeBilling?.line1 || undefined,
        address2: billing.address_2 || stripeBilling?.line2 || undefined,
        city: billing.city || stripeBilling?.city || undefined,
        state: billing.state || stripeBilling?.state || undefined,
        postcode: billing.postcode || stripeBilling?.postal_code || undefined,
        country: billing.country || stripeBilling?.country || undefined,
        email: customerEmail,
        phone: customerPhone,
      },
      items: (order.line_items ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        productId: item.product_id,
        variationId: item.variation_id || undefined,
        sku: item.sku,
        quantity: item.quantity,
        total: item.total,
        fulfillmentType: this.getLineItemMeta(item, '_headless_line_type'),
        promotionCode: this.getLineItemMeta(item, '_headless_bundle_promotion'),
        wiioSku:
          this.getLineItemMeta(item, '_wiio_sku') ||
          this.getLineItemMeta(item, 'wiio_sku') ||
          item.sku,
      })),
      shipping: (order.shipping_lines ?? []).map((line) => ({
        methodId: line.method_id,
        methodTitle: line.method_title,
        total: line.total,
      })),
      coupons: (order.coupon_lines ?? []).map((coupon) => coupon.code).filter(Boolean),
      metadata: {
        headlessCheckout: this.getOrderMeta(order, '_headless_checkout'),
        promotionCode: this.getOrderMeta(order, '_headless_bundle_promotion'),
        paidQuantity: this.getOrderMeta(order, '_headless_paid_quantity'),
        freeQuantity: this.getOrderMeta(order, '_headless_free_quantity'),
        deliveredQuantity: this.getOrderMeta(order, '_headless_delivered_quantity'),
        trackOrderWebhook: this.getTrackingWebhookUrl(),
      },
    };
  }

  private getSyncMode(): 'woocommerce' | 'direct_api' {
    const mode = this.configService.get<string>('WIIO_SYNC_MODE')?.trim();
    return mode === 'direct_api' ? 'direct_api' : 'woocommerce';
  }

  private getTimeoutMs(): number {
    const timeout = Number(this.configService.get('WIIO_TIMEOUT_MS') ?? 10000);
    return Number.isFinite(timeout) && timeout > 0 ? timeout : 10000;
  }

  private getTrackingWebhookUrl(): string | undefined {
    const publicUrl = this.configService.get<string>('BFF_PUBLIC_URL')?.trim();
    if (!publicUrl) return undefined;

    return new URL('/tracking/wiio', publicUrl).toString();
  }

  private splitName(name?: string | null): { firstName?: string; lastName?: string } {
    if (!name?.trim()) return {};
    const parts = name.trim().split(/\s+/);
    return {
      firstName: parts.shift(),
      lastName: parts.join(' ') || undefined,
    };
  }

  private getOrderMeta(
    order: WooCommerceFulfillmentOrder,
    key: string,
  ): unknown {
    return order.meta_data?.find((item) => item.key === key)?.value;
  }

  private getLineItemMeta(
    item: WooCommerceOrderLineItem,
    key: string,
  ): unknown {
    return item.meta_data?.find((meta) => meta.key === key)?.value;
  }
}
