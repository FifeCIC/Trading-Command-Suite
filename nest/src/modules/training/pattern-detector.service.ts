/**
 * Pattern Detector Service
 * =========================
 * Calls existing candle pattern directives and aggregates their results
 * for the Candle Pattern Training Area.
 */

import { Injectable } from '@nestjs/common';
import { DojiPatternDirective } from '../directives/implementations/doji-pattern.directive';
import { EngulfingPatternDirective } from '../directives/implementations/engulfing-pattern.directive';
import { HammerPatternDirective } from '../directives/implementations/hammer-pattern.directive';
import { ThreeSoldiersPatternDirective } from '../directives/implementations/three-soldiers-pattern.directive';
import { Mt5EngulfingDirective } from '../directives/implementations/mt5-engulfing.directive';
import { Mt5HaramiDirective } from '../directives/implementations/mt5-harami.directive';
import { Mt5StarDojiDirective } from '../directives/implementations/mt5-star-doji.directive';
import { Mt5HammerDirective } from '../directives/implementations/mt5-hammer.directive';
import { MarketBar } from '../directives/interfaces/directive.interface';

export interface DetectedPattern {
  patternId: string;
  patternName: string;
  candleIndex: number;
  candleCount: number;
  direction: 'bullish' | 'bearish' | 'neutral';
  score: number;
  confidence: number;
  timestamp: Date;
  description: string;
}

@Injectable()
export class PatternDetectorService {
  // Pattern metadata registry
  private readonly patternMeta: Record<string, { name: string; candles: number; desc: string }> = {
    'doji-pattern': { name: 'Doji', candles: 1, desc: 'Open equals close — market indecision. Can signal reversal when appearing after a strong trend.' },
    'engulfing-pattern': { name: 'Engulfing', candles: 2, desc: 'Second candle fully engulfs the first. Strong reversal signal.' },
    'hammer-pattern': { name: 'Hammer', candles: 1, desc: 'Long lower wick with small body at top. Bullish reversal after downtrend.' },
    'three-soldiers-pattern': { name: 'Three Soldiers', candles: 3, desc: 'Three consecutive advancing candles. Strong bullish continuation or reversal.' },
    'mt5-engulfing': { name: 'Engulfing (MT5)', candles: 2, desc: 'MT5-optimized engulfing detection with volume confirmation.' },
    'mt5-harami': { name: 'Harami', candles: 2, desc: 'Small body inside previous large body. Reversal signal.' },
    'mt5-star-doji': { name: 'Star/Doji (MT5)', candles: 2, desc: 'Doji following a strong candle. Morning/Evening star pattern.' },
    'mt5-hammer': { name: 'Hammer (MT5)', candles: 1, desc: 'MT5-optimized hammer detection with trend context.' },
  };

  constructor(
    private readonly doji: DojiPatternDirective,
    private readonly engulfing: EngulfingPatternDirective,
    private readonly hammer: HammerPatternDirective,
    private readonly threeSoldiers: ThreeSoldiersPatternDirective,
    private readonly mt5Engulfing: Mt5EngulfingDirective,
    private readonly mt5Harami: Mt5HaramiDirective,
    private readonly mt5StarDoji: Mt5StarDojiDirective,
    private readonly mt5Hammer: Mt5HammerDirective,
  ) {}

  /**
   * Detect patterns across the entire bar series.
   * Runs each pattern directive on a sliding window to find patterns at each candle position.
   */
  detectPatterns(symbol: string, bars: MarketBar[]): DetectedPattern[] {
    if (bars.length < 5) return [];

    const patterns: DetectedPattern[] = [];
    const directives = [
      { id: 'doji-pattern', directive: this.doji, minBars: 5 },
      { id: 'engulfing-pattern', directive: this.engulfing, minBars: 5 },
      { id: 'hammer-pattern', directive: this.hammer, minBars: 5 },
      { id: 'three-soldiers-pattern', directive: this.threeSoldiers, minBars: 5 },
      { id: 'mt5-engulfing', directive: this.mt5Engulfing, minBars: 10 },
      { id: 'mt5-harami', directive: this.mt5Harami, minBars: 5 },
      { id: 'mt5-star-doji', directive: this.mt5StarDoji, minBars: 5 },
      { id: 'mt5-hammer', directive: this.mt5Hammer, minBars: 5 },
    ];

    // Slide a window across the bars to detect patterns at each position
    for (let endIdx = 4; endIdx < bars.length; endIdx++) {
      const windowBars = bars.slice(0, endIdx + 1);
      const lastBar = bars[endIdx];

      for (const { id, directive, minBars } of directives) {
        if (windowBars.length < minBars) continue;

        try {
          const result = directive.calculate({ symbol, bars: windowBars });

          // Only include if pattern was detected (score > 0 and reasonable confidence)
          if (result.score >= 20 && result.confidence > 0.4) {
            const meta = this.patternMeta[id];
            patterns.push({
              patternId: id,
              patternName: meta?.name ?? id,
              candleIndex: endIdx,
              candleCount: meta?.candles ?? 1,
              direction: result.signalClass ?? 'neutral',
              score: result.score,
              confidence: result.confidence,
              timestamp: lastBar.timestamp,
              description: meta?.desc ?? result.reason,
            });
          }
        } catch {
          // Skip directives that throw on insufficient data
        }
      }
    }

    // Deduplicate: keep strongest pattern per candle position
    return this.deduplicate(patterns);
  }

  private deduplicate(patterns: DetectedPattern[]): DetectedPattern[] {
    // Group by candle index, keep the one with highest score
    const map = new Map<number, DetectedPattern>();
    for (const p of patterns) {
      const existing = map.get(p.candleIndex);
      if (!existing || p.score > existing.score) {
        map.set(p.candleIndex, p);
      }
    }
    return [...map.values()].sort((a, b) => a.candleIndex - b.candleIndex);
  }
}
