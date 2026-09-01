import { Module } from '@nestjs/common';
import { ClerkAuthModule } from '../auth/clerk-auth.module';
import { WooCommerceModule } from '../woocommerce/woocommerce.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  imports: [ClerkAuthModule, WooCommerceModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
