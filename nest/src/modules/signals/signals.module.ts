import { Module } from '@nestjs/common';
import { SignalsService } from './signals.service';
import { SignalsController } from './signals.controller';
import { SignalEnvelopeService } from './signal-envelope.service';
import { ScoringModule } from '../scoring/scoring.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [ScoringModule, MarketDataModule, DatabaseModule],
  controllers: [SignalsController],
  providers: [SignalsService, SignalEnvelopeService],
  exports: [SignalsService, SignalEnvelopeService],
})
export class SignalsModule {}
