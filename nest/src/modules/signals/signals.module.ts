import { Module } from '@nestjs/common';
import { SignalsService } from './signals.service';
import { SignalsController } from './signals.controller';
import { SignalEnvelopeService } from './signal-envelope.service';
import { SignalActionsService } from './signal-actions.service';
import { SignalQueueService } from './signal-queue.service';
import { ScoringModule } from '../scoring/scoring.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { DatabaseModule } from '../../database/database.module';
import { TradingModule } from '../trading/trading.module';
import { DiversificationModule } from '../diversification/diversification.module';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [ScoringModule, MarketDataModule, DatabaseModule, TradingModule, DiversificationModule, ProvidersModule],
  controllers: [SignalsController],
  providers: [SignalsService, SignalEnvelopeService, SignalActionsService, SignalQueueService],
  exports: [SignalsService, SignalEnvelopeService, SignalActionsService, SignalQueueService],
})
export class SignalsModule {}
