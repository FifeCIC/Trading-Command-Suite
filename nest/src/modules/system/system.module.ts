import { Global, Module } from '@nestjs/common';
import { SystemLogService } from './log.service';
import { SystemLogController } from './system-log.controller';
import { ProcessManagerService } from './process-manager.service';
import { ProcessManagerController } from './process-manager.controller';
import { DataFreshnessController } from './data-freshness.controller';
import { ArchitectureManifestController } from './architecture-manifest.controller';
import { DatabaseStatsController } from './database-stats.controller';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { ScoringLogService } from './scoring-log.service';
import { ScoringLogController } from './scoring-log.controller';
import { MetricsMiddleware } from '../../common/middleware/metrics.middleware';
import { ProvidersModule } from '../providers/providers.module';
import { DataRetentionService } from './data-retention.service';
import { DataRetentionController } from './data-retention.controller';

@Global()
@Module({
  imports: [ProvidersModule],
  providers: [SystemLogService, ProcessManagerService, SettingsService, ScoringLogService, MetricsMiddleware, DataRetentionService],
  controllers: [SystemLogController, ProcessManagerController, DataFreshnessController, ArchitectureManifestController, DatabaseStatsController, SettingsController, ScoringLogController, DataRetentionController],
  exports: [SystemLogService, ProcessManagerService, SettingsService, ScoringLogService, MetricsMiddleware, DataRetentionService],
})
export class SystemModule {}
