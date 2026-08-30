import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WiioService } from './wiio.service';

@Module({
  imports: [
    ConfigModule,
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        timeout: Number(configService.get('WIIO_TIMEOUT_MS') ?? 10000),
        maxRedirects: 3,
      }),
    }),
  ],
  providers: [WiioService],
  exports: [WiioService],
})
export class FulfillmentModule {}
