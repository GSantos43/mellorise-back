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
import { firstValueFrom } from 'rxjs';

@Injectable()
export class WooCommerceClient {
  private readonly logger = new Logger(WooCommerceClient.name);
  private readonly baseUrl: string;
  private readonly consumerKey: string;
  private readonly consumerSecret: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    const storeUrl = this.getRequiredConfig('WOOCOMMERCE_URL');

    this.baseUrl = `${storeUrl.replace(/\/$/, '')}/wp-json/wc/v3`;
    this.consumerKey = this.getRequiredConfig('WOOCOMMERCE_CONSUMER_KEY');
    this.consumerSecret = this.getRequiredConfig('WOOCOMMERCE_CONSUMER_SECRET');
  }

  async get<TResponse>(
    path: string,
    config: AxiosRequestConfig = {},
  ): Promise<TResponse> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<TResponse>(this.buildUrl(path), {
          ...config,
          auth: this.auth,
        }),
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
      const response = await firstValueFrom(
        this.httpService.post<TResponse>(this.buildUrl(path), body, {
          ...config,
          auth: this.auth,
        }),
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
      const response = await firstValueFrom(
        this.httpService.put<TResponse>(this.buildUrl(path), body, {
          ...config,
          auth: this.auth,
        }),
      );

      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  private get auth() {
    return {
      username: this.consumerKey,
      password: this.consumerSecret,
    };
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}/${path.replace(/^\//, '')}`;
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
