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
import { MetricsMiddleware } from '../../common/middleware/metrics.middleware';
import { ProvidersModule } from '../providers/providers.module';

@Global()
@Module({
  imports: [ProvidersModule],
  providers: [SystemLogService, ProcessManagerService, SettingsService, MetricsMiddleware],
  controllers: [SystemLogController, ProcessManagerController, DataFreshnessController, ArchitectureManifestController, DatabaseStatsController, SettingsController],
  exports: [SystemLogService, ProcessManagerService, SettingsService, MetricsMiddleware],
})
export class SystemModule {}
