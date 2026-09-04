import { Body, Controller, Ip, Post, Req } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { CreateAnalyticsEventDto } from './dto/create-analytics-event.dto';

type AnalyticsRequest = {
  headers?: Record<string, string | string[] | undefined>;
};

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('events')
  async createEvent(
    @Body() createAnalyticsEventDto: CreateAnalyticsEventDto,
    @Ip() ip: string,
    @Req() request: AnalyticsRequest,
  ): Promise<{ received: true }> {
    await this.analyticsService.recordEvent(createAnalyticsEventDto, {
      ip,
      userAgent: this.getHeader(request, 'user-agent'),
    });

    return { received: true };
  }

  private getHeader(request: AnalyticsRequest, key: string): string {
    const value = request.headers?.[key];
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
  }
}
