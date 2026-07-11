import { Module, Global } from '@nestjs/common';
import { DirectivesModule } from '../directives/directives.module';
import { CalibrationModule } from '../calibration/calibration.module';
import { ScoringModule } from '../scoring/scoring.module';
import { ProvidersModule } from '../providers/providers.module';
import { TradingModule } from '../trading/trading.module';
import { SymbolDataCacheService } from './symbol-data-cache.service';
import { ProtocolRunnerService } from './protocol-runner.service';
import { ExecutionQueueService } from './execution-queue.service';
import { MultiProtocolRankingService } from './multi-protocol-ranking.service';
import { TimelineService } from './timeline.service';
import { AutomationLoopService } from './automation-loop.service';
import { StopGuardianService } from './stop-guardian.service';
import { AutomationController } from './automation.controller';
import { StopGuardianController } from './stop-guardian.controller';
import { TimelineController } from './timeline.controller';

@Global()
@Module({
  imports: [DirectivesModule, CalibrationModule, ScoringModule, ProvidersModule, TradingModule],
  controllers: [AutomationController, StopGuardianController, TimelineController],
  providers: [
    SymbolDataCacheService,
    ProtocolRunnerService,
    ExecutionQueueService,
    MultiProtocolRankingService,
    TimelineService,
    AutomationLoopService,
    StopGuardianService,
  ],
  exports: [
    SymbolDataCacheService,
    ProtocolRunnerService,
    ExecutionQueueService,
    MultiProtocolRankingService,
    TimelineService,
    AutomationLoopService,
    StopGuardianService,
  ],
})
export class AutomationModule {}
