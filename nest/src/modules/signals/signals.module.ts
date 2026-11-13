import { Module } from '@nestjs/common';
import { SignalsService } from './signals.service';
import { SignalsController } from './signals.controller';
import { SignalEnvelopeService } from './signal-envelope.service';
import { SignalActionsService } from './signal-actions.service';
import { SignalQueueService } from './signal-queue.service';
import { SignalOutcomeService } from './signal-outcome.service';
import { ManualTradeDefaultsService } from './manual-trade-defaults.service';
import { ScoringModule } from '../scoring/scoring.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { DatabaseModule } from '../../database/database.module';
import { TradingModule } from '../trading/trading.module';
import { DiversificationModule } from '../diversification/diversification.module';
import { ProvidersModule } from '../providers/providers.module';
// AlertsModule — SignalActionsService writes a durable alert when a manual trade is blocked
// (2026-09-23). No cycle: AlertsModule imports only Calendar + Providers.
import { AlertsModule } from '../alerts/alerts.module';
// #1264 — the data-starvation warning. `NotificationsModule` imports NOTHING (see its own header:
// an `imports: [SystemModule]` there breaks the boot), so this edge cannot create a cycle; the
// reverse direction — NotificationsModule reaching back into Signals — is what would.
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ScoringModule, MarketDataModule, DatabaseModule, TradingModule, DiversificationModule, ProvidersModule, AlertsModule, NotificationsModule],
  controllers: [SignalsController],
  providers: [SignalsService, SignalEnvelopeService, SignalActionsService, SignalQueueService, SignalOutcomeService, ManualTradeDefaultsService],
  exports: [SignalsService, SignalEnvelopeService, SignalActionsService, SignalQueueService, SignalOutcomeService, ManualTradeDefaultsService],
})
export class SignalsModule {}
