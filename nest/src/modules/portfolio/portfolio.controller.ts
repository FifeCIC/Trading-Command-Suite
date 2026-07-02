import { Controller, Get, Query, Logger } from '@nestjs/common';
import { PortfolioService, PortfolioResponse } from './portfolio.service';
import { CorrelationService } from './correlation.service';
import { EarningsService } from '../earnings/earnings.service';
import { ExitSignalService } from './exit-signal.service';

@Controller('portfolio')
export class PortfolioController {
  private readonly logger = new Logger(PortfolioController.name);

  constructor(
    private readonly portfolioService: PortfolioService,
    private readonly correlationService: CorrelationService,
    private readonly earningsService: EarningsService,
    private readonly exitSignalService: ExitSignalService,
  ) {}

  @Get()
  async getPortfolio(@Query('source') source?: string, @Query('mode') mode?: string): Promise<PortfolioResponse> {
    return this.portfolioService.getPortfolio(source || 'trading212', mode);
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

  @Get('correlation')
  async getCorrelation(@Query('symbols') symbols?: string) {
    const symbolList = symbols ? symbols.split(',').map((s) => s.trim().toUpperCase()) : undefined;
    return this.correlationService.getMatrix(symbolList);
  }

  @Get('exposure')
  async getExposure() {
    return this.correlationService.getExposure();
  }

  @Get('exit-signals')
  async getExitSignals() {
    return this.exitSignalService.analyzeAll();
  }

  @Get('events')
  async getEvents(@Query('days') days?: string) {
    const lookaheadDays = days ? parseInt(days, 10) : 30;
    const portfolio = await this.portfolioService.getPortfolio('all');
    const positions = portfolio.positions ?? [];
    const symbols = positions.map((p: any) => p.symbol).filter(Boolean);

    const upcoming: any[] = [];
    const noData: string[] = [];

    for (const symbol of symbols) {
      try {
        const earningsData = await this.earningsService.getForSymbol(symbol);
        if (earningsData) {
          const earningsList = Array.isArray(earningsData) ? earningsData : [earningsData];
          const futureEarnings = earningsList.filter((e: any) => {
            const d = new Date(e.date || e.reportDate);
            const now = new Date();
            const diffDays = (d.getTime() - now.getTime()) / 86400000;
            return diffDays >= 0 && diffDays <= lookaheadDays;
          });
          if (futureEarnings.length > 0) {
            const pos = positions.find((p: any) => p.symbol === symbol);
            upcoming.push({
              symbol,
              position: pos ? { shares: pos.shares, value: pos.value, allocation: pos.allocation } : null,
              events: futureEarnings.map((e: any) => ({
                type: 'earnings',
                date: e.date || e.reportDate,
                time: e.time || e.reportTime || null,
                epsEstimate: e.epsEstimate || e.consensusEPS || null,
                revenueEstimate: e.revenueEstimate || null,
                daysUntil: Math.round(((new Date(e.date || e.reportDate)).getTime() - Date.now()) / 86400000),
              })),
            });
          }
        } else {
          noData.push(symbol);
        }
      } catch {
        noData.push(symbol);
      }
    }

    upcoming.sort((a, b) => (a.events[0]?.daysUntil ?? 999) - (b.events[0]?.daysUntil ?? 999));

    // Compute risk score for each position: earnings proximity × allocation
    const withRisk = upcoming.map((item) => {
      const daysUntil = item.events[0]?.daysUntil ?? 999;
      const allocation = item.position?.allocation ?? 0;

      // Risk score: closer earnings + higher allocation = higher risk
      const proximityRisk = daysUntil <= 7 ? 40 : daysUntil <= 14 ? 30 : daysUntil <= 30 ? 15 : 5;
      const allocationRisk = allocation > 15 ? 35 : allocation > 10 ? 25 : allocation > 5 ? 15 : 5;
      const riskScore = Math.min(100, proximityRisk + allocationRisk);

      let riskLevel: string;
      if (riskScore >= 60) riskLevel = 'HIGH';
      else if (riskScore >= 35) riskLevel = 'MEDIUM';
      else riskLevel = 'LOW';

      return {
        ...item,
        riskScore,
        riskLevel,
      };
    });

    const nextEarnings = upcoming.length > 0 ? { symbol: upcoming[0].symbol, date: upcoming[0].events[0].date, daysUntil: upcoming[0].events[0].daysUntil } : null;

    return {
      holdings: symbols.length,
      upcomingEvents: withRisk,
      nextEarnings,
      noData: [...new Set(noData)],
      riskSummary: {
        high: withRisk.filter((r) => r.riskLevel === 'HIGH').length,
        medium: withRisk.filter((r) => r.riskLevel === 'MEDIUM').length,
        low: withRisk.filter((r) => r.riskLevel === 'LOW').length,
      },
    };
  }
}
