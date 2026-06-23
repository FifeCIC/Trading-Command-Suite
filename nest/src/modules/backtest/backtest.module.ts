import { Module } from '@nestjs/common';
import { BacktestService } from './backtest.service';
import { BacktestController } from './backtest.controller';
import { DirectivesModule } from '../directives/directives.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DirectivesModule, DatabaseModule],
  providers: [BacktestService],
  controllers: [BacktestController],
})
export class BacktestModule {}
