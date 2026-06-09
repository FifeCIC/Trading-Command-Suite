import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ImportJobsModule } from '../import-jobs/import-jobs.module';
import { FreshnessService } from './freshness.service';
import { MarketDataController } from './market-data.controller';
import { MarketDataService } from './market-data.service';

@Module({
  imports: [DatabaseModule, ImportJobsModule],
  controllers: [MarketDataController],
  providers: [MarketDataService, FreshnessService],
  exports: [MarketDataService, FreshnessService],
})
export class MarketDataModule {}
