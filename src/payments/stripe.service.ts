import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

type CheckoutSessionLineItem = {
  name: string;
  unitAmount: number;
  currency: string;
  quantity: number;
  image?: string | null;
};

type CreateCheckoutSessionInput = {
  orderId?: number;
  lineItems: CheckoutSessionLineItem[];
  shipping: CheckoutSessionShipping;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  metadata: Record<string, string>;
};

export type CheckoutSessionShipping = {
  isFree: boolean;
  displayName: string;
  amount: number;
  currency: string;
  minDeliveryDays?: number;
  maxDeliveryDays?: number;
};

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY')?.trim();

    if (!secretKey) {
      throw new InternalServerErrorException(
        'Missing required environment variable: STRIPE_SECRET_KEY',
      );
    }

    if (!/^(sk|rk)_(test|live)_/.test(secretKey)) {
      throw new InternalServerErrorException(
        'Invalid STRIPE_SECRET_KEY format',
      );
    }

    this.stripe = new Stripe(secretKey, {
      timeout: Number(this.configService.get('STRIPE_TIMEOUT_MS') ?? 10000),
    });
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<Stripe.Checkout.Session> {
    try {
      return await this.stripe.checkout.sessions.create({
        mode: 'payment',
        adaptive_pricing: {
          enabled: false,
        },
        payment_method_types: ['card'],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        customer_email: input.customerEmail,
        client_reference_id: input.orderId ? String(input.orderId) : undefined,
        metadata: input.metadata,
        billing_address_collection: 'required',
        phone_number_collection: {
          enabled: true,
        },
        automatic_tax: {
          enabled:
            this.configService.get<string>('STRIPE_AUTOMATIC_TAX_ENABLED') ===
            'true',
        },
        shipping_address_collection: this.shippingAddressCollection,
        shipping_options: [this.toShippingOption(input.shipping)],
        line_items: input.lineItems.map((item) => ({
          quantity: item.quantity,
          price_data: {
            currency: 'usd',
            unit_amount: item.unitAmount,
            product_data: {
              name: item.name,
              images: item.image ? [item.image] : undefined,
            },
          },
        })),
      });
    } catch (error) {
      const stripeError = error as Stripe.errors.StripeError;

      this.logger.error(
        `Stripe checkout session failed: ${stripeError.message}`,
        JSON.stringify({
          type: stripeError.type,
          code: stripeError.code,
          declineCode: stripeError.decline_code,
        }),
      );

      if (
        stripeError.type === 'StripeCardError' ||
        stripeError.type === 'StripeInvalidRequestError'
      ) {
        throw new BadRequestException(
          'Nao foi possivel criar o checkout. Confira os dados e tente novamente.',
        );
      }

      throw new BadGatewayException(
        'Nao foi possivel conectar ao Stripe agora. Tente novamente.',
      );
    }
  }

  private toShippingOption(
    shipping: CheckoutSessionShipping,
  ): Stripe.Checkout.SessionCreateParams.ShippingOption {
    return {
      shipping_rate_data: {
        type: 'fixed_amount',
        display_name: shipping.displayName,
        fixed_amount: {
          amount: shipping.isFree ? 0 : shipping.amount,
          currency: 'usd',
        },
        delivery_estimate:
          shipping.minDeliveryDays || shipping.maxDeliveryDays
            ? {
                minimum: shipping.minDeliveryDays
                  ? { unit: 'business_day', value: shipping.minDeliveryDays }
                  : undefined,
                maximum: shipping.maxDeliveryDays
                  ? { unit: 'business_day', value: shipping.maxDeliveryDays }
                  : undefined,
              }
            : undefined,
      },
    };
  }

  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );

    if (!webhookSecret) {
      throw new InternalServerErrorException(
        'Missing required environment variable: STRIPE_WEBHOOK_SECRET',
      );
    }

    try {
      return this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch (error) {
      const stripeError = error as Error;
      this.logger.warn(`Stripe webhook signature rejected: ${stripeError.message}`);
      throw new BadRequestException('Invalid Stripe webhook signature');
    }
  }

  private get shippingAddressCollection():
    | Stripe.Checkout.SessionCreateParams.ShippingAddressCollection
    | undefined {
    const countries = this.configService
      .get<string>('STRIPE_SHIPPING_COUNTRIES')
      ?.split(',')
      .map((country) => country.trim().toUpperCase())
      .filter(Boolean) as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[];

    if (!countries?.length) {
      return undefined;
    }

    return {
      allowed_countries: countries,
    };
  }
}
