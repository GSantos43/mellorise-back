import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClerkAuthModule } from '../auth/clerk-auth.module';
import { MailModule } from '../mail/mail.module';
import { WooCommerceModule } from '../woocommerce/woocommerce.module';
import { DiscountsController } from './discounts.controller';
import { DiscountsService } from './discounts.service';

@Module({
  imports: [ConfigModule, ClerkAuthModule, WooCommerceModule, MailModule],
  controllers: [DiscountsController],
  providers: [DiscountsService],
  exports: [DiscountsService],
})
export class DiscountsModule {}
