import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ProvidersModule } from '../providers/providers.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { SymbolsModule } from '../symbols/symbols.module';
import { ModeService } from '../../config/mode.service';
import { ImportJobsController } from './import-jobs.controller';
import { ImportJobsService } from './import-jobs.service';
import { DataImportOrchestrator } from './data-import-orchestrator.service';

@Module({
  imports: [DatabaseModule, ProvidersModule, forwardRef(() => MarketDataModule), forwardRef(() => SymbolsModule)],
  controllers: [ImportJobsController],
  providers: [ImportJobsService, DataImportOrchestrator, ModeService],
  exports: [ImportJobsService, DataImportOrchestrator],
})
export class ImportJobsModule {}
