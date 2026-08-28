import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { WooCommerceClient } from '../woocommerce/woocommerce.client';
import { StripeService } from '../payments/stripe.service';
import {
  CheckoutCartItemDto,
  CreateCheckoutDto,
} from './dto/create-checkout.dto';
import { CheckoutResponseDto } from './dto/checkout-response.dto';

type WooCommerceOrder = {
  id: number;
  status: string;
  total: string;
  currency: string;
  payment_url?: string;
};

type WooCommerceProduct = {
  id: number;
  name: string;
  price: string;
  images?: Array<{
    src?: string;
  }>;
};

type WooCommerceVariation = {
  id: number;
  price: string;
  image?: {
    src?: string;
  };
};

type WooCommerceOrderPayload = {
  payment_method: string;
  payment_method_title: string;
  set_paid: boolean;
  customer_note?: string;
  line_items: Array<{
    product_id: number;
    variation_id?: number;
    quantity: number;
  }>;
  meta_data: Array<{
    key: string;
    value: string;
  }>;
};

type WooCommerceOrderUpdatePayload = {
  status?: string;
  set_paid?: boolean;
  transaction_id?: string;
  meta_data?: Array<{
    key: string;
    value: string;
  }>;
};

type CheckoutLineItem = {
  name: string;
  unitAmount: number;
  currency: string;
  quantity: number;
  image?: string | null;
};

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly wooCommerceClient: WooCommerceClient,
    private readonly stripeService: StripeService,
  ) {}

  async createCheckoutSession(
    createCheckoutDto: CreateCheckoutDto,
  ): Promise<CheckoutResponseDto> {
    this.validateCart(createCheckoutDto.cart);

    const order = await this.createPendingWooCommerceOrder(createCheckoutDto);
    const lineItems = await this.buildStripeLineItems(
      createCheckoutDto.cart,
      order.currency,
    );

    try {
      const session = await this.stripeService.createCheckoutSession({
        orderId: order.id,
        lineItems,
        successUrl: createCheckoutDto.successUrl,
        cancelUrl: createCheckoutDto.cancelUrl,
        customerEmail: createCheckoutDto.customerEmail,
        metadata: {
          wooCommerceOrderId: String(order.id),
        },
      });

      await this.wooCommerceClient.put<
        WooCommerceOrder,
        WooCommerceOrderUpdatePayload
      >(`/orders/${order.id}`, {
        meta_data: [
          {
            key: 'stripe_checkout_session_id',
            value: session.id,
          },
        ],
      });

      return {
        orderId: order.id,
        status: order.status,
        total: order.total,
        currency: order.currency,
        checkoutUrl: session.url ?? '',
        sessionId: session.id,
        paymentUrl: order.payment_url ?? null,
      };
    } catch (error) {
      await this.markOrderAsFailed(order.id);
      throw error;
    }
  }

  async handleStripeWebhook(event: Stripe.Event): Promise<{ received: true }> {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      await this.markOrderAsPaid(session);
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = this.getOrderIdFromSession(session);

      if (orderId) {
        await this.markOrderAsFailed(orderId);
      }
    }

    return { received: true };
  }

  private async createPendingWooCommerceOrder(
    createCheckoutDto: CreateCheckoutDto,
  ): Promise<WooCommerceOrder> {
    return this.wooCommerceClient.post<WooCommerceOrder, WooCommerceOrderPayload>(
      '/orders',
      {
        payment_method: 'stripe',
        payment_method_title: 'Stripe',
        set_paid: false,
        customer_note: createCheckoutDto.customerNote,
        line_items: createCheckoutDto.cart.map((item) =>
          this.toWooCommerceLineItem(item),
        ),
        meta_data: [
          {
            key: '_headless_checkout',
            value: 'true',
          },
        ],
      },
    );
  }

  private async buildStripeLineItems(
    cart: CheckoutCartItemDto[],
    currency: string,
  ): Promise<CheckoutLineItem[]> {
    return Promise.all(
      cart.map(async (item) => {
        const product = await this.wooCommerceClient.get<WooCommerceProduct>(
          `/products/${item.productId}`,
        );
        const variation = item.variationId
          ? await this.wooCommerceClient.get<WooCommerceVariation>(
              `/products/${item.productId}/variations/${item.variationId}`,
            )
          : null;
        const price = variation?.price || product.price;
        const image = variation?.image?.src || product.images?.[0]?.src || null;

        return {
          name: product.name,
          unitAmount: this.toMinorUnitAmount(price, currency),
          currency,
          quantity: item.quantity,
          image,
        };
      }),
    );
  }

  private async markOrderAsPaid(session: Stripe.Checkout.Session): Promise<void> {
    const orderId = this.getOrderIdFromSession(session);

    if (!orderId) {
      this.logger.warn(`Stripe session ${session.id} has no WooCommerce order id`);
      return;
    }

    await this.wooCommerceClient.put<WooCommerceOrder, WooCommerceOrderUpdatePayload>(
      `/orders/${orderId}`,
      {
        status: 'processing',
        set_paid: true,
        transaction_id:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id,
        meta_data: [
          {
            key: 'stripe_checkout_session_id',
            value: session.id,
          },
        ],
      },
    );
  }

  private getOrderIdFromSession(session: Stripe.Checkout.Session): number | null {
    const rawOrderId =
      session.metadata?.wooCommerceOrderId || session.client_reference_id;
    const orderId = Number(rawOrderId);

    return Number.isInteger(orderId) && orderId > 0 ? orderId : null;
  }

  private async markOrderAsFailed(orderId: number): Promise<void> {
    try {
      await this.wooCommerceClient.put<
        WooCommerceOrder,
        WooCommerceOrderUpdatePayload
      >(`/orders/${orderId}`, {
        status: 'failed',
      });
    } catch (error) {
      this.logger.warn(
        `Could not mark WooCommerce order ${orderId} as failed after payment failure`,
      );
    }
  }

  private validateCart(cart: CheckoutCartItemDto[]): void {
    if (!cart?.length) {
      throw new BadRequestException('cart must have at least one item');
    }

    const hasInvalidItem = cart.some(
      (item) => !item.productId || item.quantity < 1,
    );

    if (hasInvalidItem) {
      throw new BadRequestException(
        'cart items must have productId and quantity greater than zero',
      );
    }
  }

  private toWooCommerceLineItem(item: CheckoutCartItemDto) {
    return {
      product_id: item.productId,
      variation_id: item.variationId,
      quantity: item.quantity,
    };
  }

  private toMinorUnitAmount(total: string, currency: string): number {
    const numericTotal = Number(total);
    const zeroDecimalCurrencies = new Set([
      'BIF',
      'CLP',
      'DJF',
      'GNF',
      'JPY',
      'KMF',
      'KRW',
      'MGA',
      'PYG',
      'RWF',
      'UGX',
      'VND',
      'VUV',
      'XAF',
      'XOF',
      'XPF',
    ]);
    const multiplier = zeroDecimalCurrencies.has(currency.toUpperCase())
      ? 1
      : 100;
    const amount = Math.round(numericTotal * multiplier);

    if (!Number.isFinite(amount) || amount < 1) {
      this.logger.warn(`Invalid WooCommerce product total: ${total} ${currency}`);
      throw new BadRequestException('Invalid checkout total');
    }

    return amount;
  }
}
