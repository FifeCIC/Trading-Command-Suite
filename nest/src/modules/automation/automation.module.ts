import { Module, Global } from '@nestjs/common';
import { DirectivesModule } from '../directives/directives.module';
import { CalibrationModule } from '../calibration/calibration.module';
import { ScoringModule } from '../scoring/scoring.module';
import { ProvidersModule } from '../providers/providers.module';
import { SymbolDataCacheService } from './symbol-data-cache.service';
import { ProtocolRunnerService } from './protocol-runner.service';
import { ExecutionQueueService } from './execution-queue.service';
import { MultiProtocolRankingService } from './multi-protocol-ranking.service';
import { TimelineService } from './timeline.service';
import { AutomationController } from './automation.controller';
import { TimelineController } from './timeline.controller';

@Global()
@Module({
  imports: [DirectivesModule, CalibrationModule, ScoringModule, ProvidersModule],
  controllers: [AutomationController, TimelineController],
  providers: [
    SymbolDataCacheService,
    ProtocolRunnerService,
    ExecutionQueueService,
    MultiProtocolRankingService,
    TimelineService,
  ],
  exports: [
    SymbolDataCacheService,
    ProtocolRunnerService,
    ExecutionQueueService,
    MultiProtocolRankingService,
    TimelineService,
  ],
})
export class AutomationModule {}
