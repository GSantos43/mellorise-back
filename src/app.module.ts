import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CheckoutModule } from './checkout/checkout.module';
import { DiscountsModule } from './discounts/discounts.module';
import { ProductsModule } from './products/products.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ProductsModule,
    DiscountsModule,
    CheckoutModule,
  ],
})
export class AppModule {}
