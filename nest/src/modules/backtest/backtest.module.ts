import { Module, forwardRef } from '@nestjs/common';
import { BacktestService } from './backtest.service';
import { BacktestPeriodService } from './backtest-period.service';
import { BacktestController } from './backtest.controller';
// 2026-11-01 — the directive PREVIEW (bars + indicator + divergences, nothing stored) for the Lab's
// chart panel. Its own controller because it is a read-only projection, not a backtest: no run row, no
// window guard, no comparison.
import { DirectivePreviewService } from './directive-preview.service';
import { DirectivePreviewController } from './directive-preview.controller';
import { DirectivesModule } from '../directives/directives.module';
import { ScoringModule } from '../scoring/scoring.module';
import { DatabaseModule } from '../../database/database.module';
// #986 — a period capture fetches an EXACT window, which the limit-based `getCandles()` cannot
// express, so it needs the provider adapters. ProvidersModule exports AdapterFactory.
import { ProvidersModule } from '../providers/providers.module';
// #1136 — the settings INVENTORY needs the declared settings registry (SettingsResolverService),
// which SystemModule owns. No cycle: SystemModule imports Providers/Directives/Scoring and nothing
// imports BacktestModule except ReplayModule and app.module.
import { SystemModule } from '../system/system.module';

@Module({
  imports: [DirectivesModule, forwardRef(() => ScoringModule), DatabaseModule, ProvidersModule, SystemModule],
  providers: [BacktestService, BacktestPeriodService, DirectivePreviewService],
  controllers: [BacktestController, DirectivePreviewController],
  exports: [BacktestPeriodService],
})
export class BacktestModule {}
