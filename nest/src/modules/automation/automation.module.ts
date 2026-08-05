import { Module, Global } from '@nestjs/common';
import { DirectivesModule } from '../directives/directives.module';
import { CalibrationModule } from '../calibration/calibration.module';
import { ScoringModule } from '../scoring/scoring.module';
import { ProvidersModule } from '../providers/providers.module';
import { TradingModule } from '../trading/trading.module';
import { DiversificationModule } from '../diversification/diversification.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { SymbolsModule } from '../symbols/symbols.module';
import { CalendarModule } from '../calendar/calendar.module';
import { SymbolDataCacheService } from './symbol-data-cache.service';
import { ProtocolRunnerService } from './protocol-runner.service';
import { ExecutionQueueService } from './execution-queue.service';
import { MultiProtocolRankingService } from './multi-protocol-ranking.service';
import { TimelineService } from './timeline.service';
import { AutomationLoopService } from './automation-loop.service';
import { StopGuardianService } from './stop-guardian.service';
import { AuditLogService } from './audit-log.service';
import { AutomationController } from './automation.controller';
import { StopGuardianController } from './stop-guardian.controller';
import { TimelineController } from './timeline.controller';

@Global()
@Module({
  imports: [DirectivesModule, CalibrationModule, ScoringModule, ProvidersModule, TradingModule, DiversificationModule, MarketDataModule, SymbolsModule, CalendarModule],
  controllers: [AutomationController, StopGuardianController, TimelineController],
  providers: [
    SymbolDataCacheService,
    ProtocolRunnerService,
    ExecutionQueueService,
    MultiProtocolRankingService,
    TimelineService,
    AutomationLoopService,
    StopGuardianService,
    AuditLogService,
  ],
  exports: [
    SymbolDataCacheService,
    ProtocolRunnerService,
    ExecutionQueueService,
    MultiProtocolRankingService,
    TimelineService,
    AutomationLoopService,
    StopGuardianService,
    AuditLogService,
  ],
})
export class AutomationModule {}
