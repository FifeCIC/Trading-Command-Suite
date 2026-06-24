import { Module, forwardRef } from '@nestjs/common';
import { BacktestService } from './backtest.service';
import { BacktestController } from './backtest.controller';
import { DirectivesModule } from '../directives/directives.module';
import { ScoringModule } from '../scoring/scoring.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DirectivesModule, forwardRef(() => ScoringModule), DatabaseModule],
  providers: [BacktestService],
  controllers: [BacktestController],
})
export class BacktestModule {}
