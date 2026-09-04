import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { WooCommerceClient } from '../woocommerce/woocommerce.client';
import { StripeService } from '../payments/stripe.service';
import { DiscountsService } from '../discounts/discounts.service';
import { WiioDispatchStatus, WiioService } from '../fulfillment/wiio.service';
import { AnalyticsService } from '../analytics/analytics.service';
import {
  CheckoutAddressDto,
  CheckoutCartItemDto,
  CreateCheckoutDto,
} from './dto/create-checkout.dto';
import { CheckoutResponseDto } from './dto/checkout-response.dto';

type WooCommerceOrder = {
  id: number;
  number?: string;
  order_key?: string;
  status: string;
  total: string;
  currency: string;
  payment_url?: string;
  billing?: WooCommerceOrderPayload['billing'];
  shipping?: WooCommerceOrderPayload['shipping'];
  line_items?: Array<{
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
  }>;
  shipping_lines?: WooCommerceOrderUpdatePayload['shipping_lines'];
  coupon_lines?: WooCommerceOrderPayload['coupon_lines'];
  meta_data?: Array<{
    key?: string;
    value?: unknown;
  }>;
};

type WooCommerceProduct = {
  id: number;
  name: string;
  price: string;
  status?: string;
  purchasable?: boolean;
  stock_status?: string;
  stock_quantity?: number | null;
  manage_stock?: boolean;
  images?: Array<{
    src?: string;
  }>;
};

type WooCommerceVariation = {
  id: number;
  name?: string;
  title?: string;
  price: string;
  status?: string;
  purchasable?: boolean;
  stock_status?: string;
  stock_quantity?: number | null;
  manage_stock?: boolean;
  image?: {
    src?: string;
  };
};

type WooCommercePaymentGateway = {
  id: string;
  title?: string;
  enabled?: boolean;
};

type WooCommerceOrderPayload = {
  payment_method: string;
  payment_method_title: string;
  status?: string;
  set_paid: boolean;
  transaction_id?: string;
  customer_note?: string;
  line_items: Array<{
    product_id: number;
    variation_id?: number;
    quantity: number;
    subtotal?: string;
    total?: string;
    meta_data?: Array<{
      key: string;
      value: string;
    }>;
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

type CheckoutProvider = 'stripe' | 'woopayments';

type CheckoutBundlePromotion = {
  code: string;
  label: string;
  paidQuantity: number;
  freeQuantity: number;
  deliveredQuantity: number;
};

type ResolvedCheckoutCartItem = {
  productId: number;
  variationId?: number;
  quantity: number;
  name: string;
  price: string;
  image?: string | null;
  variationTitle?: string;
};

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly wooCommerceClient: WooCommerceClient,
    private readonly stripeService: StripeService,
    private readonly configService: ConfigService,
    private readonly discountsService: DiscountsService,
    private readonly wiioService: WiioService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  async createCheckoutSession(
    createCheckoutDto: CreateCheckoutDto,
  ): Promise<CheckoutResponseDto> {
    this.validateCart(createCheckoutDto.cart);
    const resolvedCart = await this.resolveCheckoutCart(createCheckoutDto.cart);
    const promotion = this.getBundlePromotion(
      createCheckoutDto.cart,
      resolvedCart,
    );
    const coupon = createCheckoutDto.couponCode
      ? await this.discountsService.validateWelcomeCoupon(
          createCheckoutDto.couponCode,
          createCheckoutDto.customerEmail,
        )
      : null;

    const currency = this.getCheckoutCurrency();
    let lineItems = await this.buildStripeLineItems(
      resolvedCart,
      currency,
    );
    const shipping = this.getShippingDecision(createCheckoutDto.cart, currency);

    if (coupon) {
      lineItems = this.applyPercentDiscount(lineItems, Number(coupon.amount));
    }

    const shippingProtection = this.getShippingProtectionDecision(
      Boolean(createCheckoutDto.shippingProtection?.enabled),
      currency,
    );
    if (shippingProtection.enabled) {
      lineItems.push({
        name: shippingProtection.displayName,
        unitAmount: shippingProtection.amount,
        currency: shippingProtection.currency,
        quantity: 1,
      });
    }

    if (this.getCheckoutProvider() === 'woopayments') {
      return this.createWooPaymentsCheckout(
        createCheckoutDto,
        promotion,
        shipping,
        shippingProtection,
        currency,
      );
    }

    try {
      const session = await this.stripeService.createCheckoutSession({
        lineItems,
        shipping,
        successUrl: createCheckoutDto.successUrl,
        cancelUrl: createCheckoutDto.cancelUrl,
        customerEmail:
          createCheckoutDto.customerEmail || createCheckoutDto.customer?.email,
        metadata: {
          checkoutCart: JSON.stringify(createCheckoutDto.cart),
          shippingMethod: shipping.displayName,
          shippingAmount: String(shipping.amount),
          freeShipping: String(shipping.isFree),
          shippingProtection: String(shippingProtection.enabled),
          shippingProtectionAmount: String(shippingProtection.amount),
          couponCode: coupon?.code ?? '',
          couponPercent: coupon?.amount ?? '',
          promotionCode: promotion?.code ?? '',
          promotionFreeQuantity: String(promotion?.freeQuantity ?? 0),
          promotionDeliveredQuantity: String(
            promotion?.deliveredQuantity ?? 0,
          ),
          customerPhone: createCheckoutDto.customer?.phone ?? '',
          shippingPostcode: createCheckoutDto.shippingAddress?.postcode ?? '',
          shippingState: createCheckoutDto.shippingAddress?.state ?? '',
        },
      });

      await this.analyticsService.recordSystemEvent('checkout_session_created', {
        provider: 'stripe',
        sessionId: session.id,
        customerEmail:
          createCheckoutDto.customerEmail || createCheckoutDto.customer?.email || '',
        currency,
        total: this.toCurrencyUnitAmount(
          this.sumLineItemAmounts(lineItems) +
            (shipping.isFree ? 0 : shipping.amount),
          currency,
        ),
        couponCode: coupon?.code ?? '',
        promotionCode: promotion?.code ?? '',
        cart: createCheckoutDto.cart,
      });

      return {
        orderId: null,
        status: 'pending_payment',
        total: this.toCurrencyUnitAmount(
          this.sumLineItemAmounts(lineItems) +
            (shipping.isFree ? 0 : shipping.amount),
          currency,
        ),
        currency,
        checkoutUrl: session.url ?? '',
        sessionId: session.id,
        paymentUrl: null,
        provider: 'stripe',
      };
    } catch (error) {
      throw error;
    }
  }

  async handleStripeWebhook(event: Stripe.Event): Promise<{ received: true }> {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      await this.analyticsService.recordSystemEvent('stripe_checkout_completed', {
        provider: 'stripe',
        sessionId: session.id,
        customerEmail: session.customer_details?.email || session.customer_email || '',
        currency: session.currency || '',
        amountTotal: session.amount_total ?? 0,
        couponCode: session.metadata?.couponCode || '',
        promotionCode: session.metadata?.promotionCode || '',
      });
      const existingOrderId = this.getOrderIdFromSession(session);

      if (existingOrderId) {
        await this.markOrderAsPaid(session);
      } else {
        await this.createPaidWooCommerceOrderFromSession(session);
      }
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      await this.analyticsService.recordSystemEvent('stripe_checkout_expired', {
        provider: 'stripe',
        sessionId: session.id,
        customerEmail: session.customer_details?.email || session.customer_email || '',
        currency: session.currency || '',
        amountTotal: session.amount_total ?? 0,
        couponCode: session.metadata?.couponCode || '',
        promotionCode: session.metadata?.promotionCode || '',
      });
      const orderId = this.getOrderIdFromSession(session);

      if (orderId) {
        await this.markOrderAsFailed(orderId);
      }
    }

    return { received: true };
  }

  private async createWooCommerceOrder(
    createCheckoutDto: CreateCheckoutDto,
    promotion?: CheckoutBundlePromotion,
    payment?: {
      provider?: CheckoutProvider;
      paymentMethod?: string;
      paymentMethodTitle?: string;
      status?: string;
      setPaid?: boolean;
      transactionId?: string;
      stripeSessionId?: string;
      shipping?: CheckoutShippingDecision;
      shippingProtection?: ShippingProtectionDecision;
      stripeAddressUpdate?: Partial<WooCommerceOrderPayload>;
      resolvedCart?: ResolvedCheckoutCartItem[];
      discountPercent?: number;
      successUrl?: string;
      cancelUrl?: string;
    },
  ): Promise<WooCommerceOrder> {
    const setPaid = payment?.setPaid ?? false;
    const provider = payment?.provider ?? 'stripe';

    return this.wooCommerceClient.post<WooCommerceOrder, WooCommerceOrderPayload>(
      '/orders',
      {
        payment_method: payment?.paymentMethod ?? provider,
        payment_method_title:
          payment?.paymentMethodTitle ?? this.getPaymentMethodTitle(provider),
        set_paid: setPaid,
        status: payment?.status,
        transaction_id: payment?.transactionId,
        customer_note: createCheckoutDto.customerNote,
        line_items: createCheckoutDto.cart.flatMap((item, index) => {
          const resolvedItem = payment?.resolvedCart?.find(
            (cartItem) =>
              cartItem.productId === item.productId &&
              cartItem.variationId === item.variationId,
          );

          return this.toWooCommerceLineItems(
            item,
            index === 0 ? promotion : undefined,
            resolvedItem,
            payment?.discountPercent,
          );
        }),
        fee_lines: payment?.shippingProtection?.enabled
          ? [
              {
                name: payment.shippingProtection.displayName,
                total: this.toCurrencyUnitAmount(
                  payment.shippingProtection.amount,
                  payment.shippingProtection.currency,
                ),
                tax_status: 'none',
              },
            ]
          : undefined,
        shipping_lines: payment?.shipping
          ? [
              {
                method_id: payment.shipping.isFree
                  ? 'headless_free_shipping'
                  : 'headless_standard_shipping',
                method_title: payment.shipping.displayName,
                total: this.toCurrencyUnitAmount(
                  payment.shipping.amount,
                  payment.shipping.currency,
                ),
              },
            ]
          : undefined,
        meta_data: [
          {
            key: '_headless_checkout',
            value: 'true',
          },
          {
            key: '_headless_shipping_pending',
            value: 'true',
          },
          {
            key: '_headless_payment_provider',
            value: provider,
          },
          ...(createCheckoutDto.couponCode
            ? [
                {
                  key: '_headless_coupon_code',
                  value: createCheckoutDto.couponCode.trim().toUpperCase(),
                },
              ]
            : []),
          ...this.toWooCommercePromotionMeta(promotion),
          ...(payment?.stripeSessionId
            ? [
                {
                  key: 'stripe_checkout_session_id',
                  value: payment.stripeSessionId,
                },
              ]
            : []),
          ...(payment?.successUrl
            ? [
                {
                  key: '_headless_success_url',
                  value: payment.successUrl,
                },
              ]
            : []),
          ...(payment?.cancelUrl
            ? [
                {
                  key: '_headless_cancel_url',
                  value: payment.cancelUrl,
                },
              ]
            : []),
          ...(setPaid
            ? [
                {
                  key: '_wiio_ready_for_sync',
                  value: 'true',
                },
                {
                  key: '_wiio_sync_source',
                  value: provider === 'woopayments'
                    ? 'woopayments_order_paid'
                    : 'stripe_checkout_webhook',
                },
              ]
            : []),
          ...(payment?.shipping
            ? this.toWooCommerceShippingMeta(payment.shipping)
            : []),
          ...(payment?.shippingProtection
            ? this.toWooCommerceShippingProtectionMeta(
                payment.shippingProtection,
              )
            : []),
        ],
        billing:
          payment?.stripeAddressUpdate?.billing ||
          this.toWooCommerceBillingAddress(createCheckoutDto),
        shipping:
          payment?.stripeAddressUpdate?.shipping ||
          this.toWooCommerceShippingAddress(createCheckoutDto.shippingAddress),
        coupon_lines: createCheckoutDto.couponCode && provider !== 'stripe'
          ? [
              {
                code: createCheckoutDto.couponCode.trim().toUpperCase(),
              },
            ]
          : undefined,
      },
    );
  }

  private async createWooPaymentsCheckout(
    createCheckoutDto: CreateCheckoutDto,
    promotion: CheckoutBundlePromotion | undefined,
    shipping: CheckoutShippingDecision,
    shippingProtection: ShippingProtectionDecision,
    currency: string,
  ): Promise<CheckoutResponseDto> {
    await this.assertWooPaymentsGatewayReady();

    const order = await this.createWooCommerceOrder(
      createCheckoutDto,
      promotion,
      {
        provider: 'woopayments',
        paymentMethod: this.getWooPaymentsGatewayId(),
        paymentMethodTitle: this.getWooPaymentsGatewayTitle(),
        status: 'pending',
        setPaid: false,
        shipping,
        shippingProtection,
        successUrl: this.toWooPaymentsReturnUrl(createCheckoutDto.successUrl),
        cancelUrl: createCheckoutDto.cancelUrl,
      },
    );
    const paymentUrl = this.getWooCommercePaymentUrl(order);

    await this.analyticsService.recordSystemEvent('checkout_session_created', {
      provider: 'woopayments',
      orderId: order.id,
      status: order.status,
      customerEmail:
        createCheckoutDto.customerEmail || createCheckoutDto.customer?.email || '',
      currency: order.currency || currency,
      total: order.total || '0.00',
      promotionCode: promotion?.code ?? '',
      cart: createCheckoutDto.cart,
    });

    return {
      orderId: order.id,
      status: order.status ?? 'pending_payment',
      total: order.total || '0.00',
      currency: order.currency || currency,
      checkoutUrl: paymentUrl,
      sessionId: '',
      paymentUrl,
      provider: 'woopayments',
    };
  }

  private async assertWooPaymentsGatewayReady(): Promise<void> {
    const gatewayId = this.getWooPaymentsGatewayId();
    const gateway = await this.wooCommerceClient.get<WooCommercePaymentGateway>(
      `/payment_gateways/${encodeURIComponent(gatewayId)}`,
    );

    if (gateway.enabled !== true) {
      this.logger.warn(
        `WooPayments gateway ${gatewayId} is not enabled in WooCommerce`,
      );
      throw new BadGatewayException(
        'WooPayments is not enabled in WooCommerce yet.',
      );
    }
  }

  private async buildStripeLineItems(
    cart: ResolvedCheckoutCartItem[],
    currency: string,
  ): Promise<CheckoutLineItem[]> {
    return cart.map((item) => ({
      name: item.name,
      unitAmount: this.toMinorUnitAmount(item.price, currency),
      currency,
      quantity: item.quantity,
      image: item.image,
    }));
  }

  private async markOrderAsPaid(session: Stripe.Checkout.Session): Promise<void> {
    const orderId = this.getOrderIdFromSession(session);

    if (!orderId) {
      this.logger.warn(`Stripe session ${session.id} has no WooCommerce order id`);
      return;
    }

    const stripeAddressUpdate = this.toWooCommerceAddressUpdateFromStripe(session);

    const paidOrder = await this.wooCommerceClient.put<
      WooCommerceOrder,
      WooCommerceOrderUpdatePayload
    >(
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
          {
            key: '_wiio_ready_for_sync',
            value: 'true',
          },
          {
            key: '_wiio_sync_source',
            value: 'stripe_checkout_webhook',
          },
        ],
      },
    );

    const wiioStatus = await this.wiioService.dispatchPaidOrder(
      paidOrder,
      session,
    );

    await this.updateWiioDispatchStatus(orderId, wiioStatus);
  }

  private async createPaidWooCommerceOrderFromSession(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const createCheckoutDto = this.getCheckoutDtoFromSession(session);
    this.validateCart(createCheckoutDto.cart);

    const resolvedCart = await this.resolveCheckoutCart(createCheckoutDto.cart);
    const promotion = this.getBundlePromotion(
      createCheckoutDto.cart,
      resolvedCart,
    );
    const currency = this.getCheckoutCurrency();
    const shipping = this.getShippingDecision(createCheckoutDto.cart, currency);
    const shippingProtection = this.getShippingProtectionDecision(
      session.metadata?.shippingProtection === 'true',
      currency,
    );
    const stripeAddressUpdate = this.toWooCommerceAddressUpdateFromStripe(session);

    const paidOrder = await this.createWooCommerceOrder(
      createCheckoutDto,
      promotion,
      {
        status: 'processing',
        setPaid: true,
        transactionId:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id,
        stripeSessionId: session.id,
        shipping,
        shippingProtection,
        stripeAddressUpdate,
        resolvedCart,
        discountPercent: this.getSessionCouponPercent(session),
      },
    );

    const wiioStatus = await this.wiioService.dispatchPaidOrder(
      paidOrder,
      session,
    );

    await this.updateWiioDispatchStatus(paidOrder.id, wiioStatus);
  }

  private getOrderIdFromSession(session: Stripe.Checkout.Session): number | null {
    const rawOrderId =
      session.metadata?.wooCommerceOrderId || session.client_reference_id;
    const orderId = Number(rawOrderId);

    return Number.isInteger(orderId) && orderId > 0 ? orderId : null;
  }

  private getCheckoutDtoFromSession(
    session: Stripe.Checkout.Session,
  ): CreateCheckoutDto {
    const cart = this.parseCheckoutCart(session.metadata?.checkoutCart);
    const customerDetails = session.customer_details;

    return {
      cart,
      successUrl: '',
      cancelUrl: '',
      customerEmail:
        customerDetails?.email || session.customer_email || undefined,
      couponCode: session.metadata?.couponCode || undefined,
      customer: {
        name: customerDetails?.name ?? undefined,
        email: customerDetails?.email ?? undefined,
        phone:
          customerDetails?.phone ||
          session.metadata?.customerPhone ||
          undefined,
      },
      shippingProtection: {
        enabled: session.metadata?.shippingProtection === 'true',
      },
    };
  }

  private parseCheckoutCart(value?: string): CheckoutCartItemDto[] {
    if (!value) {
      throw new BadRequestException('Stripe session is missing checkout cart');
    }

    try {
      const cart = JSON.parse(value) as CheckoutCartItemDto[];
      if (!Array.isArray(cart)) {
        throw new Error('checkoutCart is not an array');
      }

      return cart.map((item) => ({
        productId: Number(item.productId),
        variationId: item.variationId ? Number(item.variationId) : undefined,
        quantity: Number(item.quantity),
      }));
    } catch (error) {
      this.logger.warn(`Invalid checkout cart metadata: ${(error as Error).message}`);
      throw new BadRequestException('Stripe session has invalid checkout cart');
    }
  }

  private addOrderIdToSuccessUrl(successUrl: string, orderId: number): string {
    try {
      const url = new URL(successUrl);
      url.searchParams.set('order_id', String(orderId));
      return url.toString();
    } catch {
      return successUrl;
    }
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

  private async updateWiioDispatchStatus(
    orderId: number,
    wiioStatus: WiioDispatchStatus,
  ): Promise<void> {
    if (wiioStatus === 'disabled') return;

    try {
      await this.wooCommerceClient.put<
        WooCommerceOrder,
        WooCommerceOrderUpdatePayload
      >(`/orders/${orderId}`, {
        meta_data: [
          {
            key: '_wiio_dispatch_status',
            value: wiioStatus,
          },
          {
            key: '_wiio_dispatch_attempted_at',
            value: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      this.logger.warn(
        `Could not persist Wiio dispatch status for WooCommerce order ${orderId}`,
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

    const maxQuantity = this.getCheckoutMaxQuantity();
    const hasQuantityAboveLimit = cart.some((item) => item.quantity > maxQuantity);

    if (hasQuantityAboveLimit) {
      throw new BadRequestException(
        `cart item quantity cannot be greater than ${maxQuantity}`,
      );
    }
  }

  private async resolveCheckoutCart(
    cart: CheckoutCartItemDto[],
  ): Promise<ResolvedCheckoutCartItem[]> {
    return Promise.all(
      cart.map(async (item) => {
        const product = await this.wooCommerceClient.get<WooCommerceProduct>(
          `/products/${item.productId}`,
        );
        this.validateWooCommerceSaleableItem(product, 'product');

        const variation = item.variationId
          ? await this.wooCommerceClient.get<WooCommerceVariation>(
              `/products/${item.productId}/variations/${item.variationId}`,
            )
          : null;

        if (variation) {
          this.validateWooCommerceSaleableItem(variation, 'variation');
        }

        this.validateRequestedStock(item, variation ?? product);
        const price = variation?.price || product.price;
        this.toMinorUnitAmount(price, 'USD');

        return {
          productId: item.productId,
          variationId: item.variationId,
          quantity: item.quantity,
          name: product.name,
          price,
          image: variation?.image?.src || product.images?.[0]?.src || null,
          variationTitle: variation?.name || variation?.title,
        };
      }),
    );
  }

  private validateWooCommerceSaleableItem(
    item: WooCommerceProduct | WooCommerceVariation,
    label: 'product' | 'variation',
  ): void {
    if (item.status && item.status !== 'publish') {
      throw new BadRequestException(`Selected ${label} is not available`);
    }

    if (item.purchasable === false) {
      throw new BadRequestException(`Selected ${label} is not purchasable`);
    }

    if (item.stock_status && item.stock_status !== 'instock') {
      throw new BadRequestException(`Selected ${label} is out of stock`);
    }
  }

  private validateRequestedStock(
    cartItem: CheckoutCartItemDto,
    wooItem: WooCommerceProduct | WooCommerceVariation,
  ): void {
    if (
      wooItem.manage_stock &&
      Number.isFinite(Number(wooItem.stock_quantity)) &&
      cartItem.quantity > Number(wooItem.stock_quantity)
    ) {
      throw new BadRequestException('Requested quantity is not available');
    }
  }

  private toWooCommerceLineItems(
    item: CheckoutCartItemDto,
    promotion?: CheckoutBundlePromotion,
    resolvedItem?: ResolvedCheckoutCartItem,
    discountPercent = 0,
  ): WooCommerceOrderPayload['line_items'] {
    const lineTotals = this.getWooCommerceLineTotals(
      resolvedItem,
      item.quantity,
      discountPercent,
    );
    const paidLineItem: WooCommerceOrderPayload['line_items'][number] = {
      product_id: item.productId,
      variation_id: item.variationId,
      quantity: item.quantity,
      ...(lineTotals
        ? {
            subtotal: lineTotals.subtotal,
            total: lineTotals.total,
          }
        : {}),
      meta_data: [
        {
          key: '_headless_line_type',
          value: 'paid',
        },
        ...(promotion
          ? [
              {
                key: '_headless_bundle_promotion',
                value: promotion.code,
              },
            ]
          : []),
      ],
    };

    if (!promotion?.freeQuantity) {
      return [paidLineItem];
    }

    return [
      paidLineItem,
      {
        product_id: item.productId,
        variation_id: item.variationId,
        quantity: promotion.freeQuantity,
        subtotal: '0.00',
        total: '0.00',
        meta_data: [
          {
            key: '_headless_line_type',
            value: 'free_bonus',
          },
          {
            key: '_headless_bundle_promotion',
            value: promotion.code,
          },
          {
            key: '_headless_fulfillment_note',
            value: `${promotion.freeQuantity} free bottle${promotion.freeQuantity === 1 ? '' : 's'} included in ${promotion.label}.`,
          },
        ],
      },
    ];
  }

  private getBundlePromotion(
    cart: CheckoutCartItemDto[],
    resolvedCart: ResolvedCheckoutCartItem[] = [],
  ): CheckoutBundlePromotion | undefined {
    if (cart.length !== 1) return undefined;

    const variationTitle = this.normalizeBundleTitle(resolvedCart[0]?.variationTitle);
    const paidQuantity = variationTitle.includes('buy 3 get 2')
      ? 3
      : variationTitle.includes('buy 2 get 1')
        ? 2
        : cart[0].quantity;
    const freeQuantity = paidQuantity >= 3 ? 2 : paidQuantity === 2 ? 1 : 0;
    if (!freeQuantity) return undefined;

    return {
      code: paidQuantity >= 3 ? 'BUY_3_GET_2' : 'BUY_2_GET_1',
      label: paidQuantity >= 3 ? 'Buy 3 Get 2' : 'Buy 2 Get 1',
      paidQuantity,
      freeQuantity,
      deliveredQuantity: paidQuantity + freeQuantity,
    };
  }

  private normalizeBundleTitle(value?: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private toWooCommercePromotionMeta(promotion?: CheckoutBundlePromotion) {
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

  private getCheckoutMaxQuantity(): number {
    const configuredMaxQuantity = Number(
      this.configService.get('CHECKOUT_MAX_ITEM_QUANTITY'),
    );

    return Number.isInteger(configuredMaxQuantity) && configuredMaxQuantity > 0
      ? configuredMaxQuantity
      : 12;
  }

  private getCheckoutCurrency(): string {
    return 'USD';
  }

  private getSessionCouponPercent(session: Stripe.Checkout.Session): number {
    const percent = Number(session.metadata?.couponPercent || 0);

    return Number.isFinite(percent) && percent > 0 ? percent : 0;
  }

  private getCheckoutProvider(): CheckoutProvider {
    const provider = this.configService
      .get<string>('CHECKOUT_PROVIDER')
      ?.trim()
      .toLowerCase();

    return provider === 'woopayments' ? 'woopayments' : 'stripe';
  }

  private getPaymentMethodTitle(provider: CheckoutProvider): string {
    return provider === 'woopayments'
      ? this.getWooPaymentsGatewayTitle()
      : 'Stripe';
  }

  private getWooPaymentsGatewayId(): string {
    return (
      this.configService.get<string>('WOOPAYMENTS_GATEWAY_ID') ||
      'woocommerce_payments'
    ).trim();
  }

  private getWooPaymentsGatewayTitle(): string {
    return (
      this.configService.get<string>('WOOPAYMENTS_GATEWAY_TITLE') ||
      'WooPayments'
    ).trim();
  }

  private getWooCommercePaymentUrl(order: WooCommerceOrder): string {
    if (order.payment_url?.trim()) {
      return this.toPublicWooCommerceUrl(order.payment_url);
    }

    const orderKey = order.order_key?.trim();
    const publicBaseUrl = this.getPublicWooCommerceUrl();
    if (order.id && orderKey && publicBaseUrl) {
      const url = new URL(`/checkout/order-pay/${order.id}/`, publicBaseUrl);
      url.searchParams.set('pay_for_order', 'true');
      url.searchParams.set('key', orderKey);
      return url.toString();
    }

    this.logger.error(
      `WooCommerce order ${order.id} did not return a payment_url or order_key`,
    );
    throw new BadGatewayException(
      'WooCommerce did not return a payment URL for this order.',
    );
  }

  private toWooPaymentsReturnUrl(successUrl: string): string {
    try {
      const url = new URL(successUrl);
      if (url.searchParams.get('session_id') === '{CHECKOUT_SESSION_ID}') {
        url.searchParams.delete('session_id');
      }
      return url.toString();
    } catch {
      return successUrl;
    }
  }

  private toPublicWooCommerceUrl(rawUrl: string): string {
    const publicBaseUrl = this.getPublicWooCommerceUrl();
    if (!publicBaseUrl) return rawUrl;

    try {
      const paymentUrl = new URL(rawUrl);
      const publicUrl = new URL(publicBaseUrl);
      paymentUrl.protocol = publicUrl.protocol;
      paymentUrl.host = publicUrl.host;
      return paymentUrl.toString();
    } catch {
      return rawUrl;
    }
  }

  private getPublicWooCommerceUrl(): string {
    return (
      this.configService.get<string>('WOOCOMMERCE_PUBLIC_URL') ||
      this.configService.get<string>('WOOCOMMERCE_SIGNATURE_BASE_URL') ||
      this.configService.get<string>('WOOCOMMERCE_URL') ||
      ''
    ).trim();
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

  private toWooCommerceShippingMeta(
    shipping: CheckoutShippingDecision,
  ): WooCommerceOrderPayload['meta_data'] {
    return [
      {
        key: '_headless_shipping_method',
        value: shipping.displayName,
      },
      {
        key: '_headless_shipping_amount',
        value: this.toCurrencyUnitAmount(shipping.amount, shipping.currency),
      },
      {
        key: '_headless_free_shipping',
        value: String(shipping.isFree),
      },
    ];
  }

  private toWooCommerceShippingProtectionMeta(
    shippingProtection: ShippingProtectionDecision,
  ): WooCommerceOrderPayload['meta_data'] {
    return [
      {
        key: '_headless_shipping_protection',
        value: String(shippingProtection.enabled),
      },
      {
        key: '_headless_shipping_protection_amount',
        value: this.toCurrencyUnitAmount(
          shippingProtection.amount,
          shippingProtection.currency,
        ),
      },
    ];
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

  private sumLineItemAmounts(lineItems: CheckoutLineItem[]): number {
    return lineItems.reduce(
      (total, item) => total + item.unitAmount * item.quantity,
      0,
    );
  }

  private getWooCommerceLineTotals(
    item: ResolvedCheckoutCartItem | undefined,
    quantity: number,
    discountPercent: number,
  ): { subtotal: string; total: string } | null {
    if (!item || !Number.isFinite(discountPercent) || discountPercent <= 0) {
      return null;
    }

    const subtotal = Number(item.price) * quantity;
    if (!Number.isFinite(subtotal) || subtotal <= 0) return null;

    const total = subtotal * Math.max(0, 1 - discountPercent / 100);

    return {
      subtotal: subtotal.toFixed(2),
      total: total.toFixed(2),
    };
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
