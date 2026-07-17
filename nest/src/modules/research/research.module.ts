import { Module } from '@nestjs/common';
import { ResearchController } from './research.controller';
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
  controllers: [ResearchController, InvestigationController],
  providers: [ResearchImportService, InvestigationService, ResearchOverviewService, AnalystTargetsService, RssScraperService, AlphaVantageNewsService, FinnhubNewsService],
  exports: [InvestigationService, ResearchImportService],
})
export class ResearchModule {}
