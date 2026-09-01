import { Controller, Get, Headers } from '@nestjs/common';
import { ClerkAuthService } from '../auth/clerk-auth.service';
import { AccountService } from './account.service';

@Controller('account')
export class AccountController {
  constructor(
    private readonly clerkAuthService: ClerkAuthService,
    private readonly accountService: AccountService,
  ) {}

  @Get('orders')
  async listOrders(@Headers('authorization') authorization?: string) {
    const customer = await this.clerkAuthService.authenticate(authorization);
    return this.accountService.listOrdersForCustomer(customer);
  }
}
