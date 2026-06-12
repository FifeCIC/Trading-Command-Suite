/**
 * Multi-Timeframe Composite Scorer
 * =================================
 * Scores a symbol across macro (daily), meso (1h), micro (15m) timeframes
 * and aggregates with weighted multipliers.
 *
 * Score = (W_macro × S_macro) + (W_meso × S_meso) + (W_micro × S_micro)
 *
 * Reference: docs/MULTI-TIMEFRAME-COMPOSITE-SCORING-PATTERN.md
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ema, rsi, macd } from '../directives/utils/indicators';

interface MarketBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TfSignal {
  score: number;       // -1 to +1
  label: string;       // "bullish", "bearish", "mixed"
  details: string[];
}

export interface MtfBreakdown {
  macro: TfSignal;
  meso: TfSignal;
  micro: TfSignal;
  compositeScore: number;
  compositeLabel: string;
  weighting: { macro: number; meso: number; micro: number };
}

const WEIGHTS = { macro: 0.50, meso: 0.35, micro: 0.15 };

@Injectable()
export class MultiTimeframeScorer {
  private readonly logger = new Logger(MultiTimeframeScorer.name);

  /** Load bars for a given symbol+timeframe combo */
  private async loadBars(
    prisma: PrismaService,
    symbolId: string,
    timeframe: string,
    limit: number,
  ): Promise<MarketBar[]> {
    if (!prisma.isAvailable) return [];
    try {
      return (await prisma.marketBar.findMany({
        where: { symbolId, timeframe },
        orderBy: { timestamp: 'asc' },
        take: limit,
      })) as MarketBar[];
    } catch {
      return [];
    }
  }

  /** Evaluate macro (daily) signal */
  private evaluateMacro(bars: MarketBar[]): TfSignal {
    if (bars.length < 200) {
      return { score: 0, label: 'insufficient', details: [`need 200 daily bars, have ${bars.length}`] };
    }

    const closes = bars.map(b => b.close);
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const ema200 = ema(closes, 200);

    if (ema20.length < 2 || ema50.length < 2 || ema200.length < 2) {
      return { score: 0, label: 'insufficient', details: ['could not calculate EMAs'] };
    }

    const price = closes[closes.length - 1];
    const above200 = price > ema200[ema200.length - 1];
    const ema20Above50 = ema20[ema20.length - 1] > ema50[ema50.length - 1];

    const details: string[] = [];
    if (above200) details.push('price above 200 EMA');
    else details.push('price below 200 EMA');
    if (ema20Above50) details.push('20 EMA > 50 EMA');
    else details.push('20 EMA < 50 EMA');

    if (above200 && ema20Above50) return { score: 1, label: 'bullish', details };
    if (!above200 && !ema20Above50) return { score: -1, label: 'bearish', details };
    return { score: 0, label: 'mixed', details };
  }

  /** Evaluate meso (1h) signal */
  private evaluateMeso(bars: MarketBar[]): TfSignal {
    if (bars.length < 50) {
      return { score: 0, label: 'insufficient', details: [`need 50 1h bars, have ${bars.length}`] };
    }

    const closes = bars.map(b => b.close);
    const ema50 = ema(closes, 50);
    const rsiValues = rsi(closes, 14);

    if (ema50.length < 2 || rsiValues.length < 2) {
      return { score: 0, label: 'insufficient', details: ['could not calculate indicators'] };
    }

    const price = closes[closes.length - 1];
    const above50 = price > ema50[ema50.length - 1];
    const rsiAbove50 = rsiValues[rsiValues.length - 1] > 50;

    const details: string[] = [];
    if (above50) details.push('price above 50 EMA');
    else details.push('price below 50 EMA');
    details.push(`RSI ${rsiValues[rsiValues.length - 1].toFixed(1)}`);

    if (above50 && rsiAbove50) return { score: 1, label: 'bullish', details };
    if (!above50 && !rsiAbove50) return { score: -1, label: 'bearish', details };
    return { score: 0, label: 'mixed', details };
  }

  /** Evaluate micro (15m) signal */
  private evaluateMicro(bars: MarketBar[]): TfSignal {
    if (bars.length < 30) {
      return { score: 0, label: 'insufficient', details: [`need 30 15m bars, have ${bars.length}`] };
    }

    const closes = bars.map(b => b.close);
    const { histogram } = macd(closes);

    if (histogram.length < 2) {
      return { score: 0, label: 'insufficient', details: ['could not calculate MACD'] };
    }

    const histNow = histogram[histogram.length - 1];
    const histPrev = histogram[histogram.length - 2];
    const positive = histNow > 0;
    const rising = histNow > histPrev;

    const details = [`MACD histogram ${histNow.toFixed(6)}`];
    if (rising) details.push('rising');

    if (positive && rising) return { score: 1, label: 'bullish', details };
    if (!positive) return { score: -1, label: 'bearish', details };
    return { score: 0, label: 'mixed', details };
  }

  /** Main entry: score a symbol across all available timeframes */
  async score(
    prisma: PrismaService,
    symbolId: string,
  ): Promise<MtfBreakdown | null> {
    const macro = await this.loadBars(prisma, symbolId, '1d', 250);
    const meso = await this.loadBars(prisma, symbolId, '1h', 100);
    const micro = await this.loadBars(prisma, symbolId, '15m', 50);

    const macroSignal = this.evaluateMacro(macro);
    const mesoSignal = this.evaluateMeso(meso);
    const microSignal = this.evaluateMicro(micro);

    // Only compute composite if at least 2 timeframes have sufficient data
    const validCount = [macroSignal, mesoSignal, microSignal].filter(s => s.label !== 'insufficient').length;
    if (validCount < 2) {
      this.logger.debug(`MTF: insufficient data for ${symbolId} (${validCount}/3 timeframes)`);
      return null;
    }

    const composite = macroSignal.score * WEIGHTS.macro +
                      mesoSignal.score * WEIGHTS.meso +
                      microSignal.score * WEIGHTS.micro;

    let compositeLabel: string;
    if (composite > 0.3) compositeLabel = 'bullish';
    else if (composite < -0.3) compositeLabel = 'bearish';
    else compositeLabel = 'neutral';

    return {
      macro: macroSignal,
      meso: mesoSignal,
      micro: microSignal,
      compositeScore: composite,
      compositeLabel,
      weighting: WEIGHTS,
    };
  }
}
