import { BadRequestException, Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CheckoutResponseDto } from './dto/checkout-response.dto';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { StripeService } from '../payments/stripe.service';
import { GeoService } from '../geo/geo.service';

type CheckoutRequest = Parameters<GeoService['assertCheckoutAllowed']>[0] & {
  rawBody?: Buffer;
};

type CheckoutRequestContext = {
  ip?: string;
  userAgent?: string;
};

@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly stripeService: StripeService,
    private readonly geoService: GeoService,
  ) {}

  @Post()
  async createCheckout(
    @Body() createCheckoutDto: CreateCheckoutDto,
    @Req() request: CheckoutRequest,
  ): Promise<CheckoutResponseDto> {
    await this.geoService.assertCheckoutAllowed(request);
    return this.checkoutService.createCheckoutSession(
      createCheckoutDto,
      this.getRequestContext(request),
    );
  }

  @Post('session')
  async createCheckoutSession(
    @Body() createCheckoutDto: CreateCheckoutDto,
    @Req() request: CheckoutRequest,
  ): Promise<CheckoutResponseDto> {
    await this.geoService.assertCheckoutAllowed(request);
    return this.checkoutService.createCheckoutSession(
      createCheckoutDto,
      this.getRequestContext(request),
    );
  }

  @Post('webhook')
  async handleStripeWebhook(
    @Req() request: CheckoutRequest,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: true }> {
    if (!request.rawBody || !signature) {
      throw new BadRequestException('Missing Stripe webhook payload or signature');
    }

    const event = this.stripeService.constructWebhookEvent(
      request.rawBody,
      signature,
    );

    return this.checkoutService.handleStripeWebhook(event);
  }

  private getRequestContext(request: CheckoutRequest): CheckoutRequestContext {
    return {
      ip: this.getClientIp(request),
      userAgent: this.getHeader(request, 'user-agent'),
    };
  }

  private getHeader(request: CheckoutRequest, key: string): string {
    const value = request.headers?.[key];
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
  }

  private getClientIp(request: CheckoutRequest): string {
    const forwardedFor = this.getHeader(request, 'x-forwarded-for');
    const forwardedIp = forwardedFor.split(',')[0]?.trim();
    const candidates = [
      this.getHeader(request, 'cf-connecting-ip'),
      this.getHeader(request, 'x-real-ip'),
      forwardedIp,
    ];

    return candidates
      .map((candidate) => candidate.trim().replace(/^::ffff:/, ''))
      .find(Boolean) || '';
  }
}
