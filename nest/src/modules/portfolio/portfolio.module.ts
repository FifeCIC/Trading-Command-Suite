import { Module, forwardRef } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { ScoringModule } from '../scoring/scoring.module';
import { TradingModule } from '../trading/trading.module';
import { EarningsModule } from '../earnings/earnings.module';
import { Trading212Adapter } from '../providers/adapters/trading212.adapter';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { Trading212ImportService } from './trading212-import.service';
import { Trading212PortfolioController } from './trading212-portfolio.controller';
import { Trading212HistoryController } from './trading212-history.controller';
import { CorrelationService } from './correlation.service';

@Module({
  imports: [ProvidersModule, EarningsModule, forwardRef(() => ScoringModule), forwardRef(() => TradingModule)],
  controllers: [PortfolioController, Trading212PortfolioController, Trading212HistoryController],
  providers: [PortfolioService, Trading212Adapter, Trading212ImportService, CorrelationService],
  exports: [PortfolioService],
})
export class PortfolioModule {}
