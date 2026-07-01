import { Module } from '@nestjs/common';
import { ResearchController } from './research.controller';
import { ResearchImportService } from './research-import.service';
import { InvestigationController } from './investigation.controller';
import { InvestigationService } from './investigation.service';
import { FinnhubAdapter } from '../providers/adapters/finnhub.adapter';

@Module({
  controllers: [ResearchController, InvestigationController],
  providers: [FinnhubAdapter, ResearchImportService, InvestigationService],
  exports: [InvestigationService],
})
export class ResearchModule {}
