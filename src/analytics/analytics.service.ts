import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendFile } from 'node:fs/promises';
import { CreateAnalyticsEventDto } from './dto/create-analytics-event.dto';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly configService: ConfigService) {}

  async recordEvent(
    input: CreateAnalyticsEventDto,
    context: {
      ip?: string;
      userAgent?: string;
    } = {},
  ): Promise<void> {
    const event = {
      timestamp: new Date().toISOString(),
      name: input.name,
      clientId: input.clientId || '',
      sessionId: input.sessionId || '',
      pagePath: input.pagePath || '',
      pageLocation: input.pageLocation || '',
      referrer: input.referrer || '',
      ip: context.ip || '',
      userAgent: context.userAgent || '',
      params: input.params || {},
    };

    this.logger.log(`analytics ${event.name} ${JSON.stringify(event)}`);
    await this.writeEventFile(event);
  }

  async recordSystemEvent(
    name: CreateAnalyticsEventDto['name'],
    params: Record<string, unknown> = {},
  ): Promise<void> {
    await this.recordEvent({
      name,
      params,
    });
  }

  private async writeEventFile(event: Record<string, unknown>): Promise<void> {
    const filePath = this.configService.get<string>('ANALYTICS_EVENTS_FILE');
    if (!filePath) return;

    try {
      await appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
    } catch (error) {
      this.logger.warn(
        `Could not write analytics event file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
