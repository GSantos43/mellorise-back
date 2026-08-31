import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import { WooCommerceModule } from '../woocommerce/woocommerce.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Module({
  imports: [ConfigModule, WooCommerceModule, MailModule],
  controllers: [TrackingController],
  providers: [TrackingService],
})
export class TrackingModule {}
