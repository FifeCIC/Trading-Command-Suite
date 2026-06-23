/**
 * Session Pattern Library (Q296)
 * ===============================
 * Historical pattern confidence based on research.
 * Expandable per-symbol per-session as backtest data accumulates.
 *
 * Format: { symbol: { session: { conditions[], prediction, confidence } } }
 */

export interface SessionPattern {
  preTrend: 'up' | 'down' | 'flat' | 'any';
  preStrength: number;    // minimum absolute % move
  futuresDir: 'bullish' | 'bearish' | 'flat' | 'any';
  dayOfWeek?: number;     // 0=Sun,1=Mon,...,6=Sat
  prediction: 'bullish' | 'bearish';
  confidence: number;     // 0–1
  reason: string;
}

export type SessionPatternMap = Record<string, SessionPattern[]>;

export const SESSION_PATTERNS: Record<string, Record<string, SessionPatternMap>> = {
  BTCUSD: {
    US: {
      conditions: [
        {
          preTrend: 'up', preStrength: 0.3, futuresDir: 'flat',
          prediction: 'bearish', confidence: 0.58,
          reason: 'European trend reversal at US open — crypto profit-taking',
          dayOfWeek: undefined,
        },
        {
          preTrend: 'down', preStrength: 0.3, futuresDir: 'flat',
          prediction: 'bullish', confidence: 0.55,
          reason: 'European dip bought at US open — crypto follows equity dip-buyers',
          dayOfWeek: undefined,
        },
        {
          preTrend: 'any', preStrength: 0, futuresDir: 'bullish',
          prediction: 'bullish', confidence: 0.68,
          reason: 'NASDAQ futures bullish — crypto follows tech sentiment',
          dayOfWeek: undefined,
        },
        {
          preTrend: 'any', preStrength: 0, futuresDir: 'bearish',
          prediction: 'bearish', confidence: 0.61,
          reason: 'NASDAQ futures bearish — crypto sells off with tech',
          dayOfWeek: undefined,
        },
        {
          preTrend: 'up', preStrength: 0.1, futuresDir: 'any',
          prediction: 'bearish', confidence: 0.52,
          reason: 'Monday gap-fill after weekend rally',
          dayOfWeek: 1,
        },
      ],
    },
    London: {
      conditions: [
        {
          preTrend: 'flat', preStrength: 0, futuresDir: 'any',
          prediction: 'bullish', confidence: 0.55,
          reason: 'Asian range breakout at London open',
          dayOfWeek: undefined,
        },
      ],
    },
    Asian: {
      conditions: [
        {
          preTrend: 'any', preStrength: 0, futuresDir: 'any',
          prediction: 'bullish', confidence: 0.50,
          reason: 'Weekend gap — direction depends on Saturday close vs Sunday futures',
          dayOfWeek: 1,
        },
      ],
    },
  },

  EURUSD: {
    London: {
      conditions: [
        {
          preTrend: 'up', preStrength: 0.2, futuresDir: 'any',
          prediction: 'bullish', confidence: 0.62,
          reason: 'Asian momentum continuation into London session',
          dayOfWeek: undefined,
        },
        {
          preTrend: 'flat', preStrength: 0, futuresDir: 'any',
          prediction: 'bullish', confidence: 0.53,
          reason: 'London open breakout — EURUSD tends to trend in London morning',
          dayOfWeek: undefined,
        },
      ],
    },
    US: {
      conditions: [
        {
          preTrend: 'any', preStrength: 0, futuresDir: 'bearish',
          prediction: 'bearish', confidence: 0.60,
          reason: 'DXY strength at US open — EUR sells off',
          dayOfWeek: undefined,
        },
      ],
    },
  },

  SPX: {
    US: {
      conditions: [
        {
          preTrend: 'up', preStrength: 0.2, futuresDir: 'bullish',
          prediction: 'bullish', confidence: 0.70,
          reason: 'Pre-market rally + bullish futures = continuation',
          dayOfWeek: undefined,
        },
        {
          preTrend: 'down', preStrength: 0.3, futuresDir: 'flat',
          prediction: 'bullish', confidence: 0.58,
          reason: 'Dip-buying at open — institutional flows',
          dayOfWeek: undefined,
        },
      ],
    },
  },
};

/** Match a pattern condition against current market state. */
export function matchPattern(
  patterns: SessionPattern[],
  preTrend: 'up' | 'down' | 'flat',
  preStrength: number,
  futuresDir: 'bullish' | 'bearish' | 'flat',
  dayOfWeek: number,
): { prediction: 'bullish' | 'bearish'; confidence: number; reason: string } | null {
  for (const p of patterns) {
    // Trend match
    if (p.preTrend !== 'any' && p.preTrend !== preTrend) continue;
    // Strength match
    if (p.preStrength > 0 && preStrength < p.preStrength) continue;
    // Futures match
    if (p.futuresDir !== 'any' && p.futuresDir !== futuresDir) continue;
    // Day match
    if (p.dayOfWeek !== undefined && p.dayOfWeek !== dayOfWeek) continue;

    return { prediction: p.prediction, confidence: p.confidence, reason: p.reason };
  }
  return null;
}
