import { Module } from '@nestjs/common';
import { ResearchController } from './research.controller';
import { ResearchNotesController } from './research-notes.controller';
import { ResearchNotesService } from './research-notes.service';
import { ResearchImportService } from './research-import.service';
import { ResearchOverviewService } from './research-overview.service';
import { InvestigationController } from './investigation.controller';
import { InvestigationService } from './investigation.service';
import { AnalystTargetsService } from './analyst-targets.service';
import { RssScraperService } from './rss-scraper.service';
import { AlphaVantageNewsService } from './alpha-vantage-news.service';
import { FinnhubNewsService } from './finnhub-news.service';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [ProvidersModule],
  controllers: [ResearchController, ResearchNotesController, InvestigationController],
  providers: [ResearchImportService, InvestigationService, ResearchOverviewService, AnalystTargetsService, RssScraperService, AlphaVantageNewsService, FinnhubNewsService, ResearchNotesService],
  exports: [InvestigationService, ResearchImportService],
})
export class ResearchModule {}
