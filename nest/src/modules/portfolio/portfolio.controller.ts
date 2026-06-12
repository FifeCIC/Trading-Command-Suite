import { Controller, Get, Logger } from '@nestjs/common';
import { PortfolioService, PortfolioResponse } from './portfolio.service';

@Controller('portfolio')
export class PortfolioController {
  private readonly logger = new Logger(PortfolioController.name);

  constructor(private readonly portfolioService: PortfolioService) {}

  @Get()
  async getPortfolio(): Promise<PortfolioResponse> {
    return this.portfolioService.getPortfolio();
  }

  @Get('health')
  async health(): Promise<{ provider: string; credentials: boolean; mode: string }> {
    const data = await this.portfolioService.getPortfolio();
    return {
      provider: 'Trading212',
      credentials: data.summary.mode !== 'mock',
      mode: data.summary.mode,
    };
  }
}
