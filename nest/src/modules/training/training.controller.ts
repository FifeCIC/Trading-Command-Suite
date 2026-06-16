import { Controller, Get, Query } from '@nestjs/common';
import { PatternDetectorService } from './pattern-detector.service';
import { MarketBar } from '../directives/interfaces/directive.interface';

@Controller('training')
export class TrainingController {
  constructor(private readonly patternDetector: PatternDetectorService) {}

  @Get('candle-patterns')
  async getCandlePatterns(
    @Query('symbol') symbol = 'EURUSD',
    @Query('bars') barsStr = '100',
  ) {
    const bars = parseInt(barsStr, 10) || 100;
    // Generate synthetic bar data — in production this comes from MT5 bridge
    const marketBars = this.generateSampleBars(symbol, bars);
    const patterns = this.patternDetector.detectPatterns(symbol, marketBars);
    return {
      symbol,
      barCount: marketBars.length,
      patternCount: patterns.length,
      patterns,
    };
  }

  @Get('candle-patterns/history')
  async getPatternHistory(
    @Query('symbol') symbol = 'EURUSD',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    // Generate a larger sample for history mode
    const bars = 200;
    const marketBars = this.generateSampleBars(symbol, bars);
    const patterns = this.patternDetector.detectPatterns(symbol, marketBars);
    return {
      symbol,
      from: from ?? '2026-01-01',
      to: to ?? '2026-06-01',
      barCount: marketBars.length,
      patternCount: patterns.length,
      patterns,
    };
  }

  @Get('pattern-accuracy/:patternId')
  async getPatternAccuracy() {
    // Placeholder — will read from Q215 accuracy tracking when available
    return {
      patternId: 'doji-pattern',
      totalOccurrences: 120,
      correctSignals: 74,
      accuracy: 0.62,
      note: 'Accuracy data from directive tracking (Q215). Placeholder until Q215 is implemented.',
    };
  }

  /**
   * Generate realistic synthetic bar data for chart rendering.
   * In production this is replaced with data from MT5 bridge or stored datasets.
   */
  private generateSampleBars(symbol: string, count: number): MarketBar[] {
    const bars: MarketBar[] = [];
    let price = symbol.includes('JPY') ? 150 : symbol.includes('XAU') ? 2300 : 1.08;
    const volatility = symbol.includes('XAU') ? 15 : symbol.includes('JPY') ? 0.5 : 0.002;
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      const open = price;
      const change = (Math.random() - 0.5) * volatility * 2;
      const close = open + change;
      const high = Math.max(open, close) + Math.random() * volatility * 0.5;
      const low = Math.min(open, close) - Math.random() * volatility * 0.5;
      const volume = Math.floor(Math.random() * 10000 + 5000);

      bars.push({
        timestamp: new Date(now - (count - i) * 3600000),
        open: Number(open.toFixed(5)),
        high: Number(high.toFixed(5)),
        low: Number(low.toFixed(5)),
        close: Number(close.toFixed(5)),
        volume,
      });

      price = close;
    }

    return bars;
  }
}
