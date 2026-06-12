import { Module } from '@nestjs/common';
import { BacktestService } from './backtest.service';
import { BacktestController } from './backtest.controller';
import { DirectivesModule } from '../directives/directives.module';

@Module({
  imports: [DirectivesModule],
  providers: [BacktestService],
  controllers: [BacktestController],
})
export class BacktestModule {}
