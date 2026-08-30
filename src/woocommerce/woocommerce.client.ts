import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { createHmac, randomBytes } from 'crypto';
import { firstValueFrom } from 'rxjs';

type QueryParamValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean | null | undefined>;

@Injectable()
export class WooCommerceClient {
  private readonly logger = new Logger(WooCommerceClient.name);
  private readonly storeUrl: string;
  private readonly consumerKey: string;
  private readonly consumerSecret: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    const storeUrl = this.getRequiredConfig('WOOCOMMERCE_URL');

    this.storeUrl = storeUrl.replace(/\/$/, '');
    this.consumerKey = this.getRequiredConfig('WOOCOMMERCE_CONSUMER_KEY');
    this.consumerSecret = this.getRequiredConfig('WOOCOMMERCE_CONSUMER_SECRET');
  }

  async get<TResponse>(
    path: string,
    config: AxiosRequestConfig = {},
  ): Promise<TResponse> {
    try {
      const { params, ...requestConfig } = config;
      const response = await firstValueFrom(
        this.httpService.get<TResponse>(
          this.buildUrl('GET', 'wc/v3', path, params),
          requestConfig,
        ),
      );

      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getStore<TResponse>(
    path: string,
    config: AxiosRequestConfig = {},
  ): Promise<TResponse> {
    try {
      const { params, ...requestConfig } = config;
      const response = await firstValueFrom(
        this.httpService.get<TResponse>(
          this.buildStoreUrl('wc/store/v1', path, params),
          requestConfig,
        ),
      );

      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  async post<TResponse, TBody = unknown>(
    path: string,
    body: TBody,
    config: AxiosRequestConfig = {},
  ): Promise<TResponse> {
    try {
      const { params, ...requestConfig } = config;
      const response = await firstValueFrom(
        this.httpService.post<TResponse>(
          this.buildUrl('POST', 'wc/v3', path, params),
          body,
          requestConfig,
        ),
      );

      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  async put<TResponse, TBody = unknown>(
    path: string,
    body: TBody,
    config: AxiosRequestConfig = {},
  ): Promise<TResponse> {
    try {
      const { params, ...requestConfig } = config;
      const response = await firstValueFrom(
        this.httpService.put<TResponse>(
          this.buildUrl('PUT', 'wc/v3', path, params),
          body,
          requestConfig,
        ),
      );

      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  private buildStoreUrl(
    namespace: string,
    path: string,
    params?: AxiosRequestConfig['params'],
  ): string {
    const route = `/${namespace.replace(/^\/|\/$/g, '')}/${path.replace(/^\//, '')}`;
    const url = new URL('/index.php', this.storeUrl);
    url.searchParams.set('rest_route', route);
    this.appendParams(url, params);

    return url.toString();
  }

  private buildUrl(
    method: string,
    namespace: string,
    path: string,
    params?: AxiosRequestConfig['params'],
  ): string {
    const route = `/${namespace.replace(/^\/|\/$/g, '')}/${path.replace(/^\//, '')}`;
    const url = new URL('/index.php', this.storeUrl);
    url.searchParams.set('rest_route', route);
    this.appendParams(url, params);
    this.appendOAuthSignature(url, method);

    return url.toString();
  }

  private appendParams(url: URL, params?: AxiosRequestConfig['params']): void {
    if (!params || typeof params !== 'object') return;

    Object.entries(params as Record<string, QueryParamValue>).forEach(
      ([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach((item) => this.appendParam(url, key, item));
          return;
        }

        this.appendParam(url, key, value);
      },
    );
  }

  private appendParam(
    url: URL,
    key: string,
    value: string | number | boolean | null | undefined,
  ): void {
    if (value === undefined || value === null) return;

    url.searchParams.append(key, String(value));
  }

  private appendOAuthSignature(url: URL, method: string): void {
    url.searchParams.set('oauth_consumer_key', this.consumerKey);
    url.searchParams.set('oauth_nonce', randomBytes(16).toString('hex'));
    url.searchParams.set('oauth_signature_method', 'HMAC-SHA256');
    url.searchParams.set('oauth_timestamp', String(Math.floor(Date.now() / 1000)));

    const signature = this.createOAuthSignature(url, method);
    url.searchParams.set('oauth_signature', signature);
  }

  private createOAuthSignature(url: URL, method: string): string {
    const baseUrl = `${url.origin}${url.pathname}`;
    const normalizedParams = [...url.searchParams.entries()]
      .filter(([key]) => key !== 'oauth_signature')
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        const keyComparison = leftKey.localeCompare(rightKey);
        return keyComparison || leftValue.localeCompare(rightValue);
      })
      .map(
        ([key, value]) =>
          `${this.percentEncode(key)}=${this.percentEncode(value)}`,
      )
      .join('&');
    const signatureBase = [
      method.toUpperCase(),
      this.percentEncode(baseUrl),
      this.percentEncode(normalizedParams),
    ].join('&');
    const signingKey = `${this.percentEncode(this.consumerSecret)}&`;

    return createHmac('sha256', signingKey).update(signatureBase).digest('base64');
  }

  private percentEncode(value: string): string {
    return encodeURIComponent(value)
      .replace(/[!'()*]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      );
  }

  private getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key);

    if (!value) {
      throw new InternalServerErrorException(
        `Missing required environment variable: ${key}`,
      );
    }

    return value;
  }

  private handleError(error: unknown): never {
    const axiosError = error as AxiosError<{ message?: string }>;
    const statusCode = axiosError.response?.status;
    const wooCommerceMessage = axiosError.response?.data?.message;

    this.logger.error(
      `WooCommerce request failed: ${axiosError.message}`,
      JSON.stringify({
        code: axiosError.code,
        statusCode,
        wooCommerceMessage,
      }),
    );

    if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
      throw new GatewayTimeoutException({
        message: 'WooCommerce demorou para responder. Tente novamente.',
        source: 'woocommerce',
      });
    }

    if (!axiosError.response) {
      throw new BadGatewayException({
        message: 'WooCommerce indisponivel no momento. Tente novamente.',
        source: 'woocommerce',
      });
    }

    if (statusCode && statusCode >= 500) {
      throw new BadGatewayException({
        message: 'WooCommerce falhou ao processar a solicitacao.',
        source: 'woocommerce',
      });
    }

    throw new HttpException(
      {
        message: 'Dados rejeitados pelo WooCommerce.',
        source: 'woocommerce',
      },
      statusCode ?? HttpStatus.BAD_GATEWAY,
    );
  }
}
