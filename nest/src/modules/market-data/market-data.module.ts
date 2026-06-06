import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ImportJobsModule } from '../import-jobs/import-jobs.module';
import { MarketDataController } from './market-data.controller';
import { MarketDataService } from './market-data.service';

@Module({
  imports: [DatabaseModule, ImportJobsModule],
  controllers: [MarketDataController],
  providers: [MarketDataService],
  exports: [MarketDataService],
})
export class MarketDataModule {}
