import { Body, Controller, Post } from '@nestjs/common';
import { CreateWelcomeDiscountDto } from './dto/create-welcome-discount.dto';
import { WelcomeDiscountResponseDto } from './dto/welcome-discount-response.dto';
import { DiscountsService } from './discounts.service';

@Controller('discounts')
export class DiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  @Post('welcome')
  async createWelcomeDiscount(
    @Body() createWelcomeDiscountDto: CreateWelcomeDiscountDto,
  ): Promise<WelcomeDiscountResponseDto> {
    return this.discountsService.createWelcomeDiscount(createWelcomeDiscountDto);
  }
}
