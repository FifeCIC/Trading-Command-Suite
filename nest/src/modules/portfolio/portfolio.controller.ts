import { Controller, Get, Query, Logger } from '@nestjs/common';
import { PortfolioService, PortfolioResponse } from './portfolio.service';

@Controller('portfolio')
export class PortfolioController {
  private readonly logger = new Logger(PortfolioController.name);

  constructor(private readonly portfolioService: PortfolioService) {}

  @Get()
  async getPortfolio(@Query('source') source?: string): Promise<PortfolioResponse> {
    return this.portfolioService.getPortfolio(source || 'trading212');
  }

  @Get('holdings')
  async getHoldings(@Query('source') source?: string) {
    const data = await this.portfolioService.getPortfolio(source || 'all');
    return { source: source || 'all', positions: data.positions, summary: data.summary };
  }

  @Get('summary')
  async getSummary(@Query('source') source?: string) {
    const data = await this.portfolioService.getPortfolio(source || 'all');
    return { source: source || 'all', summary: data.summary };
  }

  @Get('scores')
  async getScores() {
    const scores = await this.portfolioService.getPortfolioScores();
    return { scores };
  }

  @Get('health')
  async health(): Promise<{ provider: string; credentials: boolean; mode: string }> {
    const data = await this.portfolioService.getPortfolio('trading212');
    return {
      provider: 'Trading212',
      credentials: data.summary.mode !== 'mock',
      mode: data.summary.mode,
    };
  }
}
