import { Global, Module } from '@nestjs/common';
import { SystemLogService } from './log.service';
import { SystemLogController } from './system-log.controller';
import { ProcessManagerService } from './process-manager.service';
import { ProcessManagerController } from './process-manager.controller';
import { DataFreshnessController } from './data-freshness.controller';
import { ArchitectureManifestController } from './architecture-manifest.controller';
import { DatabaseStatsController } from './database-stats.controller';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';  import { SettingsResolverService } from '../../common/settings/settings-resolver.service';
  import { SettingsRegistryController } from './settings-registry.controller';import { ScoringLogService } from './scoring-log.service';
import { ScoringLogController } from './scoring-log.controller';
import { MetricsMiddleware } from '../../common/middleware/metrics.middleware';
import { ProvidersModule } from '../providers/providers.module';
import { DirectivesModule } from '../directives/directives.module';
import { ScoringModule } from '../scoring/scoring.module';
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
import { FileInventoryService } from './file-inventory.service';
import { FileInventoryController } from './file-inventory.controller';
import { ConfigReloadController } from './config-reload.controller';
import { DevController } from './dev.controller';

@Global()
@Module({
  imports: [ProvidersModule, DirectivesModule, ScoringModule],
    providers: [SystemLogService, ProcessManagerService, SettingsService, SettingsResolverService, ScoringLogService, MetricsMiddleware, DataRetentionService, SystemHealthService, BacktestArchiveService, ConfigExportService, FileInventoryService],
    controllers: [SystemLogController, ProcessManagerController, DataFreshnessController, ArchitectureManifestController, DatabaseStatsController, SettingsController, SettingsRegistryController, ScoringLogController, DataRetentionController, SystemHealthController, BacktestArchiveController, PreferencesController, AutomationRulesController, ConfigExportController, FileInventoryController, ConfigReloadController, DevController],
    exports: [SystemLogService, ProcessManagerService, SettingsService, SettingsResolverService, ScoringLogService, MetricsMiddleware, DataRetentionService],
})
export class SystemModule {}
