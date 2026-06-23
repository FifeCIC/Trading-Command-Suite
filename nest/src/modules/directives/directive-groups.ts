/**
 * Directive Group Registry — classifies directives into Technical, Sentiment, and Risk groups.
 *
 * Risk directives multiplicatively gate Technical + Sentiment scores.
 * This prevents high-risk positions from passing just because technicals look good.
 *
 * Design: protocol-risk-gating.prompt.md (Q289)
 */

export interface DirectiveGroup {
  id: string;
  name: string;
  description: string;
  weight: number;          // Weight in final composite (Technical + Sentiment weights are used as coefficients)
  isRiskGate: boolean;     // Does this group act as a multiplier?
  minMultiplier: number;   // Hard floor for risk gate (e.g. 0.3 = worst risk still lets 30% through)
  maxMultiplier: number;   // Cap for low-risk boost (e.g. 1.2 = best risk can boost up to 20%)
  directiveIds: string[];  // Which directive IDs belong to this group
  directiveMaxScores?: Record<string, number>; // Variable maxScores per directive (default 100 if not specified)
}

export const DIRECTIVE_GROUPS: DirectiveGroup[] = [
  {
    id: 'technical',
    name: 'Technical Analysis',
    description: 'Price action, momentum, patterns, volume',
    weight: 0.40,
    isRiskGate: false,
    minMultiplier: 1.0,
    maxMultiplier: 1.0,
    directiveIds: [
      'rsi-oversold',
      'rsi-overbought',
      'macd-crossover',
      'ema-structure',
      'volume-confirmation',
      'momentum-roc',
      'bollinger-squeeze',
      'support-resistance',
      'atr-expansion',
      'session-timing-filter',
      'session-open-effect',
    ],
  },
  {
    id: 'sentiment',
    name: 'Sentiment & Fundamentals',
    description: 'Analyst consensus, news, earnings, social',
    weight: 0.35,
    isRiskGate: false,
    minMultiplier: 1.0,
    maxMultiplier: 1.0,
    directiveIds: [
      'analyst-adjustments',
      'analyst-consensus',
      'news-sentiment',
      'earnings-proximity',
      'earnings-momentum',
      'social-buzz',
      'insider-activity',
    ],
  },
  {
    id: 'risk',
    name: 'Risk & Structural',
    description: 'Correlation, dilution, concentration, volatility, liquidity',
    weight: 0.25,
    isRiskGate: true,
    minMultiplier: 0.3,    // Worst risk = 30% of signal survives
    maxMultiplier: 1.2,    // Best risk = 20% boost
    directiveIds: [
      'position-concentration',
      'correlation-drag',
      'dilution-impact',
      'volatility-regime',
      'liquidity-check',
      'budget-gate',
    ],
  },
];

/** Map directive IDs to their group for O(1) lookup */
export const DIRECTIVE_TO_GROUP: Map<string, string> = new Map();
for (const group of DIRECTIVE_GROUPS) {
  for (const directiveId of group.directiveIds) {
    DIRECTIVE_TO_GROUP.set(directiveId, group.id);
  }
}

/** Get the group config for a given directive ID */
export function getGroupForDirective(directiveId: string): DirectiveGroup | undefined {
  const groupId = DIRECTIVE_TO_GROUP.get(directiveId);
  return DIRECTIVE_GROUPS.find((g) => g.id === groupId);
}

/** Check if a directive belongs to the risk group */
export function isRiskDirective(directiveId: string): boolean {
  return DIRECTIVE_TO_GROUP.get(directiveId) === 'risk';
}

// ─── Bitcoin Monitor Protocol (formerly Speed Scalp V1) ─────

/**
 * BTC-SPEED-V1 (renamed: BTC Investment Monitor V1)
 *
 * Medium-term Bitcoin monitoring protocol for investment/ETF entries.
 * Uses halving cycle macro overlay, fear-greed index, and technical
 * momentum to identify favorable entry zones for multi-hour/days holds.
 *
 * NOT a speed scalp protocol — halving cycle and fear-greed operate
 * on weeks-to-months timescales. For sub-minute scalping, use btc-scalp-v1.
 *
 * Variable maxScores create a ~915-point protocol ceiling,
 * distinguishing common strong scores (80%) from rare cyclical
 * opportunities (95%+ requiring halving cycle alignment).
 */
export const BTC_SPEED_GROUPS: DirectiveGroup[] = [
  {
    id: 'technical',
    name: 'Technical Analysis',
    description: 'Speed momentum, squeezes, volume, S/R for BTC',
    weight: 0.40,
    isRiskGate: false,
    minMultiplier: 1.0,
    maxMultiplier: 1.0,
    directiveIds: [
      'speed-momentum',       // 120 — Core velocity signal
      'bollinger-squeeze',    // 100 — Expansion catalyst
      'volume-confirmation',  // 100 — Volume support
      'atr-expansion',        // 100 — Vol opportunity
      'rsi-oversold',         // 120 — Oversold bounce
      'support-resistance',   // 100 — Round numbers
      'rsi-overbought',       // 100 — Overbought reversion
      'session-timing-filter',// 100 — Session quality
    ],
    directiveMaxScores: {
      'speed-momentum': 120,
      'rsi-oversold': 120,
    },
  },
  {
    id: 'sentiment',
    name: 'Sentiment & Fundamentals',
    description: 'Crypto-specific sentiment signals',
    weight: 0.35,
    isRiskGate: false,
    minMultiplier: 1.0,
    maxMultiplier: 1.0,
    directiveIds: [
      'crypto-fear-greed',    //  60 — Contrarian sentiment
      'news-sentiment',       // 100 — Crypto news flow
      'social-buzz',          // 100 — Social activity
    ],
    directiveMaxScores: {
      'crypto-fear-greed': 60,
    },
  },
  {
    id: 'risk',
    name: 'Risk & Structural',
    description: 'Bitcoin-specific risk: halving cycle, weekend effects, volatility',
    weight: 0.25,
    isRiskGate: true,
    minMultiplier: 0.3,    // Strict: worst risk = 30% of signal survives
    maxMultiplier: 1.2,    // Strict: best risk = 20% boost
    directiveIds: [
      'btc-halving-cycle',    // 200 — Macro cycle bonus (multiplicative gate)
      'crypto-weekend-effect',//  50 — Weekend risk awareness
      'volatility-regime',    // 100 — Kill in extreme vol
      'liquidity-check',      // 100 — Spread/volume check
      'position-concentration',// 100 — Don't over-allocate
    ],
    directiveMaxScores: {
      'btc-halving-cycle': 200,
      'crypto-weekend-effect': 50,
    },
  },
];

/** Map BTC directive IDs to their group */
export const BTC_DIRECTIVE_TO_GROUP: Map<string, string> = new Map();
for (const group of BTC_SPEED_GROUPS) {
  for (const directiveId of group.directiveIds) {
    BTC_DIRECTIVE_TO_GROUP.set(directiveId, group.id);
  }
}

/** Protocol registry — lookup table for protocol selection */
export const PROTOCOL_REGISTRY: Record<string, { groups: DirectiveGroup[]; name: string; description: string; tradingStyle?: string; recommendedTimeframe?: string; avgHoldTime?: string; winRateTarget?: string; idealFor?: string }> = {
  default: {
    groups: DIRECTIVE_GROUPS,
    name: 'SEES Default',
    description: 'General-purpose equity scoring protocol covering technical, sentiment, and risk directives.',
    tradingStyle: 'Swing / Position',
    recommendedTimeframe: '1d',
    avgHoldTime: 'Days to weeks',
    winRateTarget: '55–65%',
    idealFor: 'Equity portfolios, multi-day holds, balanced risk/reward',
  },
  'btc-speed-v1': {
    groups: BTC_SPEED_GROUPS,
    name: 'BTC Investment Monitor V1',
    description: 'Medium-term Bitcoin monitoring protocol for investment/ETF entries. Uses halving cycle macro overlay, fear-greed index, and technical momentum. Not for scalping — holds last hours to days.',
    tradingStyle: 'Monitor / Position',
    recommendedTimeframe: '15m–1d',
    avgHoldTime: 'Hours to days',
    winRateTarget: '55–65%',
    idealFor: 'Bitcoin ETF entry timing, spot accumulation zones, swing trades around halving cycle phases. Best when halving cycle is in Rally or Mid-Cycle phase.',
  },

  // ── BTC Tick Scalp V1 ──

  'btc-scalp-v1': {
    groups: [
      {
        id: 'technical', name: 'Micro-Structure Technicals',
        description: 'Tick-level momentum, squeezes, volume micro-spikes for sub-minute entries',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — 5-candle velocity (use with 5s–30s candles)
          'bollinger-squeeze',    // 100 — Micro-squeeze before tick breakout
          'volume-confirmation',  // 100 — Volume micro-spike confirms entry
          'rsi-oversold',         // 120 — Tick-level oversold bounce
          'rsi-overbought',       // 100 — Tick-level overbought reversion
          'support-resistance',   // 100 — Micro S/R (round numbers, prior wicks)
          'atr-expansion',        // 100 — Micro ATR for stop placement
          'session-timing-filter',// 100 — Only trade liquid sessions
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Background Sentiment',
        description: 'Lightweight sentiment — fundamentals don\'t move in <1min but extreme fear/greed sets tone',
        weight: 0.20, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'crypto-fear-greed',    //  60 — Background risk appetite
          'news-sentiment',       // 100 — Avoid entries during high-impact news
        ],
        directiveMaxScores: { 'crypto-fear-greed': 60 },
      },
      {
        id: 'risk', name: 'Execution Risk',
        description: 'Heavy risk gating — execution quality is everything for $1 scalps. Wide spreads, low liquidity, or extreme vol = no trade.',
        weight: 0.40, isRiskGate: true, minMultiplier: 0.5, maxMultiplier: 1.3,
        directiveIds: [
          'liquidity-check',      // 100 — Spread/volume must support $1 entries
          'volatility-regime',    // 100 — Extreme vol kills tick scalps
          'crypto-weekend-effect',//  50 — Weekend liquidity dry-up
          'position-concentration',// 100 — Don't over-allocate scalp positions
        ],
        directiveMaxScores: { 'crypto-weekend-effect': 50 },
      },
    ],
    name: 'BTC Tick Scalp V1',
    description: 'True sub-minute Bitcoin scalping protocol. Designed for $1–$10 positions held seconds to minutes. Heavy risk gating on execution quality — wide spreads or low liquidity kill the signal.',
    tradingStyle: 'Tick Scalp',
    recommendedTimeframe: '5s–30s',
    avgHoldTime: 'Seconds to a few minutes',
    winRateTarget: '65–75%',
    idealFor: 'XTrend speed trading — $1 positions, sub-minute holds, high win rate. Requires tight spreads and liquid sessions. Do NOT use for position trading or multi-hour holds.',
  },

  // ── VIX: Mean-Reversion Spike Protocol ──

  'vix-spike-v1': {
    groups: [
      {
        id: 'technical', name: 'Technical Analysis',
        description: 'VIX-specific: mean reversion, spike exhaustion, Bollinger',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'rsi-overbought',      // 100 — VIX spikes = overbought, reversion
          'bollinger-squeeze',   // 100 — VIX squeezes before explosions
          'volume-confirmation', // 100 — Volume spike confirms VIX move
          'atr-expansion',       // 100 — ATR explodes during VIX events
          'support-resistance',  // 100 — VIX respects historical levels
          'mean-reversion',      // 100 — VIX always mean-reverts
        ],
      },
      {
        id: 'sentiment', name: 'Sentiment',
        description: 'VIX IS sentiment — fear gauge',
        weight: 0.35, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment',      // 100 — Fear-driven news spikes VIX
          'vix-regime',          // 100 — What regime is VIX itself in?
        ],
      },
      {
        id: 'risk', name: 'Risk',
        description: 'VIX-specific: contango, term structure, SPX correlation',
        weight: 0.25, isRiskGate: true, minMultiplier: 0.3, maxMultiplier: 1.2,
        directiveIds: [
          'volatility-regime',   // 100 — Don't fade extreme vol
          'liquidity-check',     // 100 — Wide spreads during panic
          'sp500-regime',        // 100 — VIX/SPX correlation context
        ],
      },
    ],
    name: 'VIX Spike Mean Reversion V1',
    description: 'VIX speed/scalp protocol — exploits VIX spike-to-mean-reversion patterns. Buy after spikes, sell when complacency returns.',
    tradingStyle: 'Mean Reversion / Scalp',
    recommendedTimeframe: '1m–5m',
    avgHoldTime: 'Minutes to 1 hour',
    winRateTarget: '65–75%',
    idealFor: 'VIX spike reversals. Best during US market hours when VIX options are most liquid. Not for trend-following — pure mean reversion.',
  },

  // ── GOLD: Safe Haven & Macro Protocol ──

  'gold-macro-v1': {
    groups: [
      {
        id: 'technical', name: 'Technical Analysis',
        description: 'Gold technicals — trend, S/R, momentum',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'ema-structure',       // 100 — Gold trends last weeks
          'macd-crossover',      // 110 — Trend changes signal macro shifts
          'support-resistance',  // 100 — Gold respects key levels ($2000, $2500)
          'bollinger-squeeze',   // 100 — Gold squeezes before macro moves
          'volume-confirmation', // 100 — Volume on COMEX confirms moves
          'rsi-oversold',        // 120 — Oversold gold = macro fear peak
          'rsi-overbought',      // 100 — Overbought gold = complacency
        ],
      },
      {
        id: 'sentiment', name: 'Sentiment & Macro',
        description: 'Gold drivers: real rates, USD, inflation, geopolitics',
        weight: 0.35, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'gold-macro-correlation', // 100 — Real rates, DXY, inflation context
          'news-sentiment',         // 100 — Geopolitical risk drives gold
          'analyst-consensus',      // 100 — Wall Street gold targets
        ],
      },
      {
        id: 'risk', name: 'Risk',
        description: 'Gold-specific: contango, storage, correlation reversal',
        weight: 0.25, isRiskGate: true, minMultiplier: 0.3, maxMultiplier: 1.2,
        directiveIds: [
          'volatility-regime',   // 100 — Gold vol ≠ equity vol
          'liquidity-check',     // 100 — Spread check on XAUUSD
          'position-concentration', // 100 — Don't over-allocate gold
        ],
      },
    ],
    name: 'Gold Macro Correlation V1',
    description: 'Gold scoring protocol — trend-following with macro correlation (DXY, real rates, inflation). Longer hold periods than speed protocols.',
    tradingStyle: 'Trend Following / Position',
    recommendedTimeframe: '1d–1w',
    avgHoldTime: 'Days to weeks',
    winRateTarget: '55–65%',
    idealFor: 'Gold EFTs, XAUUSD CFD positions, macro-driven gold exposure. Best when DXY is weak and real rates are falling.',
  },

  // ── OIL: Supply/Demand & Geopolitics Protocol ──

  'oil-supply-v1': {
    groups: [
      {
        id: 'technical', name: 'Technical Analysis',
        description: 'Oil technicals — range-bound with trend breaks',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'ema-structure',       // 100 — Oil trends with supply shifts
          'support-resistance',  // 100 — Oil respects technical levels
          'bollinger-squeeze',   // 100 — OPEC meetings = squeeze → expansion
          'volume-confirmation', // 100 — Volume confirms supply events
          'atr-expansion',       // 100 — ATR spikes on geopolitical events
          'momentum-roc',        // 100 — Supply shock momentum
        ],
      },
      {
        id: 'sentiment', name: 'Sentiment & Fundamentals',
        description: 'Oil drivers: supply, geopolitics, inventories, USD',
        weight: 0.35, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'cad-usd-oil-correlation', // 100 — Oil/CAD correlation signal
          'news-sentiment',          // 100 — OPEC, EIA, geopolitical news
          'analyst-consensus',       // 100 — Energy sector analyst targets
        ],
      },
      {
        id: 'risk', name: 'Risk',
        description: 'Oil-specific: contango/backwardation, geopolitical risk',
        weight: 0.25, isRiskGate: true, minMultiplier: 0.3, maxMultiplier: 1.2,
        directiveIds: [
          'volatility-regime',   // 100 — Oil vol spikes on geopolitics
          'liquidity-check',     // 100 — Spread check on WTI/Brent
          'position-concentration', // 100 — Energy allocation cap
        ],
      },
    ],
    name: 'Oil Supply/Demand V1',
    description: 'Oil scoring protocol — trend-following with supply/demand fundamentals. Sensitive to OPEC, EIA inventories, and geopolitical events.',
    tradingStyle: 'Trend Following / Event-Driven',
    recommendedTimeframe: '1d–4h',
    avgHoldTime: 'Hours to days',
    winRateTarget: '55–65%',
    idealFor: 'Oil CFD/ETF trades around OPEC meetings, EIA reports, and geopolitical supply events.',
  },

  // ── FOREX: Session-Based Mean Reversion Protocol ──

  'forex-session-v1': {
    groups: [
      {
        id: 'technical', name: 'Technical Analysis',
        description: 'Forex technicals — session-driven, mean-reverting',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'rsi-oversold',        // 120 — Forex oversold = bounce within range
          'rsi-overbought',      // 100 — Forex overbought = mean reversion
          'bollinger-squeeze',   // 100 — Squeeze before session breakout
          'support-resistance',  // 100 — Pairs respect round numbers
          'ema-structure',       // 100 — Multi-session trend structure
          'macd-crossover',      // 110 — Session trend changes
          'session-open-effect', // 100 — Session open reversals
        ],
      },
      {
        id: 'sentiment', name: 'Sentiment & Fundamentals',
        description: 'Forex drivers: rates, data, carry trade',
        weight: 0.35, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'fx-timing',           //  80 — Session timing for specific pairs
          'news-sentiment',      // 100 — Economic data, central bank news
          'analyst-consensus',   // 100 — Bank forecasts for pairs
        ],
      },
      {
        id: 'risk', name: 'Risk',
        description: 'Forex risk: correlation, session liquidity, rollover',
        weight: 0.25, isRiskGate: true, minMultiplier: 0.3, maxMultiplier: 1.2,
        directiveIds: [
          'session-timing-filter', // 100 — Trade only in liquid sessions
          'volatility-regime',     // 100 — Avoid during central bank events
          'liquidity-check',       // 100 — Spread check on crosses
          'correlation-drag',      // 100 — Avoid correlated pair overexposure
        ],
      },
    ],
    name: 'Forex Session V1',
    description: 'Forex scoring protocol — session-based mean reversion with trend following. Works across EURUSD, GBPUSD, USDJPY, USDCAD, EURGBP.',
    tradingStyle: 'Session / Mean Reversion',
    recommendedTimeframe: '5m–1h',
    avgHoldTime: 'Minutes to hours',
    winRateTarget: '60–70%',
    idealFor: 'Forex pairs during London/NY session overlap. Mean-reverting within daily ranges, trend-following on session breaks.',
  },
};
