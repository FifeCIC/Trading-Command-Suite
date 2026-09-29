import { Module, forwardRef } from '@nestjs/common';
import { BacktestService } from './backtest.service';
import { BacktestPeriodService } from './backtest-period.service';
import { BacktestController } from './backtest.controller';
import { DirectivesModule } from '../directives/directives.module';
import { ScoringModule } from '../scoring/scoring.module';
import { DatabaseModule } from '../../database/database.module';
// #986 — a period capture fetches an EXACT window, which the limit-based `getCandles()` cannot
// express, so it needs the provider adapters. ProvidersModule exports AdapterFactory.
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [DirectivesModule, forwardRef(() => ScoringModule), DatabaseModule, ProvidersModule],
  providers: [BacktestService, BacktestPeriodService],
  controllers: [BacktestController],
  exports: [BacktestPeriodService],
})
export class BacktestModule {}
