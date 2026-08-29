import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WooCommerceModule } from '../woocommerce/woocommerce.module';
import { DiscountsController } from './discounts.controller';
import { DiscountsService } from './discounts.service';

@Module({
  imports: [ConfigModule, WooCommerceModule],
  controllers: [DiscountsController],
  providers: [DiscountsService],
  exports: [DiscountsService],
})
export class DiscountsModule {}
