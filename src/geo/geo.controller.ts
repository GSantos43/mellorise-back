import { Controller, Get, Req } from '@nestjs/common';
import { CheckoutEligibility, GeoService } from './geo.service';

type GeoRequest = Parameters<GeoService['getCheckoutEligibility']>[0];

@Controller('geo')
export class GeoController {
  constructor(private readonly geoService: GeoService) {}

  @Get('checkout-eligibility')
  getCheckoutEligibility(
    @Req() request: GeoRequest,
  ): Promise<CheckoutEligibility> {
    return this.geoService.getCheckoutEligibility(request);
  }
}
