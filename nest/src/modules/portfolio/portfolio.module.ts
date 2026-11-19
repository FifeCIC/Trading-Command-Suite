import { Module, forwardRef } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { ScoringModule } from '../scoring/scoring.module';
import { TradingModule } from '../trading/trading.module';
import { EarningsModule } from '../earnings/earnings.module';
import { IsaModule } from '../isa/isa.module';
import { Trading212Adapter } from '../providers/adapters/trading212.adapter';
import { PortfolioService } from './portfolio.service';
import { PortfolioPriceService } from './portfolio-price.service';
import { PortfolioController } from './portfolio.controller';
import { Trading212ImportService } from './trading212-import.service';
import { PortfolioAccountsService } from './portfolio-accounts.service';
import { Trading212PortfolioController } from './trading212-portfolio.controller';
import { Trading212HistoryController } from './trading212-history.controller';
import { PortfolioAccountsController } from './portfolio-accounts.controller';
import { CorrelationService } from './correlation.service';
import { ExitSignalService } from './exit-signal.service';
import { T212ReferenceModule } from './t212-reference.module';

@Module({
  imports: [ProvidersModule, EarningsModule, IsaModule, T212ReferenceModule, forwardRef(() => ScoringModule), forwardRef(() => TradingModule)],
  controllers: [PortfolioController, Trading212PortfolioController, Trading212HistoryController, PortfolioAccountsController],
  providers: [PortfolioService, PortfolioPriceService, Trading212Adapter, Trading212ImportService, PortfolioAccountsService, CorrelationService, ExitSignalService],
  exports: [PortfolioService, PortfolioPriceService, ExitSignalService],
})
export class PortfolioModule {}
