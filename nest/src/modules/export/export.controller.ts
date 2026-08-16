import { Controller, Get, Post, Param, Query, Res, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ExportService } from './export.service';

@Controller('export')
export class ExportController {
  private readonly logger = new Logger(ExportController.name);

  constructor(private readonly exportService: ExportService) {}

  @Get('portfolio/csv')
  async portfolioCsv(@Res() res: Response): Promise<void> {
    // No fabricated data — empty export until the real portfolio service is wired in.
    const data: Array<Record<string, any>> = [];
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
      scores: [],
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="scores-${date}.json"`);
    res.send(json);
  }

  @Get('strategy/:id/share')
  async strategyShareCard(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const html = this.exportService.toScoreCardHtml({
      strategyName: 'Strategy', // STUB — placeholder until real strategy data is wired
      symbol: id.toUpperCase(),
      score: 0,
      signal: 'hold',
      date: new Date().toLocaleDateString(),
      url: `/trading/sees-live-stack`,
    });
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }
}
