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
import { SystemHealthService } from './system-health.service';
import { SystemHealthController } from './system-health.controller';
import { BacktestArchiveService } from './backtest-archive.service';
import { BacktestArchiveController } from './backtest-archive.controller';
import { PreferencesController } from './preferences.controller';
import { AutomationRulesController } from './automation-rules.controller';
import { ConfigExportService } from './config-export.service';
import { ConfigExportController } from './config-export.controller';

@Global()
@Module({
  imports: [ProvidersModule],
  providers: [SystemLogService, ProcessManagerService, SettingsService, ScoringLogService, MetricsMiddleware, DataRetentionService, SystemHealthService, BacktestArchiveService, ConfigExportService],
  controllers: [SystemLogController, ProcessManagerController, DataFreshnessController, ArchitectureManifestController, DatabaseStatsController, SettingsController, ScoringLogController, DataRetentionController, SystemHealthController, BacktestArchiveController, PreferencesController, AutomationRulesController, ConfigExportController],
  exports: [SystemLogService, ProcessManagerService, SettingsService, ScoringLogService, MetricsMiddleware, DataRetentionService],
})
export class SystemModule {}
