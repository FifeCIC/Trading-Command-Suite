import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { TrendReadController } from './trend-read.controller';
import { TrendReadService } from './trend-read.service';

/**
 * TrendReadModule — the trend READING experiment (#1190).
 *
 * ⚠️ `MarketDataModule` is imported (not `PrismaService` alone) because the bar window must come
 * from `MarketDataService.getBars()`, the only loader that takes the LAST N bars. A hand-rolled
 * `orderBy asc, take N` returns the OLDEST N — the INV-BAR-WINDOW defect.
 */
@Module({
  imports: [DatabaseModule, MarketDataModule],
  controllers: [TrendReadController],
  providers: [TrendReadService],
  exports: [TrendReadService],
})
export class TrendReadModule {}
