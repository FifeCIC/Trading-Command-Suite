/**
 * ScreenerModule — catalyst ingestion (#648).
 * Maps real news + earnings feeds into ScreenerHits for the Signals area.
 */
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { NewsModule } from '../news/news.module';
import { EarningsModule } from '../earnings/earnings.module';
import { ScreenerService } from './screener.service';
import { ScreenerController } from './screener.controller';

@Module({
  imports: [DatabaseModule, NewsModule, EarningsModule],
  controllers: [ScreenerController],
  providers: [ScreenerService],
  exports: [ScreenerService],
})
export class ScreenerModule {}
