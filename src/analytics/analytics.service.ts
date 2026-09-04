import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendFile, readFile } from 'node:fs/promises';
import { CreateAnalyticsEventDto } from './dto/create-analytics-event.dto';

type AnalyticsEvent = {
  timestamp: string;
  name: string;
  clientId?: string;
  sessionId?: string;
  pagePath?: string;
  pageLocation?: string;
  referrer?: string;
  ip?: string;
  userAgent?: string;
  params?: Record<string, unknown>;
};

type AnalyticsMetric = {
  key: string;
  label: string;
  value: number;
};

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

  async getSummary(): Promise<{
    generatedAt: string;
    storage: {
      enabled: boolean;
      filePath: string;
      eventCount: number;
    };
    totals: AnalyticsMetric[];
    funnel: Array<AnalyticsMetric & { rateFromPrevious: number | null }>;
    conversionRate: number;
    checkoutAbandonmentRate: number;
    topPages: AnalyticsMetric[];
    topProducts: AnalyticsMetric[];
    checkoutErrors: AnalyticsMetric[];
    recentEvents: AnalyticsEvent[];
  }> {
    const events = await this.readStoredEvents();
    const countByName = this.countBy(events, (event) => event.name || 'unknown');
    const sessions = new Set(events.map((event) => event.sessionId).filter(Boolean));
    const clients = new Set(events.map((event) => event.clientId).filter(Boolean));
    const beginCheckout = countByName.begin_checkout || 0;
    const purchases = countByName.purchase || countByName.stripe_checkout_completed || 0;
    const abandoned = countByName.checkout_abandoned || countByName.stripe_checkout_expired || 0;
    const funnel = [
      this.createFunnelStep('page_view', 'Page views', countByName.page_view || 0, null),
      this.createFunnelStep('view_item', 'Product views', countByName.view_item || 0, countByName.page_view || 0),
      this.createFunnelStep('add_to_cart', 'Added to cart', countByName.add_to_cart || 0, countByName.view_item || 0),
      this.createFunnelStep('begin_checkout', 'Checkout started', beginCheckout, countByName.add_to_cart || 0),
      this.createFunnelStep('purchase', 'Purchases', purchases, beginCheckout),
    ];

    return {
      generatedAt: new Date().toISOString(),
      storage: {
        enabled: Boolean(this.analyticsEventsFile),
        filePath: this.analyticsEventsFile,
        eventCount: events.length,
      },
      totals: [
        { key: 'events', label: 'Events', value: events.length },
        { key: 'sessions', label: 'Sessions', value: sessions.size },
        { key: 'visitors', label: 'Visitors', value: clients.size },
        { key: 'purchases', label: 'Purchases', value: purchases },
        { key: 'abandoned', label: 'Checkout abandons', value: abandoned },
        { key: 'errors', label: 'Checkout errors', value: countByName.checkout_error || 0 },
      ],
      funnel,
      conversionRate: this.getRate(purchases, Math.max(1, countByName.view_item || countByName.page_view || 0)),
      checkoutAbandonmentRate: this.getRate(abandoned, beginCheckout + abandoned),
      topPages: this.toMetrics(this.countBy(events, (event) => event.pagePath || '/')),
      topProducts: this.toMetrics(this.countBy(events, (event) => this.getFirstItemName(event))),
      checkoutErrors: this.toMetrics(this.countBy(
        events.filter((event) => event.name === 'checkout_error'),
        (event) => String(event.params?.code || event.params?.message || 'checkout_error'),
      )),
      recentEvents: events.slice(-80).reverse(),
    };
  }

  private async writeEventFile(event: Record<string, unknown>): Promise<void> {
    const filePath = this.analyticsEventsFile;
    if (!filePath) return;

    try {
      await appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
    } catch (error) {
      this.logger.warn(
        `Could not write analytics event file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async readStoredEvents(): Promise<AnalyticsEvent[]> {
    if (!this.analyticsEventsFile) return [];

    try {
      const content = await readFile(this.analyticsEventsFile, 'utf8');
      return content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => this.parseStoredEvent(line))
        .filter((event): event is AnalyticsEvent => Boolean(event));
    } catch (error) {
      this.logger.warn(
        `Could not read analytics event file: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private parseStoredEvent(line: string): AnalyticsEvent | null {
    try {
      const event = JSON.parse(line) as AnalyticsEvent;
      return event?.name && event?.timestamp ? event : null;
    } catch {
      return null;
    }
  }

  private createFunnelStep(
    key: string,
    label: string,
    value: number,
    previousValue: number | null,
  ): AnalyticsMetric & { rateFromPrevious: number | null } {
    return {
      key,
      label,
      value,
      rateFromPrevious:
        previousValue && previousValue > 0 ? this.getRate(value, previousValue) : null,
    };
  }

  private countBy(
    events: AnalyticsEvent[],
    getKey: (event: AnalyticsEvent) => string,
  ): Record<string, number> {
    return events.reduce<Record<string, number>>((accumulator, event) => {
      const key = getKey(event) || 'unknown';
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {});
  }

  private toMetrics(counts: Record<string, number>, limit = 8): AnalyticsMetric[] {
    return Object.entries(counts)
      .filter(([key]) => key && key !== 'unknown')
      .sort((first, second) => second[1] - first[1])
      .slice(0, limit)
      .map(([key, value]) => ({
        key,
        label: key,
        value,
      }));
  }

  private getFirstItemName(event: AnalyticsEvent): string {
    const items = event.params?.items;
    if (!Array.isArray(items)) return '';

    const firstItem = items[0] as { item_name?: unknown } | undefined;
    return String(firstItem?.item_name || '');
  }

  private getRate(part: number, total: number): number {
    if (!total) return 0;
    return Number(((part / total) * 100).toFixed(1));
  }

  private get analyticsEventsFile(): string {
    return this.configService.get<string>('ANALYTICS_EVENTS_FILE') || '';
  }
}
