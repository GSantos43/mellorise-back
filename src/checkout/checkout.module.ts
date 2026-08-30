import { Module } from '@nestjs/common';
import { WooCommerceModule } from '../woocommerce/woocommerce.module';
import { PaymentsModule } from '../payments/payments.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

@Module({
  imports: [WooCommerceModule, PaymentsModule, DiscountsModule, FulfillmentModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
