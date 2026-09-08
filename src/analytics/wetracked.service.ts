import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreateAnalyticsEventDto } from './dto/create-analytics-event.dto';

type WetrackedEventType = 'AddedToCart' | 'CheckoutInitiated' | 'CheckoutProcessed';

type AnalyticsForwardContext = {
  ip?: string;
  userAgent?: string;
};

type AnalyticsItem = {
  item_id?: unknown;
  item_name?: unknown;
  item_variant?: unknown;
  price?: unknown;
  quantity?: unknown;
};

@Injectable()
export class WetrackedService {
  private readonly logger = new Logger(WetrackedService.name);

  constructor(private readonly configService: ConfigService) {}

  forwardAnalyticsEvent(
    event: CreateAnalyticsEventDto,
    context: AnalyticsForwardContext = {},
  ): void {
    if (!this.isEnabled || !this.apiKey) return;

    const type = this.toWetrackedType(event);
    if (!type) return;

    void this.sendEvent(type, event, context).catch((error) => {
      this.logger.warn(
        `WeTracked event forward failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private async sendEvent(
    type: WetrackedEventType,
    event: CreateAnalyticsEventDto,
    context: AnalyticsForwardContext,
  ): Promise<void> {
    const body = this.buildBody(type, event, context);
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      await fetch(`${this.apiUrl}/record`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'x-site-domain': this.siteDomain,
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildBody(
    type: WetrackedEventType,
    event: CreateAnalyticsEventDto,
    context: AnalyticsForwardContext,
  ): Record<string, unknown> {
    const params = event.params || {};
    const total = Number(params.value ?? params.total ?? 0);
    const items = this.toWetrackedItems(params.items || params.cart);

    return {
      eventId: this.createEventId(event),
      timestamp: new Date().toISOString(),
      type,
      wtp: String(params.wtp || ''),
      visitor: {
        ip: context.ip || '',
        ua: context.userAgent || '',
      },
      details: {
        orderId: params.orderId || params.sessionId || params.stripeSessionId || '',
        total: Number.isFinite(total) ? total : 0,
        currency: String(params.currency || 'USD'),
        items,
        source: params.source || '',
        pageURL: event.pageLocation || params.page_location || '',
        occurrence: 'first',
        ud: this.toUserData(params),
      },
    };
  }

  private toWetrackedType(event: CreateAnalyticsEventDto): WetrackedEventType | '' {
    const name = event.name;
    const params = event.params || {};

    if (name === 'add_to_cart') return 'AddedToCart';
    if (
      name === 'begin_checkout' &&
      params.eventSource === 'checkout_session_request'
    ) {
      return 'CheckoutInitiated';
    }

    if (name === 'purchase' || name === 'stripe_checkout_completed') {
      return 'CheckoutProcessed';
    }

    return '';
  }

  private toWetrackedItems(items: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(items)) return [];

    return items.map((item) => {
      const analyticsItem = item as AnalyticsItem;
      const productId = (analyticsItem.item_id || (item as { productId?: unknown }).productId || '');
      const quantity = Number(analyticsItem.quantity || 1);
      const price = Number(analyticsItem.price || 0);

      return {
        id: String(productId),
        pid: String(productId),
        quantity: Number.isFinite(quantity) ? quantity : 1,
        title: String(analyticsItem.item_name || 'MelloRise Heightener Gummies'),
        price: Number.isFinite(price) ? price : 0,
        currency: 'USD',
        sku: String(analyticsItem.item_variant || ''),
      };
    });
  }

  private toUserData(params: Record<string, unknown>): Record<string, unknown> {
    const customerEmail = String(params.customerEmail || params.email || '').trim();

    return {
      em: customerEmail,
    };
  }

  private createEventId(event: CreateAnalyticsEventDto): string {
    return [
      event.name,
      event.sessionId || 'session',
      Date.now(),
      Math.random().toString(16).slice(2),
    ].join('-');
  }

  private get isEnabled(): boolean {
    return this.configService.get<string>('WETRACKED_ENABLED') === 'true';
  }

  private get apiKey(): string {
    return this.configService.get<string>('WETRACKED_API_KEY')?.trim() || '';
  }

  private get apiUrl(): string {
    return (
      this.configService.get<string>('WETRACKED_API_URL') ||
      'https://pixel.wetracked.io/woo'
    ).replace(/\/+$/, '');
  }

  private get siteDomain(): string {
    return (
      this.configService.get<string>('WETRACKED_SITE_DOMAIN') ||
      this.configService.get<string>('FRONTEND_URL') ||
      'https://mellorise.shop'
    ).replace(/\/+$/, '');
  }

  private get timeoutMs(): number {
    const timeout = Number(this.configService.get<string>('WETRACKED_TIMEOUT_MS') || 1500);

    return Number.isFinite(timeout) && timeout > 0 ? timeout : 1500;
  }
}
