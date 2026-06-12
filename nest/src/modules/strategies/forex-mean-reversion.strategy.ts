/**
 * Forex Mean Reversion Strategy
 * ==============================
 * CFD-based long/short strategy for forex pairs using MT5 data.
 * Combines mean reversion + momentum + candlestick directives
 * with explicit buy/sell/flat signal generation.
 *
 * Strategy Parameters:
 *   - Entry threshold: 60+ → long (buy CFD)
 *   - Entry threshold: 60+ with bearish bias → short (sell CFD)
 *   - Flat zone: < 60 → no position
 *   - Max pairs: 4 simultaneously
 *   - Max drawdown: 2% per pair
 *   - Timeframes: 1H (trade), 4H (trend bias), Daily (regime)
 *
 * Weights (sum = 100):
 *   rsi-oversold:             20  — Mean reversion trigger
 *   macd-crossover:           18  — Trend shift detection
 *   ema-structure:            16  — Trend alignment check
 *   bollinger-band-squeeze:   14  — Volatility breakout (forex classic)
 *   atr-dip:                  12  — Pullback quality
 *   support-resistance-levels:10  — S/R levels (forex respects these)
 *   hammer-pattern:            5  — Reversal candlestick
 *   engulfing-pattern:         5  — Reversal candlestick
 */

import { DirectiveResult } from '../directives/interfaces/directive.interface';

/** Canonical names for breakdown display. */
const DIRECTIVE_NAMES: Record<string, string> = {
  'rsi-oversold': 'RSI Oversold Reversion',
  'macd-crossover': 'MACD Bullish Crossover',
  'ema-structure': 'Price Above EMA Structure',
  'bollinger-band-squeeze': 'Bollinger Band Squeeze',
  'atr-dip': 'ATR Normalized Dip',
  'support-resistance-levels': 'Support & Resistance Levels',
  'hammer-pattern': 'Hammer Pattern',
  'engulfing-pattern': 'Engulfing Pattern',
};

export interface ForexWeight {
  directiveId: string;
  weight: number;
}

export interface ForexBreakdownItem {
  directiveId: string;
  name: string;
  rawScore: number;
  weight: number;
  contribution: number;
}

export interface ForexSignal {
  type: 'buy' | 'sell' | 'flat';
  reason: string;
}

export interface ForexScore {
  strategyId: string;
  strategyName: string;
  symbolId: string;
  pair: string;
  totalScore: number;
  normalizedScore: number;
  confidence: number;
  signal: ForexSignal;
  breakdown: ForexBreakdownItem[];
  timeframe: string;
  timestamp: string;
}

/** Strategy weights — sum must equal 100. */
export const FOREX_WEIGHTS: ForexWeight[] = [
  { directiveId: 'rsi-oversold', weight: 20 },
  { directiveId: 'macd-crossover', weight: 18 },
  { directiveId: 'ema-structure', weight: 16 },
  { directiveId: 'bollinger-band-squeeze', weight: 14 },
  { directiveId: 'atr-dip', weight: 12 },
  { directiveId: 'support-resistance-levels', weight: 10 },
  { directiveId: 'hammer-pattern', weight: 5 },
  { directiveId: 'engulfing-pattern', weight: 5 },
];

export const FOREX_STRATEGY_CONFIG = {
  id: 'forex-mean-reversion',
  name: 'Forex Mean Reversion',
  entryThreshold: 60,
  /** Score above which a strong directional signal overrides flat. */
  strongSignalThreshold: 75,
  scope: ['forex'],
  maxPairs: 4,
  maxDrawdownPercent: 2,
  timeframes: {
    trade: '1h',
    trendBias: '4h',
    regime: '1d',
  },
};

/**
 * Determine the directional bias from directive results.
 * Uses EMA structure and RSI to derive bias.
 */
function deriveBias(results: Map<string, DirectiveResult>): 'bullish' | 'bearish' | 'neutral' {
  const emaResult = results.get('ema-structure');
  const rsiResult = results.get('rsi-oversold');

  const emaScore = emaResult?.score ?? 50;
  const rsiScore = rsiResult?.score ?? 50;

  // EMA above 60 = bullish structure, below 40 = bearish
  if (emaScore > 60 && rsiScore > 50) return 'bullish';
  if (emaScore < 40 && rsiScore < 50) return 'bearish';
  return 'neutral';
}

/**
 * Calculate the Forex Mean Reversion score for a symbol.
 *
 * @param symbolId  Database symbol ID
 * @param pair      Forex pair name (e.g. 'EURUSD')
 * @param results   Map of directiveId → DirectiveResult from DirectivesService
 * @param timeframe Data timeframe used
 */
export function calculateForexScore(
  symbolId: string,
  pair: string,
  results: Map<string, DirectiveResult>,
  timeframe: string,
): ForexScore {
  const breakdown: ForexBreakdownItem[] = [];
  let totalScore = 0;
  let totalConfidence = 0;
  let weightSum = 0;

  for (const { directiveId, weight } of FOREX_WEIGHTS) {
    const result = results.get(directiveId);
    if (!result) continue;

    const contribution = (result.score * weight) / 100;
    totalScore += contribution;
    totalConfidence += result.confidence * weight;
    weightSum += weight;

    breakdown.push({
      directiveId,
      name: DIRECTIVE_NAMES[directiveId] ?? directiveId,
      rawScore: result.score,
      weight,
      contribution: Number(contribution.toFixed(1)),
    });
  }

  const finalScore = Math.min(100, Math.max(0, Number(totalScore.toFixed(1))));
  const avgConfidence = weightSum > 0
    ? Number((totalConfidence / weightSum).toFixed(2))
    : 0;

  // Determine signal
  const bias = deriveBias(results);
  const normalizedScore = Math.min(100, Math.round((finalScore / 100) * 100));

  let signal: ForexSignal;
  if (finalScore >= FOREX_STRATEGY_CONFIG.entryThreshold && bias === 'bullish') {
    signal = {
      type: 'buy',
      reason: `Score ${finalScore} with bullish bias. ${bias} EMA structure and RSI alignment.`,
    };
  } else if (finalScore >= FOREX_STRATEGY_CONFIG.entryThreshold && bias === 'bearish') {
    signal = {
      type: 'sell',
      reason: `Score ${finalScore} with bearish bias. Price structure favors short side.`,
    };
  } else if (finalScore >= FOREX_STRATEGY_CONFIG.strongSignalThreshold) {
    // Strong score overrides neutral bias — follow raw direction
    signal = {
      type: 'buy',
      reason: `Strong score ${finalScore} — entering long despite neutral bias.`,
    };
  } else {
    signal = {
      type: 'flat',
      reason: `Score ${finalScore} below threshold ${FOREX_STRATEGY_CONFIG.entryThreshold} or no clear bias.`,
    };
  }

  return {
    strategyId: FOREX_STRATEGY_CONFIG.id,
    strategyName: FOREX_STRATEGY_CONFIG.name,
    symbolId,
    pair,
    totalScore: finalScore,
    normalizedScore,
    confidence: avgConfidence,
    signal,
    breakdown,
    timeframe,
    timestamp: new Date().toISOString(),
  };
}
