import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { WooCommerceClient } from './woocommerce.client';

@Module({
  imports: [
    ConfigModule,
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        timeout: Number(configService.get('WOOCOMMERCE_TIMEOUT_MS') ?? 8000),
        maxRedirects: 3,
      }),
    }),
  ],
  providers: [WooCommerceClient],
  exports: [WooCommerceClient],
})
export class WooCommerceModule {}
