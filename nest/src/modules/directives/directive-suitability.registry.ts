/**
 * Directive Suitability Registry (Q301)
 * ======================================
 * Static suitability tags for every registered directive.
 * Used by activation gates to determine which directives should fire
 * under current market conditions.
 *
 * Any directive NOT listed here defaults to:
 *   regime: 'any', volatility: 'any', instruments: ['stocks'],
 *   minTimeframe: 'M15', sessions: ['US', 'London', 'Asian']
 */

import { SuitabilityProfile } from './interfaces/directive.interface';

export const DIRECTIVE_SUITABILITY: Record<string, SuitabilityProfile> = {
  // ── Technical: Momentum & Oscillators ──
  'rsi-oversold': {
    regimeType: 'ranging', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London', 'Asian'],
  },
  'rsi-overbought': {
    regimeType: 'ranging', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London', 'Asian'],
  },
  'macd-crossover': {
    regimeType: 'trending', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'M30', preferredSessions: ['US', 'London'],
  },
  'macd': {
    regimeType: 'trending', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London'],
  },
  'ema-structure': {
    regimeType: 'trending', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'ma-crossover': {
    regimeType: 'trending', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London'],
  },
  'moving-averages': {
    regimeType: 'trending', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'H4', preferredSessions: ['US', 'London'],
  },
  'stochastic': {
    regimeType: 'ranging', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },
  'cci': {
    regimeType: 'any', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto', 'commodities'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London', 'Asian'],
  },
  'momentum-continuation-combo': {
    regimeType: 'trending', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto'],
    minTimeframe: 'M30', preferredSessions: ['US', 'London'],
  },
  'momentum-roc': {
    regimeType: 'trending', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },
  'price-above-sma': {
    regimeType: 'trending', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London', 'Asian'],
  },

  // ── Technical: Volatility ──
  'bollinger-bands': {
    regimeType: 'any', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto', 'forex'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },
  'bollinger-band-squeeze': {
    regimeType: 'ranging', volatilityLevel: 'low',
    instrumentTypes: ['stocks', 'crypto'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London'],
  },
  'bollinger-percent-b': {
    regimeType: 'any', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },
  'volatility-tools': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'M5', preferredSessions: ['US', 'London', 'Asian'],
  },
  'atr-dip': {
    regimeType: 'any', volatilityLevel: 'high',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'M5', preferredSessions: ['US', 'London', 'Asian'],
  },
  'atr-trailing-stop': {
    regimeType: 'trending', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London', 'Asian'],
  },
  'atr-expansion': {
    regimeType: 'any', volatilityLevel: 'high',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'M5', preferredSessions: ['US', 'London'],
  },
  'volatility-envelope': {
    regimeType: 'any', volatilityLevel: 'high',
    instrumentTypes: ['stocks', 'crypto'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },

  // ── Technical: Volume ──
  'obv': {
    regimeType: 'trending', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'indices'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London'],
  },
  'volume-rhythm': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'M15', preferredSessions: ['US'],
  },
  'vwap': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'M5', preferredSessions: ['US'],
  },
  'volume-surge': {
    regimeType: 'any', volatilityLevel: 'high',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'M5', preferredSessions: ['US', 'London'],
  },
  'volume-confirmation': {
    regimeType: 'trending', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'indices'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },
  'mfi': {
    regimeType: 'ranging', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },
  'accumulation-distribution': {
    regimeType: 'trending', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London'],
  },
  'accumulation-dist': {
    regimeType: 'trending', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London'],
  },

  // ── Technical: Patterns ──
  'doji-pattern': {
    regimeType: 'any', volatilityLevel: 'normal',
    instrumentTypes: ['crypto', 'stocks'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },
  'hammer-pattern': {
    regimeType: 'ranging', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London'],
  },
  'engulfing-pattern': {
    regimeType: 'any', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto', 'forex'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London'],
  },
  'three-soldiers-pattern': {
    regimeType: 'trending', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London'],
  },
  'pin-bar-pattern': {
    regimeType: 'any', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto', 'forex'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },
  'mt5-engulfing': {
    regimeType: 'any', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },
  'mt5-harami': {
    regimeType: 'any', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },
  'mt5-star-doji': {
    regimeType: 'any', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },
  'mt5-hammer': {
    regimeType: 'any', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },

  // ── Technical: Trend Strength ──
  'adx': {
    regimeType: 'trending', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'awesome-oscillator': {
    regimeType: 'trending', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto', 'forex'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London'],
  },
  'bears-power': {
    regimeType: 'trending', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },
  'bulls-power': {
    regimeType: 'trending', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },
  'price-action': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'M5', preferredSessions: ['US', 'London', 'Asian'],
  },

  // ── Support / Resistance ──
  'support-resistance-levels': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'H4', preferredSessions: ['US', 'London', 'Asian'],
  },
  'support-resistance': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'H4', preferredSessions: ['US', 'London', 'Asian'],
  },
  'overhead-supply-pressure': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks'],
    minTimeframe: 'H4', preferredSessions: ['US', 'London'],
  },
  'panic-exhaustion-absorption': {
    regimeType: 'any', volatilityLevel: 'high',
    instrumentTypes: ['stocks', 'crypto'],
    minTimeframe: 'M5', preferredSessions: ['US', 'London'],
  },
  'time-based-support': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'H4', preferredSessions: ['US', 'London'],
  },

  // ── Sessions / Timing ──
  'session-open-effect': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'M5', preferredSessions: ['US'],
  },
  'session-timing-filter': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'M5', preferredSessions: ['US'],
  },
  'intraday-u-pattern': {
    regimeType: 'any', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'M5', preferredSessions: ['US'],
  },
  'institutional-timing': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'M15', preferredSessions: ['US'],
  },
  'monday-effect': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'friday-positioning': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'midweek-momentum': {
    regimeType: 'trending', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'H1', preferredSessions: ['US'],
  },
  'advanced-weekly-rhythm': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'basic-weekly-rhythm': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },

  // ── Macro / Regime ──
  'vix-strategy': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'sp500-regime': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'gold-macro-correlation': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['commodities', 'stocks'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London'],
  },
  'cad-usd-oil-correlation': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['forex', 'commodities'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London'],
  },
  'spy-options-expiry': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'spy-month-end-rebalancing': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'spy-qqq-relative-strength': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },

  // ── Crypto ──
  'crypto-fear-greed': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['crypto'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'btc-halving-cycle': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['crypto'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'crypto-weekend-effect': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['crypto'],
    minTimeframe: 'H1', preferredSessions: ['Asian', 'off-hours'],
  },

  // ── Fundamentals / Sentiment ──
  'news-sentiment': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'earnings-proximity': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'nvda-earnings-momentum': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'tsla-sentiment-amplifier': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'dividend-yield-attractive': {
    regimeType: 'any', volatilityLevel: 'low',
    instrumentTypes: ['stocks'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London'],
  },
  'analyst-adjustments': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London'],
  },
  'analyst-consensus': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London'],
  },
  'conviction-growth': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London'],
  },
  'earnings-implementation': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'earnings-whispers': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'earnings-momentum': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'like-zacks': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'social-buzz': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'insider-activity': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },

  // ── Position Sizing (Q302) ──
  'position-size-kelly': {
    regimeType: 'any', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London'],
  },
  'position-size-confidence': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'market-regime': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'momentum-exhaustion': {
    regimeType: 'trending', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto'],
    minTimeframe: 'M15', preferredSessions: ['US', 'London'],
  },
  'target-achieved': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London'],
  },
  'regime-shift-exit': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'time-stop': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London', 'Asian'],
  },

  // ── Risk ──
  'adaptive-risk-monitor': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'isa-reset': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'position-concentration': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'correlation-drag': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'dilution-impact': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'volatility-regime': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'liquidity-check': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London', 'Asian'],
  },
  'budget-gate': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London', 'Asian'],
  },

  // ── Strategy-Level Directives ──
  'mean-reversion': {
    regimeType: 'ranging', volatilityLevel: 'normal',
    instrumentTypes: ['stocks'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London'],
  },
  'resistance-levels-strategy': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks'],
    minTimeframe: 'H4', preferredSessions: ['US', 'London'],
  },
  'weekly-rhythm-strategy': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'confluence-reversal-combo': {
    regimeType: 'ranging', volatilityLevel: 'normal',
    instrumentTypes: ['stocks', 'crypto'],
    minTimeframe: 'H1', preferredSessions: ['US', 'London'],
  },

  // ── Seasonality: Calendar-Based ──
  'santa-claus-rally': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'january-effect': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'sell-in-may': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London'],
  },
  'september-slump': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'october-relief': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'friday-drift': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices', 'forex'],
    minTimeframe: 'D1', preferredSessions: ['US', 'London'],
  },
  'turnaround-tuesday': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'opex-gamma': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'triple-witching': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
  'election-cycle': {
    regimeType: 'any', volatilityLevel: 'any',
    instrumentTypes: ['stocks', 'indices'],
    minTimeframe: 'D1', preferredSessions: ['US'],
  },
};

/** Default suitability for directives not in the registry. */
export const DEFAULT_SUITABILITY: SuitabilityProfile = {
  regimeType: 'any',
  volatilityLevel: 'any',
  instrumentTypes: ['stocks'],
  minTimeframe: 'M15',
  preferredSessions: ['US', 'London', 'Asian'],
};

export function getDirectiveSuitability(id: string): SuitabilityProfile {
  return DIRECTIVE_SUITABILITY[id] ?? DEFAULT_SUITABILITY;
}
