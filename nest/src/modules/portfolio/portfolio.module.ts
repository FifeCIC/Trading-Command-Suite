import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { ScoringModule } from '../scoring/scoring.module';
import { Trading212Adapter } from '../providers/adapters/trading212.adapter';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { Trading212ImportService } from './trading212-import.service';
import { Trading212PortfolioController } from './trading212-portfolio.controller';
import { Trading212HistoryController } from './trading212-history.controller';

@Module({
  imports: [ProvidersModule, ScoringModule],
  controllers: [PortfolioController, Trading212PortfolioController, Trading212HistoryController],
  providers: [PortfolioService, Trading212Adapter, Trading212ImportService],
  exports: [PortfolioService],
})
export class PortfolioModule {}
