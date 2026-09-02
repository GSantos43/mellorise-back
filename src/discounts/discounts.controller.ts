import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ClerkAuthService } from '../auth/clerk-auth.service';
import { CreateWelcomeDiscountDto } from './dto/create-welcome-discount.dto';
import { ValidateWelcomeDiscountDto } from './dto/validate-welcome-discount.dto';
import { WelcomeDiscountResponseDto } from './dto/welcome-discount-response.dto';
import { DiscountsService } from './discounts.service';

@Controller('discounts')
export class DiscountsController {
  constructor(
    private readonly discountsService: DiscountsService,
    private readonly clerkAuthService: ClerkAuthService,
  ) {}

  @Post('welcome')
  async createWelcomeDiscount(
    @Body() createWelcomeDiscountDto: CreateWelcomeDiscountDto,
    @Headers('authorization') authorization?: string,
  ): Promise<WelcomeDiscountResponseDto> {
    const customer = await this.clerkAuthService.authenticate(authorization);
    return this.discountsService.createWelcomeDiscount(
      createWelcomeDiscountDto,
      customer.email,
    );
  }

  @Post('validate')
  async validateWelcomeDiscount(
    @Body() validateWelcomeDiscountDto: ValidateWelcomeDiscountDto,
  ): Promise<WelcomeDiscountResponseDto> {
    return this.discountsService.validateWelcomeDiscount(validateWelcomeDiscountDto);
  }
}
