import { Module, Global } from '@nestjs/common';
import { DirectivesModule } from '../directives/directives.module';
import { CalibrationModule } from '../calibration/calibration.module';
import { SymbolDataCacheService } from './symbol-data-cache.service';
import { ProtocolRunnerService } from './protocol-runner.service';
import { ExecutionQueueService } from './execution-queue.service';
import { MultiProtocolRankingService } from './multi-protocol-ranking.service';
import { AutomationController } from './automation.controller';

@Global()
@Module({
  imports: [DirectivesModule, CalibrationModule],
  controllers: [AutomationController],
  providers: [SymbolDataCacheService, ProtocolRunnerService, ExecutionQueueService, MultiProtocolRankingService],
  exports: [SymbolDataCacheService, ProtocolRunnerService, ExecutionQueueService, MultiProtocolRankingService],
})
export class AutomationModule {}
