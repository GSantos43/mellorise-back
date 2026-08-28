import { BadRequestException, Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CheckoutResponseDto } from './dto/checkout-response.dto';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { StripeService } from '../payments/stripe.service';

@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly stripeService: StripeService,
  ) {}

  @Post()
  async createCheckout(
    @Body() createCheckoutDto: CreateCheckoutDto,
  ): Promise<CheckoutResponseDto> {
    return this.checkoutService.createCheckoutSession(createCheckoutDto);
  }

  @Post('session')
  async createCheckoutSession(
    @Body() createCheckoutDto: CreateCheckoutDto,
  ): Promise<CheckoutResponseDto> {
    return this.checkoutService.createCheckoutSession(createCheckoutDto);
  }

  @Post('webhook')
  async handleStripeWebhook(
    @Req() request: { rawBody?: Buffer },
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
