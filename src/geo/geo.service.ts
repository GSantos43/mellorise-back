import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

type HeaderValue = string | string[] | undefined;

type GeoRequest = {
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
  connection?: {
    remoteAddress?: string;
  };
  headers?: Record<string, HeaderValue>;
};

type IpApiResponse = {
  country_code?: string;
  country?: string;
  error?: boolean;
  success?: boolean;
  reason?: string;
  message?: string;
};

export type CheckoutEligibility = {
  allowed: boolean;
  countryCode: string | null;
  allowedCountries: string[];
  reason: string;
};

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);
  private readonly cache = new Map<string, { expiresAt: number; countryCode: string | null }>();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async getCheckoutEligibility(request: GeoRequest): Promise<CheckoutEligibility> {
    const allowedCountries = this.getAllowedCountries();
    const countryCode = await this.resolveCountryCode(request);

    if (!countryCode) {
      return {
        allowed: false,
        countryCode: null,
        allowedCountries,
        reason: 'country_unavailable',
      };
    }

    return {
      allowed: allowedCountries.includes(countryCode),
      countryCode,
      allowedCountries,
      reason: allowedCountries.includes(countryCode) ? 'allowed_country' : 'blocked_country',
    };
  }

  async assertCheckoutAllowed(request: GeoRequest): Promise<void> {
    const eligibility = await this.getCheckoutEligibility(request);

    if (eligibility.allowed) return;

    throw new ForbiddenException({
      message: 'MelloRise checkout is currently available only in the United States.',
      source: 'geo',
      countryCode: eligibility.countryCode,
      allowedCountries: eligibility.allowedCountries,
      reason: eligibility.reason,
    });
  }

  private async resolveCountryCode(request: GeoRequest): Promise<string | null> {
    const headerCountry = this.getCountryFromHeaders(request.headers);
    if (headerCountry) return headerCountry;

    const ipAddress = this.getClientIp(request);
    if (!ipAddress) return this.getDevelopmentCountry();

    if (this.isPrivateIp(ipAddress)) {
      return this.getDevelopmentCountry();
    }

    const cachedCountry = this.getCachedCountry(ipAddress);
    if (cachedCountry !== undefined) return cachedCountry;

    const countryCode = await this.lookupIpCountry(ipAddress);
    this.cacheCountry(ipAddress, countryCode);

    return countryCode;
  }

  private getCountryFromHeaders(headers: GeoRequest['headers']): string | null {
    const countryHeaders = [
      'cf-ipcountry',
      'x-vercel-ip-country',
      'cloudfront-viewer-country',
      'x-country-code',
      'x-appengine-country',
    ];

    for (const header of countryHeaders) {
      const value = this.getFirstHeader(headers?.[header] ?? headers?.[header.toUpperCase()]);
      const countryCode = this.normalizeCountryCode(value);
      if (countryCode && countryCode !== 'XX') return countryCode;
    }

    return null;
  }

  private getClientIp(request: GeoRequest): string | null {
    const forwardedFor = this.getFirstHeader(request.headers?.['x-forwarded-for']);
    const forwardedIp = forwardedFor?.split(',')[0]?.trim();
    const candidates = [
      this.getFirstHeader(request.headers?.['cf-connecting-ip']),
      this.getFirstHeader(request.headers?.['x-real-ip']),
      forwardedIp,
      request.ip,
      request.socket?.remoteAddress,
      request.connection?.remoteAddress,
    ];

    for (const candidate of candidates) {
      const ip = this.normalizeIp(candidate);
      if (ip) return ip;
    }

    return null;
  }

  private async lookupIpCountry(ipAddress: string): Promise<string | null> {
    const providerUrl = this.configService.get<string>('GEO_IP_PROVIDER_URL')?.trim() ||
      'https://ipwho.is/{ip}';
    const url = providerUrl.replace('{ip}', encodeURIComponent(ipAddress));

    try {
      const response = await firstValueFrom(
        this.httpService.get<IpApiResponse>(url, {
          timeout: this.getTimeoutMs(),
        }),
      );
      const countryCode = this.normalizeCountryCode(
        response.data.country_code || response.data.country,
      );

      if (!countryCode || response.data.error || response.data.success === false) {
        this.logger.warn(
          `IP geolocation failed for ${ipAddress}: ${response.data.reason || response.data.message || 'country unavailable'}`,
        );
        return null;
      }

      return countryCode;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`IP geolocation request failed for ${ipAddress}: ${message}`);
      return null;
    }
  }

  private getAllowedCountries(): string[] {
    const configuredCountries =
      this.configService.get<string>('GEO_ALLOWED_COUNTRIES') || 'US,BR';

    return configuredCountries
      .split(',')
      .map((country) => this.normalizeCountryCode(country))
      .filter(Boolean) as string[];
  }

  private getDevelopmentCountry(): string | null {
    if (this.configService.get<string>('NODE_ENV') === 'production') return null;

    return this.normalizeCountryCode(
      this.configService.get<string>('GEO_DEVELOPMENT_COUNTRY') || 'BR',
    );
  }

  private getCachedCountry(ipAddress: string): string | null | undefined {
    const cached = this.cache.get(ipAddress);
    if (!cached) return undefined;

    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(ipAddress);
      return undefined;
    }

    return cached.countryCode;
  }

  private cacheCountry(ipAddress: string, countryCode: string | null): void {
    this.cache.set(ipAddress, {
      countryCode,
      expiresAt: Date.now() + this.getCacheTtlMs(),
    });
  }

  private getCacheTtlMs(): number {
    const ttlMs = Number(this.configService.get('GEO_CACHE_TTL_MS') ?? 1000 * 60 * 60 * 12);
    return Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 1000 * 60 * 60 * 12;
  }

  private getTimeoutMs(): number {
    const timeoutMs = Number(this.configService.get('GEO_IP_TIMEOUT_MS') ?? 2500);
    return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 2500;
  }

  private getFirstHeader(value: HeaderValue): string {
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
  }

  private normalizeCountryCode(value?: string | null): string | null {
    const countryCode = String(value || '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(countryCode) ? countryCode : null;
  }

  private normalizeIp(value?: string | null): string | null {
    const ip = String(value || '')
      .trim()
      .replace(/^::ffff:/, '');

    if (!ip || ip === '::1') return ip ? '127.0.0.1' : null;

    return ip;
  }

  private isPrivateIp(ipAddress: string): boolean {
    return (
      ipAddress === '127.0.0.1' ||
      ipAddress === 'localhost' ||
      ipAddress.startsWith('10.') ||
      ipAddress.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(ipAddress) ||
      /^f[cd][0-9a-f]{2}:/i.test(ipAddress) ||
      ipAddress.startsWith('fe80:')
    );
  }
}
