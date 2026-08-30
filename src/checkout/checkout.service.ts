import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { WooCommerceClient } from '../woocommerce/woocommerce.client';
import { StripeService } from '../payments/stripe.service';
import { DiscountsService } from '../discounts/discounts.service';
import {
  CheckoutAddressDto,
  CheckoutCartItemDto,
  CheckoutPromotionDto,
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
  billing?: {
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
  shipping?: {
    first_name?: string;
    last_name?: string;
    company?: string;
    address_1?: string;
    address_2?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
    phone?: string;
  };
  coupon_lines?: Array<{
    code: string;
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
  billing?: WooCommerceOrderPayload['billing'];
  shipping?: WooCommerceOrderPayload['shipping'];
  fee_lines?: Array<{
    name: string;
    total: string;
    tax_status?: string;
  }>;
  shipping_lines?: Array<{
    method_id: string;
    method_title: string;
    total: string;
  }>;
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

type CheckoutShippingDecision = {
  isFree: boolean;
  displayName: string;
  amount: number;
  currency: string;
  minDeliveryDays?: number;
  maxDeliveryDays?: number;
  freeVariationIds: number[];
};

type ShippingProtectionDecision = {
  enabled: boolean;
  displayName: string;
  amount: number;
  currency: string;
};

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly wooCommerceClient: WooCommerceClient,
    private readonly stripeService: StripeService,
    private readonly configService: ConfigService,
    private readonly discountsService: DiscountsService,
  ) {}

  async createCheckoutSession(
    createCheckoutDto: CreateCheckoutDto,
  ): Promise<CheckoutResponseDto> {
    this.validateCart(createCheckoutDto.cart);
    const coupon = createCheckoutDto.couponCode
      ? await this.discountsService.validateWelcomeCoupon(
          createCheckoutDto.couponCode,
          createCheckoutDto.customerEmail,
        )
      : null;

    const order = await this.createPendingWooCommerceOrder(createCheckoutDto);
    let lineItems = await this.buildStripeLineItems(
      createCheckoutDto.cart,
      order.currency,
    );
    const shipping = this.getShippingDecision(createCheckoutDto.cart, order.currency);

    if (coupon) {
      lineItems = this.applyPercentDiscount(lineItems, Number(coupon.amount));
    }

    const shippingProtection = this.getShippingProtectionDecision(
      Boolean(createCheckoutDto.shippingProtection?.enabled),
      order.currency,
    );
    if (shippingProtection.enabled) {
      lineItems.push({
        name: shippingProtection.displayName,
        unitAmount: shippingProtection.amount,
        currency: shippingProtection.currency,
        quantity: 1,
      });
    }

    try {
      const session = await this.stripeService.createCheckoutSession({
        orderId: order.id,
        lineItems,
        shipping,
        successUrl: createCheckoutDto.successUrl,
        cancelUrl: createCheckoutDto.cancelUrl,
        customerEmail:
          createCheckoutDto.customerEmail || createCheckoutDto.customer?.email,
        metadata: {
          wooCommerceOrderId: String(order.id),
          shippingMethod: shipping.displayName,
          shippingAmount: String(shipping.amount),
          freeShipping: String(shipping.isFree),
          shippingProtection: String(shippingProtection.enabled),
          shippingProtectionAmount: String(shippingProtection.amount),
          couponCode: coupon?.code ?? '',
          promotionCode: createCheckoutDto.promotion?.code ?? '',
          promotionFreeQuantity: String(
            createCheckoutDto.promotion?.freeQuantity ?? 0,
          ),
          promotionDeliveredQuantity: String(
            createCheckoutDto.promotion?.deliveredQuantity ?? 0,
          ),
          customerPhone: createCheckoutDto.customer?.phone ?? '',
          shippingPostcode: createCheckoutDto.shippingAddress?.postcode ?? '',
          shippingState: createCheckoutDto.shippingAddress?.state ?? '',
        },
      });

      await this.wooCommerceClient.put<
        WooCommerceOrder,
        WooCommerceOrderUpdatePayload
      >(`/orders/${order.id}`, {
        fee_lines: shippingProtection.enabled
          ? [
              {
                name: shippingProtection.displayName,
                total: this.toCurrencyUnitAmount(
                  shippingProtection.amount,
                  order.currency,
                ),
                tax_status: 'none',
              },
            ]
          : undefined,
        shipping_lines: [
          {
            method_id: shipping.isFree
              ? 'headless_free_shipping'
              : 'headless_standard_shipping',
            method_title: shipping.displayName,
            total: this.toCurrencyUnitAmount(shipping.amount, order.currency),
          },
        ],
        meta_data: [
          {
            key: 'stripe_checkout_session_id',
            value: session.id,
          },
          {
            key: '_headless_shipping_method',
            value: shipping.displayName,
          },
          {
            key: '_headless_shipping_amount',
            value: String(shipping.amount / 100),
          },
          {
            key: '_headless_free_shipping',
            value: String(shipping.isFree),
          },
          {
            key: '_headless_shipping_protection',
            value: String(shippingProtection.enabled),
          },
          {
            key: '_headless_shipping_protection_amount',
            value: this.toCurrencyUnitAmount(
              shippingProtection.amount,
              order.currency,
            ),
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
          {
            key: '_headless_shipping_pending',
            value: 'true',
          },
          ...(createCheckoutDto.couponCode
            ? [
                {
                  key: '_headless_coupon_code',
                  value: createCheckoutDto.couponCode.trim().toUpperCase(),
                },
              ]
            : []),
          ...this.toWooCommercePromotionMeta(createCheckoutDto.promotion),
        ],
        billing: this.toWooCommerceBillingAddress(createCheckoutDto),
        shipping: this.toWooCommerceShippingAddress(
          createCheckoutDto.shippingAddress,
        ),
        coupon_lines: createCheckoutDto.couponCode
          ? [
              {
                code: createCheckoutDto.couponCode.trim().toUpperCase(),
              },
            ]
          : undefined,
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

    const stripeAddressUpdate = this.toWooCommerceAddressUpdateFromStripe(session);

    await this.wooCommerceClient.put<WooCommerceOrder, WooCommerceOrderUpdatePayload>(
      `/orders/${orderId}`,
      {
        status: 'processing',
        set_paid: true,
        transaction_id:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id,
        ...stripeAddressUpdate,
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

  private toWooCommercePromotionMeta(promotion?: CheckoutPromotionDto) {
    if (
      !promotion ||
      promotion.paidQuantity < 1 ||
      promotion.freeQuantity < 1 ||
      promotion.deliveredQuantity < promotion.paidQuantity
    ) {
      return [];
    }

    return [
      {
        key: '_headless_bundle_promotion',
        value: promotion.code || promotion.label || 'bundle_promotion',
      },
      {
        key: '_headless_bundle_promotion_label',
        value: promotion.label || promotion.code || 'Bundle promotion',
      },
      {
        key: '_headless_paid_quantity',
        value: String(promotion.paidQuantity),
      },
      {
        key: '_headless_free_quantity',
        value: String(promotion.freeQuantity),
      },
      {
        key: '_headless_delivered_quantity',
        value: String(promotion.deliveredQuantity),
      },
      {
        key: '_headless_fulfillment_note',
        value: `Ship ${promotion.deliveredQuantity} bottles: ${promotion.paidQuantity} paid + ${promotion.freeQuantity} free.`,
      },
    ];
  }

  private getShippingDecision(
    cart: CheckoutCartItemDto[],
    currency: string,
  ): CheckoutShippingDecision {
    const freeVariationIds = this.getNumberListConfig(
      'FREE_SHIPPING_VARIATION_IDS',
    );
    const hasFreeShipping =
      freeVariationIds.length > 0 &&
      cart.every(
        (item) => item.variationId && freeVariationIds.includes(item.variationId),
      );
    const amount = hasFreeShipping
      ? 0
      : Number(this.configService.get('STRIPE_SHIPPING_RATE_AMOUNT') ?? 999);
    const displayName = hasFreeShipping
      ? this.configService.get<string>('STRIPE_FREE_SHIPPING_RATE_NAME') ??
        'Free shipping'
      : this.configService.get<string>('STRIPE_SHIPPING_RATE_NAME') ??
        'Standard shipping';

    return {
      isFree: hasFreeShipping,
      displayName,
      amount,
      currency,
      minDeliveryDays: this.getOptionalNumberConfig(
        'STRIPE_SHIPPING_MIN_DELIVERY_DAYS',
      ),
      maxDeliveryDays: this.getOptionalNumberConfig(
        'STRIPE_SHIPPING_MAX_DELIVERY_DAYS',
      ),
      freeVariationIds,
    };
  }

  private getShippingProtectionDecision(
    requested: boolean,
    currency: string,
  ): ShippingProtectionDecision {
    const amount = Number(
      this.configService.get('STRIPE_SHIPPING_PROTECTION_AMOUNT') ?? 350,
    );

    return {
      enabled: requested && Number.isFinite(amount) && amount > 0,
      displayName:
        this.configService.get<string>('STRIPE_SHIPPING_PROTECTION_NAME') ??
        'Shipping protection',
      amount,
      currency,
    };
  }

  private getNumberListConfig(key: string): number[] {
    return (
      this.configService
        .get<string>(key)
        ?.split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0) ?? []
    );
  }

  private getOptionalNumberConfig(key: string): number | undefined {
    const value = Number(this.configService.get(key));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  private toWooCommerceBillingAddress(createCheckoutDto: CreateCheckoutDto) {
    const address = createCheckoutDto.billingAddress;
    const customer = createCheckoutDto.customer;
    const email =
      createCheckoutDto.customerEmail || address?.email || customer?.email;

    if (!address && !email && !customer?.phone) return undefined;

    return {
      ...this.toWooCommerceAddress(address),
      first_name: address?.firstName || customer?.firstName,
      last_name: address?.lastName || customer?.lastName,
      email,
      phone: address?.phone || customer?.phone,
    };
  }

  private toWooCommerceShippingAddress(address?: CheckoutAddressDto) {
    if (!address) return undefined;

    return {
      ...this.toWooCommerceAddress(address),
      phone: address.phone,
    };
  }

  private toWooCommerceAddress(address?: CheckoutAddressDto) {
    if (!address) return {};

    return {
      first_name: address.firstName,
      last_name: address.lastName,
      company: address.company,
      address_1: address.address1,
      address_2: address.address2,
      city: address.city,
      state: address.state,
      postcode: address.postcode,
      country: address.country,
    };
  }

  private toWooCommerceAddressUpdateFromStripe(
    session: Stripe.Checkout.Session,
  ): Partial<WooCommerceOrderPayload> {
    const customerDetails = session.customer_details;
    const shippingDetails = session.shipping_details;
    const billingAddress = customerDetails?.address;
    const shippingAddress = shippingDetails?.address;
    const billingName = this.splitName(customerDetails?.name);
    const shippingName = this.splitName(shippingDetails?.name);

    return {
      billing: billingAddress
        ? {
            first_name: billingName.firstName,
            last_name: billingName.lastName,
            address_1: billingAddress.line1 ?? undefined,
            address_2: billingAddress.line2 ?? undefined,
            city: billingAddress.city ?? undefined,
            state: billingAddress.state ?? undefined,
            postcode: billingAddress.postal_code ?? undefined,
            country: billingAddress.country ?? undefined,
            email: customerDetails?.email ?? undefined,
            phone: customerDetails?.phone ?? undefined,
          }
        : undefined,
      shipping: shippingAddress
        ? {
            first_name: shippingName.firstName,
            last_name: shippingName.lastName,
            address_1: shippingAddress.line1 ?? undefined,
            address_2: shippingAddress.line2 ?? undefined,
            city: shippingAddress.city ?? undefined,
            state: shippingAddress.state ?? undefined,
            postcode: shippingAddress.postal_code ?? undefined,
            country: shippingAddress.country ?? undefined,
            phone: customerDetails?.phone ?? undefined,
          }
        : undefined,
    };
  }

  private splitName(name?: string | null): { firstName?: string; lastName?: string } {
    if (!name?.trim()) return {};
    const parts = name.trim().split(/\s+/);
    return {
      firstName: parts.shift(),
      lastName: parts.join(' ') || undefined,
    };
  }

  private applyPercentDiscount(
    lineItems: CheckoutLineItem[],
    percent: number,
  ): CheckoutLineItem[] {
    if (!Number.isFinite(percent) || percent <= 0) return lineItems;

    const multiplier = Math.max(0, 1 - percent / 100);

    return lineItems.map((item) => ({
      ...item,
      unitAmount: Math.max(1, Math.round(item.unitAmount * multiplier)),
    }));
  }

  private toMinorUnitAmount(total: string, currency: string): number {
    const numericTotal = Number(total);
    const multiplier = this.isZeroDecimalCurrency(currency) ? 1 : 100;
    const amount = Math.round(numericTotal * multiplier);

    if (!Number.isFinite(amount) || amount < 1) {
      this.logger.warn(`Invalid WooCommerce product total: ${total} ${currency}`);
      throw new BadRequestException('Invalid checkout total');
    }

    return amount;
  }

  private toCurrencyUnitAmount(amount: number, currency: string): string {
    const divisor = this.isZeroDecimalCurrency(currency) ? 1 : 100;
    return (amount / divisor).toFixed(divisor === 1 ? 0 : 2);
  }

  private isZeroDecimalCurrency(currency: string): boolean {
    return new Set([
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
    ]).has(currency.toUpperCase());
  }
}
