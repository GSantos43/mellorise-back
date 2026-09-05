import { Body, Controller, Get, Headers, Ip, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsService } from './analytics.service';
import { CreateAnalyticsEventDto } from './dto/create-analytics-event.dto';

type AnalyticsRequest = {
  headers?: Record<string, string | string[] | undefined>;
};

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly configService: ConfigService,
  ) {}

  @Post('events')
  async createEvent(
    @Body() createAnalyticsEventDto: CreateAnalyticsEventDto,
    @Ip() ip: string,
    @Req() request: AnalyticsRequest,
  ): Promise<{ received: true }> {
    await this.analyticsService.recordEvent(createAnalyticsEventDto, {
      ip: this.getClientIp(request, ip),
      userAgent: this.getHeader(request, 'user-agent'),
    });

    return { received: true };
  }

  @Get('summary')
  async getSummary(
    @Headers('authorization') authorization = '',
  ): Promise<Awaited<ReturnType<AnalyticsService['getSummary']>>> {
    this.assertDashboardAccess(authorization);

    return this.analyticsService.getSummary();
  }

  private getHeader(request: AnalyticsRequest, key: string): string {
    const value = request.headers?.[key];
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
  }

  private getClientIp(request: AnalyticsRequest, fallbackIp = ''): string {
    const forwardedFor = this.getHeader(request, 'x-forwarded-for');
    const forwardedIp = forwardedFor.split(',')[0]?.trim();
    const candidates = [
      this.getHeader(request, 'cf-connecting-ip'),
      this.getHeader(request, 'x-real-ip'),
      forwardedIp,
      fallbackIp,
    ];

    return candidates
      .map((candidate) => candidate.trim().replace(/^::ffff:/, ''))
      .find(Boolean) || '';
  }

  private assertDashboardAccess(authorization: string): void {
    const expectedUser =
      this.configService.get<string>('ANALYTICS_DASHBOARD_USER') || 'fr4ncev';
    const expectedPassword =
      this.configService.get<string>('ANALYTICS_DASHBOARD_PASSWORD') || 'Y3shu4';
    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Basic' || !token) {
      throw new UnauthorizedException('Analytics access requires authentication.');
    }

    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    const user = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : '';
    const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

    if (user !== expectedUser || password !== expectedPassword) {
      throw new UnauthorizedException('Invalid analytics credentials.');
    }
  }
}
