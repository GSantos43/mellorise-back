import { Module } from '@nestjs/common';
import { WooCommerceModule } from '../woocommerce/woocommerce.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [WooCommerceModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
