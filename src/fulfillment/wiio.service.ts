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
  ): Promise<'disabled' | 'missing_endpoint' | 'sent' | 'failed'> {
    if (this.configService.get<string>('WIIO_FULFILLMENT_ENABLED') !== 'true') {
      return 'disabled';
    }

    const endpoint = this.configService.get<string>('WIIO_API_URL')?.trim();

    if (!endpoint) {
      this.logger.warn(
        `WooCommerce order ${order.id} is paid and ready for Wiio sync, but WIIO_API_URL is not configured.`,
      );
      return 'missing_endpoint';
    }

    const headers = this.buildHeaders();
    const payload = this.buildPayload(order, session);

    try {
      await firstValueFrom(this.httpService.post(endpoint, payload, { headers }));
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

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = this.configService.get<string>('WIIO_API_KEY')?.trim();

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    return headers;
  }

  private buildPayload(
    order: WooCommerceFulfillmentOrder,
    session: Stripe.Checkout.Session,
  ) {
    const billing = order.billing ?? {};
    const shipping = order.shipping ?? {};
    const customerEmail =
      session.customer_details?.email || billing.email || undefined;
    const customerPhone =
      session.customer_details?.phone || shipping.phone || billing.phone || undefined;

    return {
      source: 'mellorise-headless-woocommerce',
      order: {
        id: order.id,
        number: order.number ?? String(order.id),
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
        firstName: shipping.first_name,
        lastName: shipping.last_name,
        company: shipping.company,
        address1: shipping.address_1,
        address2: shipping.address_2,
        city: shipping.city,
        state: shipping.state,
        postcode: shipping.postcode,
        country: shipping.country,
        phone: customerPhone,
      },
      billingAddress: {
        firstName: billing.first_name,
        lastName: billing.last_name,
        company: billing.company,
        address1: billing.address_1,
        address2: billing.address_2,
        city: billing.city,
        state: billing.state,
        postcode: billing.postcode,
        country: billing.country,
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
      },
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
