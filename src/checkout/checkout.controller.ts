import { BadRequestException, Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CheckoutResponseDto } from './dto/checkout-response.dto';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { StripeService } from '../payments/stripe.service';
import { GeoService } from '../geo/geo.service';

type CheckoutRequest = Parameters<GeoService['assertCheckoutAllowed']>[0] & {
  rawBody?: Buffer;
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
    return this.checkoutService.createCheckoutSession(createCheckoutDto);
  }

  @Post('session')
  async createCheckoutSession(
    @Body() createCheckoutDto: CreateCheckoutDto,
    @Req() request: CheckoutRequest,
  ): Promise<CheckoutResponseDto> {
    await this.geoService.assertCheckoutAllowed(request);
    return this.checkoutService.createCheckoutSession(createCheckoutDto);
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
}
