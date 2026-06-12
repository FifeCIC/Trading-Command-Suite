import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { Trading212Adapter } from '../providers/adapters/trading212.adapter';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';

@Module({
  imports: [ProvidersModule],
  controllers: [PortfolioController],
  providers: [PortfolioService, Trading212Adapter],
  exports: [PortfolioService],
})
export class PortfolioModule {}
