import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { WetrackedService } from './wetracked.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, WetrackedService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
