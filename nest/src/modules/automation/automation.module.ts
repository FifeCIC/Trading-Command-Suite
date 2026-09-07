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
import { AuthModule } from '../auth/auth.module';
import { SignalsModule } from '../signals/signals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SymbolDataCacheService } from './symbol-data-cache.service';
import { ProtocolRunnerService } from './protocol-runner.service';
import { ExecutionQueueService } from './execution-queue.service';
import { JobQueueService } from './job-queue.service';
import { JobQueueController } from './job-queue.controller';
import { AbTestService } from './ab-test.service';
import { MultiProtocolRankingService } from './multi-protocol-ranking.service';
import { TimelineService } from './timeline.service';
import { AutomationLoopService } from './automation-loop.service';
import { StopGuardianService } from './stop-guardian.service';
import { AuditLogService } from './audit-log.service';
import { AutomationController } from './automation.controller';
import { StopGuardianController } from './stop-guardian.controller';
import { TimelineController } from './timeline.controller';
import { AbTestController } from './ab-test.controller';

/**
 * AutomationModule is @Global() (2026-08-23).
 *
 * Reason: ResearchModule injects JobQueueService to schedule the earnings
 * import, but importing AutomationModule there created a module cycle
 * (Research → Automation → Directives → Research). Marking the module global
 * exposes its exports everywhere without a direct import edge.
 *
 * ⚠️ Consideration: global exports leak into the ENTIRE app. Keep this
 * `exports` list explicit and minimal — do not export services that are only
 * consumed inside the automation module.
 */
@Global()
@Module({
  imports: [DirectivesModule, CalibrationModule, ScoringModule, ProvidersModule, TradingModule, DiversificationModule, MarketDataModule, SymbolsModule, CalendarModule, AuthModule, SignalsModule, NotificationsModule],
  controllers: [AutomationController, StopGuardianController, TimelineController, AbTestController, JobQueueController],
  providers: [
    SymbolDataCacheService,
    ProtocolRunnerService,
    ExecutionQueueService,
    JobQueueService,
    AbTestService,
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
    JobQueueService,
    AbTestService,
    MultiProtocolRankingService,
    TimelineService,
    AutomationLoopService,
    StopGuardianService,
    AuditLogService,
  ],
})
export class AutomationModule {}
