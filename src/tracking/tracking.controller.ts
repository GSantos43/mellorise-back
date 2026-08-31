import { Body, Controller, Headers, Post } from '@nestjs/common';
import { LookupTrackingDto } from './dto/lookup-tracking.dto';
import { WiioTrackingWebhookDto } from './dto/wiio-tracking-webhook.dto';
import { TrackingService } from './tracking.service';

@Controller('tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Post('lookup')
  lookup(@Body() lookupTrackingDto: LookupTrackingDto) {
    return this.trackingService.lookup(lookupTrackingDto);
  }

  @Post('wiio')
  receiveWiioTracking(
    @Body() wiioTrackingWebhookDto: WiioTrackingWebhookDto,
    @Headers('x-wiio-webhook-secret') webhookSecret?: string,
  ) {
    return this.trackingService.receiveWiioTracking(
      wiioTrackingWebhookDto,
      webhookSecret,
    );
  }
}
