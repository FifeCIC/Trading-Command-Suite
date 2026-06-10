import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { DirectivesModule } from '../directives/directives.module';
import { StrategiesModule } from '../strategies/strategies.module';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';

@Module({
  imports: [DatabaseModule, MarketDataModule, DirectivesModule, StrategiesModule],
  controllers: [ScoringController],
  providers: [ScoringService],
  exports: [ScoringService],
})
export class ScoringModule {}
