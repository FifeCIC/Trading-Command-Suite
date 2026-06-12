import { Controller, Get, Post, Param, Query, Res, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ExportService } from './export.service';

@Controller('api/export')
export class ExportController {
  private readonly logger = new Logger(ExportController.name);

  constructor(private readonly exportService: ExportService) {}

  @Get('portfolio/csv')
  async portfolioCsv(@Res() res: Response): Promise<void> {
    // Mock portfolio data — replace with real portfolio service injection
    const data = [
      { symbol: 'AAPL', shares: 50, avgCost: 175.50, currentPrice: 198.32, value: 9916, pnl: 1141, pnlPct: 13.0 },
      { symbol: 'NVDA', shares: 30, avgCost: 420.00, currentPrice: 485.25, value: 14557.5, pnl: 1957.5, pnlPct: 15.5 },
    ];
    const csv = this.exportService.toCsv(data, ['symbol', 'shares', 'avgCost', 'currentPrice', 'value', 'pnl', 'pnlPct']);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="portfolio-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  }

  @Get('backtest/:runId/pdf')
  async backtestPdf(@Param('runId') runId: string, @Res() res: Response): Promise<void> {
    // TODO: fetch real backtest run and generate PDF via jspdf or puppeteer
    res.setHeader('Content-Type', 'application/json');
    res.json({ runId, status: 'PDF export not yet implemented — use CSV/JSON for now', format: 'pdf' });
  }

  @Get('scores/:date/json')
  async scoresJson(@Param('date') date: string, @Res() res: Response): Promise<void> {
    const json = this.exportService.toJson({
      date,
      scores: [
        { symbol: 'AAPL', score: 72, signal: 'buy' },
        { symbol: 'NVDA', score: 65, signal: 'buy' },
      ],
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="scores-${date}.json"`);
    res.send(json);
  }

  @Get('strategy/:id/share')
  async strategyShareCard(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const html = this.exportService.toScoreCardHtml({
      strategyName: 'Conviction Dip Accumulation',
      symbol: id.toUpperCase(),
      score: 72,
      signal: 'buy',
      date: new Date().toLocaleDateString(),
      url: `/trading/sees-live-stack`,
    });
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }
}
