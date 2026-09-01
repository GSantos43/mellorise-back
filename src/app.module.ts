import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CheckoutModule } from './checkout/checkout.module';
import { DiscountsModule } from './discounts/discounts.module';
import { ProductsModule } from './products/products.module';
import { TrackingModule } from './tracking/tracking.module';
import { AccountModule } from './account/account.module';
import { GeoModule } from './geo/geo.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ProductsModule,
    DiscountsModule,
    CheckoutModule,
    TrackingModule,
    AccountModule,
    GeoModule,
  ],
})
export class AppModule {}
