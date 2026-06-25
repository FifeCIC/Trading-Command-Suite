/**
 * SeasonalityService — computes hour×day win rates from historical MT5 data.
 *
 * Groups 1m candles into a 7×24 grid (day-of-week × hour) and calculates
 * the percentage of candles that closed higher than they opened.
 */
import { Injectable, Logger } from '@nestjs/common';

const BRIDGE_URL = process.env.MT5_BRIDGE_URL || 'http://localhost:5001';

interface HeatmapCell {
  bullishPct: number;
  samples: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface SeasonalityResult {
  symbol: string;
  heatmap: number[][];  // 7×24 grid, 0.0 = 0% bullish, 1.0 = 100% bullish
  samples: number[][];  // 7×24 grid, sample count per cell
  computedAt: string;
  totalBars: number;
}

@Injectable()
export class SeasonalityService {
  private readonly logger = new Logger(SeasonalityService.name);

  async compute(symbol: string): Promise<SeasonalityResult> {
    const start = Date.now();
    const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const bullish: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const samples: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

    // Fetch 1m candles from NestJS proxy (which proxies MT5 bridge)
    let totalBars = 0;
    try {
      const res = await fetch(
        `http://localhost:3201/api/trading/mt5/candles?symbol=${encodeURIComponent(symbol)}&timeframe=1m&limit=2000`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const bars = data.bars || [];

      for (const bar of bars) {
        const ts = new Date(bar.timestamp);
        const day = ts.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
        const hour = ts.getUTCHours();
        const isBullish = bar.close > bar.open;

        samples[day][hour]++;
        if (isBullish) bullish[day][hour]++;
      }

      // Calculate win rates
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          heatmap[d][h] = samples[d][h] > 0
            ? Math.round((bullish[d][h] / samples[d][h]) * 100) / 100
            : 0;
        }
      }

      totalBars = bars.length;
    } catch (err) {
      this.logger.warn(`Seasonality: ${symbol} fetch failed — ${(err as Error).message}`);
    }

    const ms = Date.now() - start;
    this.logger.log(`Seasonality: ${symbol} — ${totalBars} bars, ${ms}ms`);

    return {
      symbol,
      heatmap,
      samples,
      computedAt: new Date().toISOString(),
      totalBars,
    };
  }
}
