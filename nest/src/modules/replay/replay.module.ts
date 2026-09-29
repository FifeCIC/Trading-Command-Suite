import { Module } from '@nestjs/common';
import { ReplayController } from './replay.controller';
import { ReplayService } from './replay.service';
import { DatabaseModule } from '../../database/database.module';
import { DirectivesModule } from '../directives/directives.module';
import { ScoringModule } from '../scoring/scoring.module';
// #986 — the replay can walk a STORED PERIOD's window in one call, so it needs the resolver.
// One-directional: BacktestModule does not import ReplayModule, so there is no cycle.
import { BacktestModule } from '../backtest/backtest.module';

@Module({
  imports: [DatabaseModule, DirectivesModule, ScoringModule, BacktestModule],
  controllers: [ReplayController],
  providers: [ReplayService],
  exports: [ReplayService],
})
export class ReplayModule {}
