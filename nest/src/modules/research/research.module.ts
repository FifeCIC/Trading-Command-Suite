import { Module } from '@nestjs/common';
import { ResearchController } from './research.controller';
import { ResearchImportService } from './research-import.service';
import { ResearchOverviewService } from './research-overview.service';
import { InvestigationController } from './investigation.controller';
import { InvestigationService } from './investigation.service';
import { AnalystTargetsService } from './analyst-targets.service';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [ProvidersModule],
  controllers: [ResearchController, InvestigationController],
  providers: [ResearchImportService, InvestigationService, ResearchOverviewService, AnalystTargetsService],
  exports: [InvestigationService],
})
export class ResearchModule {}
