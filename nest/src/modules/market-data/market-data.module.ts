import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ImportJobsModule } from '../import-jobs/import-jobs.module';
import { ProvidersModule } from '../providers/providers.module';
import { FreshnessService } from './freshness.service';
import { PriceRefreshService } from './price-refresh.service';
import { BarRefreshService } from './bar-refresh.service';
import { MarketDataController } from './market-data.controller';
import { MarketDataService } from './market-data.service';

@Module({
  imports: [DatabaseModule, ImportJobsModule, ProvidersModule],
  controllers: [MarketDataController],
  providers: [MarketDataService, FreshnessService, PriceRefreshService, BarRefreshService],
  exports: [MarketDataService, FreshnessService, PriceRefreshService, BarRefreshService],
})
export class MarketDataModule {}
