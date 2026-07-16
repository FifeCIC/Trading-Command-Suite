/**
 * Directive Group Registry — classifies directives into Technical, Sentiment, and Risk groups.
 *
 * Two weighting systems coexist. They are documented below:
 *
 * ## System 1: Group Weights (group-weighted mode — default)
 * Each group (Technical=0.40, Sentiment=0.35, Risk=0.25) declares a weight that controls
 * how much that category contributes to the final composite. This lets you say
 * "I want technicals to matter 40% regardless of which directives fire within them."
 *
 * Composite = (technical×0.40 + sentiment×0.35) × riskMultiplier
 *
 * ## System 2: Directive MaxScores (maxscore-weighted mode)
 * Each directive declares a maxScore (default 100) that represents its maximum possible
 * contribution. Group weights are IGNORED. All directives compete on their maxScore alone.
 * The composite is the percentage of total raw score relative to total maxScore across ALL groups.
 *
 * Composite = (sum of ALL raw scores / sum of ALL maxScores) × 100 × riskMultiplier
 *
 * ## How they interact
 * Both systems use directive maxScores for within-group ranking (a maxScore=180 directive
 * contributes more than maxScore=90). The difference is in how groups are combined:
 * group-weighted uses category weights, maxscore-weighted treats the full directive set as flat.
 *
 * Select via weightStrategy on ScoringStrategy (or pass to scoreWithGating()).
 * Default: group-weighted.
 *
 * Risk directives multiplicatively gate Technical + Sentiment scores in BOTH modes.
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
      'speed-momentum',
      'bollinger-band-squeeze',
      'support-resistance-levels',
      'volatility-tools',
      'session-open-effect',
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
      'analyst-adjustments',
      'news-sentiment-positive',
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
      'portfolio-performance',
      'spy-qqq-relative-strength',
      'dilution-impact',
      'vix-regime',
      'liquidity-check',
      'budget-gate',
      'rollover-risk',
      'dxy-regime',
    ],
  },
];

// ── SHORT Directive Groups (bearish-only directives for SHORT_ONLY protocols) ──

export const SHORT_DIRECTIVE_GROUPS: DirectiveGroup[] = [
  {
    id: 'bearish-technical',
    name: 'Bearish Technical Analysis',
    description: 'Overbought, breakdown, distribution — bearish reversal signals',
    weight: 0.40,
    isRiskGate: false,
    minMultiplier: 1.0,
    maxMultiplier: 1.0,
    directiveIds: [
      'rsi-overbought',
      'stochastic',
      'williams-r',
      'cci',
      'mfi',
      'engulfing-pattern',
      'pin-bar-pattern',
      'doji-pattern',
      'resistance-levels-strategy',
      'obv-divergence',
      'macd-crossover',
      'speed-momentum',
    ],
  },
  {
    id: 'bearish-sentiment',
    name: 'Bearish Sentiment & Fundamentals',
    description: 'Negative news, downgrades, fear — bearish catalysts',
    weight: 0.35,
    isRiskGate: false,
    minMultiplier: 1.0,
    maxMultiplier: 1.0,
    directiveIds: [
      'analyst-adjustments',
      'news-sentiment-positive',
      'earnings-proximity',
      'earnings-momentum',
      'social-buzz',
    ],
  },
  {
    id: 'short-risk',
    name: 'Short-Side Risk & Structural',
    description: 'Short-specific risk gates — vol spikes, liquidity, concentration',
    weight: 0.25,
    isRiskGate: true,
    minMultiplier: 0.3,
    maxMultiplier: 1.2,
    directiveIds: [
      'portfolio-performance',
      'spy-qqq-relative-strength',
      'dilution-impact',
      'vix-strategy',
      'liquidity-check',
      'budget-gate',
      'rollover-risk',
      'dxy-regime',
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
for (const group of SHORT_DIRECTIVE_GROUPS) {
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
      'bollinger-band-squeeze',    // 100 — Expansion catalyst
      'volume-confirmation',  // 100 — Volume support
      'volatility-tools',        // 100 — Vol opportunity
      'rsi-oversold',         // 120 — Oversold bounce
      'support-resistance-levels',   // 100 — Round numbers
      'multi-timeframe-trend',// 120 — 1D/1H/15M alignment
      'micro-sr-levels',      // 100 — Micro S/R levels
      'rsi-overbought',       // 100 — Overbought reversion
      'session-open-effect',// 100 — Session quality
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
      'news-sentiment-positive',       // 100 — Crypto news flow
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
      'vix-regime',    // 100 — Kill in extreme vol
      'liquidity-check',      // 100 — Spread/volume check
      'portfolio-performance',// 100 — Don't over-allocate
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

export interface DateRangeOverride {
  start: { month: number; day: number };
  end: { month: number; day: number };
  weight: number;
  label: string;
}

export interface SeasonalAffinity {
  monthly: Record<number, number>;
  dateRanges?: DateRangeOverride[];
}

/** Protocol registry — lookup table for protocol selection */
export const PROTOCOL_REGISTRY: Record<string, { groups: DirectiveGroup[]; name: string; description: string; directionMode?: 'LONG_ONLY' | 'SHORT_ONLY' | 'BOTH'; tradingStyle?: string; recommendedTimeframe?: string; avgHoldTime?: string; winRateTarget?: string; idealFor?: string; seasonalAffinity?: SeasonalAffinity }> = {
  default: {
    groups: DIRECTIVE_GROUPS,
    name: 'SEES Default',
    description: 'General-purpose equity scoring protocol covering technical, sentiment, and risk directives.',
    tradingStyle: 'Swing / Position',
    recommendedTimeframe: '1d',
    avgHoldTime: 'Days to weeks',
    winRateTarget: '55–65%',
    idealFor: 'Equity portfolios, multi-day holds, balanced risk/reward',
    seasonalAffinity: { monthly: {} },
  },

  // ── SEES Default — SHORT variant ────────────────────
  // Uses bearish directives only. Pair with 'default' for dual-protocol scoring.

  'default-short': {
    groups: SHORT_DIRECTIVE_GROUPS,
    name: 'SEES Default (SHORT)',
    description: 'Short-side variant of SEES Default — overbought, distribution, breakdown detection.',
    directionMode: 'SHORT_ONLY',
    tradingStyle: 'Swing / Position',
    recommendedTimeframe: '1d',
    avgHoldTime: 'Days to weeks',
    winRateTarget: '50–60%',
    idealFor: 'Short-side opportunities, bearish reversals, profit-taking exits',
    seasonalAffinity: { monthly: {} },
  },

  // ── Built-in Default ─────────────────────────────────
  // Always-available protocol using only MT5-sourced directives.
  // Seeded as the default scoring + trading strategy on first run.
  // Zero external API dependencies — works with MetaQuotes-Demo out of the box.

  'built-in-default': {
    groups: [
      {
        id: 'technical',
        name: 'Core Technicals',
        description: 'MT5 price/candle data only — momentum, volume, patterns',
        weight: 0.45,
        isRiskGate: false,
        minMultiplier: 1.0,
        maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',           // 120 — Price velocity
          'rsi-oversold',             // 120 — Oversold bounce
          'macd-crossover',           // 110 — Trend change
          'volume-confirmation',      // 100 — Volume validates
          'bollinger-band-squeeze',        // 100 — Vol compression
          'doji-pattern',             // 100 — Reversal
          'engulfing-pattern',        // 100 — Strong reversal
          'support-resistance-levels',       // 100 — Key levels
          'atr-dip',                  //  95 — Normalised pullback
          'momentum-exhaustion',      // 100 — Trend fatigue
        ],
        directiveMaxScores: {
          'speed-momentum': 120,
          'rsi-oversold': 120,
          'macd-crossover': 110,
          'atr-dip': 95,
        },
      },
      {
        id: 'sentiment',
        name: 'Macro Context',
        description: 'DXY regime from EURUSD proxy — always available from MT5',
        weight: 0.15,
        isRiskGate: false,
        minMultiplier: 1.0,
        maxMultiplier: 1.0,
        directiveIds: [
          'dxy-regime',               // 100 — USD strength proxy
        ],
      },
      {
        id: 'risk',
        name: 'Position Risk',
        description: 'Budget, liquidity, and session timing — protects the account',
        weight: 0.40,
        isRiskGate: true,
        minMultiplier: 0.4,
        maxMultiplier: 1.2,
        directiveIds: [
          'budget-gate',              // 100 — Signal budget
          'liquidity-check',          //  80 — Spread/volume
          'rollover-risk',            // 100 — Avoid rollover
          'session-open-effect',      // 110 — Trade only active hours
          'position-size-confidence', // 100 — Size by confidence
        ],
        directiveMaxScores: {
          'liquidity-check': 80,
          'session-open-effect': 110,
        },
      },
    ],
    name: 'Built-in Default',
    description: 'Always-available default protocol. Uses only MT5 price/candle data — no external API keys needed. Works with MetaQuotes-Demo out of the box. 16 directives across technicals, macro context, and risk gates. Designed to give meaningful signals without any configuration.',
    tradingStyle: 'Swing / Intraday',
    recommendedTimeframe: '15m',
    avgHoldTime: '1–4 hours',
    winRateTarget: '55–65%',
    idealFor: 'Default pipeline — EURUSD, GBPUSD, XAUUSD on MT5 demo. Zero-config startup. Always shows in Scoring + Trading pages.',
  },

  // ── Built-in Default — SHORT variant ─────────────────
  // Mirrors built-in-default but with bearish directives for short-side scoring.
  // Pair with built-in-default for dual-protocol comparison.

  'built-in-short': {
    groups: [
      {
        id: 'bearish-technical',
        name: 'Bearish Core Technicals',
        description: 'MT5 price/candle — overbought, breakdown, distribution',
        weight: 0.45,
        isRiskGate: false,
        minMultiplier: 1.0,
        maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',
          'rsi-overbought',
          'macd-crossover',
          'stochastic',
          'bollinger-band-squeeze',
          'doji-pattern',
          'engulfing-pattern',
          'pin-bar-pattern',
          'resistance-levels-strategy',
          'momentum-exhaustion',
        ],
        directiveMaxScores: {
          'speed-momentum': 120,
          'rsi-overbought': 100,
          'macd-crossover': 110,
        },
      },
      {
        id: 'bearish-sentiment',
        name: 'Macro Context',
        description: 'DXY regime — USD strength as headwind',
        weight: 0.15,
        isRiskGate: false,
        minMultiplier: 1.0,
        maxMultiplier: 1.0,
        directiveIds: [
          'dxy-regime',
        ],
      },
      {
        id: 'short-risk',
        name: 'Short-Side Risk',
        description: 'Budget, liquidity, session timing — short-side risk gates',
        weight: 0.40,
        isRiskGate: true,
        minMultiplier: 0.4,
        maxMultiplier: 1.2,
        directiveIds: [
          'budget-gate',
          'liquidity-check',
          'rollover-risk',
          'session-open-effect',
          'position-size-confidence',
        ],
        directiveMaxScores: {
          'liquidity-check': 80,
          'session-open-effect': 110,
        },
      },
    ],
    name: 'Built-in Default (SHORT)',
    description: 'Short-side variant of Built-in Default. Uses bearish MT5 directives — overbought, breakdown, distribution. Pair with built-in-default for dual-protocol BUY/SELL comparison.',
    directionMode: 'SHORT_ONLY',
    tradingStyle: 'Swing / Intraday',
    recommendedTimeframe: '15m',
    avgHoldTime: '1–4 hours',
    winRateTarget: '50–60%',
    idealFor: 'Short opportunities, bearish reversals. Pairs with built-in-default for dual scoring.',
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
    seasonalAffinity: {
      monthly: { 0: 0.05, 1: -0.05, 2: 0.10, 3: 0.10, 4: 0.05, 5: -0.05, 6: 0.00, 7: 0.05, 8: -0.05, 9: 0.00, 10: 0.15, 11: 0.20 },
      dateRanges: [{ start: {month:3,day:15}, end: {month:5,day:15}, weight: 0.10, label: 'Pre-halving rally window' }],
    },
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
          'bollinger-band-squeeze',    // 100 — Micro-squeeze before tick breakout
          'volume-confirmation',  // 100 — Volume micro-spike confirms entry
          'rsi-oversold',         // 120 — Tick-level oversold bounce
          'rsi-overbought',       // 100 — Tick-level overbought reversion
          'support-resistance-levels',   // 100 — Micro S/R (round numbers, prior wicks)
          'multi-timeframe-trend',// 120 — 1D/1H/15M trend alignment
          'micro-sr-levels',      // 100 — Session S/R, VWAP, round numbers
          'volatility-tools',        // 100 — Micro ATR for stop placement
          'session-open-effect',// 100 — Only trade liquid sessions
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Background Sentiment',
        description: 'Lightweight sentiment — fundamentals don\'t move in <1min but extreme fear/greed sets tone',
        weight: 0.20, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'crypto-fear-greed',    //  60 — Background risk appetite
          'news-sentiment-positive',       // 100 — Avoid entries during high-impact news
        ],
        directiveMaxScores: { 'crypto-fear-greed': 60 },
      },
      {
        id: 'risk', name: 'Execution Risk',
        description: 'Heavy risk gating — execution quality is everything for $1 scalps. Wide spreads, low liquidity, or extreme vol = no trade.',
        weight: 0.40, isRiskGate: true, minMultiplier: 0.5, maxMultiplier: 1.3,
        directiveIds: [
          'liquidity-check',      // 100 — Spread/volume must support $1 entries
          'vix-regime',    // 100 — Extreme vol kills tick scalps
          'crypto-weekend-effect',//  50 — Weekend liquidity dry-up
          'portfolio-performance',// 100 — Don't over-allocate scalp positions
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
    seasonalAffinity: { monthly: { 0: 0.05, 1: -0.05, 2: 0.10, 3: 0.10, 4: 0.05, 5: -0.05, 6: 0.00, 7: 0.05, 8: -0.05, 9: 0.00, 10: 0.15, 11: 0.20 } },
  },

  // ── XAU: Gold Speed Scalp V1 ──

  'xau-speed-v1': {
    groups: [
      {
        id: 'technical', name: 'Micro-Structure Technicals',
        description: 'Gold micro-moves: momentum, squeezes, volume spikes for sub-minute entries',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — Gold micro-velocity
          'bollinger-band-squeeze',    // 100 — Squeeze before data releases
          'volume-confirmation',  // 100 — Volume spike confirms gold move
          'volatility-tools',        // 100 — Micro-ATR for gold tick sizing
          'rsi-oversold',         // 120 — Gold oversold bounce
          'rsi-overbought',       // 100 — Gold overbought reversion
          'support-resistance-levels',   // 100 — Gold round numbers ($2000, $2050...)
          'session-open-effect',// 100 — Only liquid gold sessions
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Sentiment & Macro Context',
        description: 'Gold IS sentiment — DXY, real rates, fear gauge',
        weight: 0.20, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',            // 100 — Gold reacts to every headline
          'gold-macro-correlation',    // 100 — DXY/real rates context
        ],
      },
      {
        id: 'risk', name: 'Execution Risk',
        description: 'Gold-specific: spread widening during news, weekend gaps, over-allocation',
        weight: 0.40, isRiskGate: true, minMultiplier: 0.4, maxMultiplier: 1.3,
        directiveIds: [
          'vix-regime',     // 100 — Extreme vol kills gold scalps
          'liquidity-check',       // 100 — Gold spreads widen on news
          'portfolio-performance',// 100 — Don't over-allocate gold
          'crypto-weekend-effect', //  50 — Weekend gap risk (thin gold weekends)
        ],
        directiveMaxScores: { 'crypto-weekend-effect': 50 },
      },
    ],
    name: 'Gold Speed Scalp V1',
    description: 'Sub-minute gold (XAUUSD) scalping protocol. Gold is the ultimate fear gauge — volatile during CPI, FOMC, NFP, geopolitics. Tight spreads, massive liquidity. Reacts to USD strength and real rates.',
    tradingStyle: 'Tick Scalp',
    recommendedTimeframe: '5s–30s',
    avgHoldTime: 'Seconds to a few minutes',
    winRateTarget: '65–75%',
    idealFor: 'XTrend gold speed trading during London/NY overlap (12:00–16:00 GMT). Avoid first 5min after major news — spreads widen dramatically.',
    seasonalAffinity: {
      monthly: { 0: 0.15, 1: 0.10, 2: 0.00, 3: 0.00, 4: -0.10, 5: -0.10, 6: -0.05, 7: -0.05, 8: 0.15, 9: 0.10, 10: 0.05, 11: 0.15 },
      dateRanges: [{ start: {month:7,day:15}, end: {month:9,day:15}, weight: 0.10, label: 'Gold seasonal strength Aug–Sep' }],
    },
  },

  // ── OIL: WTI Speed Scalp V1 ──

  'oil-speed-v1': {
    groups: [
      {
        id: 'technical', name: 'Micro-Structure Technicals',
        description: 'Oil micro-moves: momentum, squeezes, volume for sub-minute entries',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — Oil micro-velocity
          'bollinger-band-squeeze',    // 100 — Squeeze before EIA/OPEC events
          'volume-confirmation',  // 100 — Volume spike confirms crude move
          'volatility-tools',        // 100 — Micro-ATR for oil tick sizing
          'rsi-oversold',         // 120 — Oil oversold bounce (mean reversion)
          'rsi-overbought',       // 100 — Oil overbought reversion
          'support-resistance-levels',   // 100 — Oil key levels ($70, $75, $80, $85)
          'session-open-effect',// 100 — NY session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Sentiment & Fundamentals',
        description: 'Oil drivers: OPEC, EIA, geopolitics, USD',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',            // 100 — OPEC, EIA, geopolitics dominate
          'cad-usd-oil-correlation',   // 100 — Oil/CAD correlation confirmation
        ],
      },
      {
        id: 'risk', name: 'Execution Risk',
        description: 'Oil-specific: geopolitical vol spikes, NY session liquidity windows',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.45, maxMultiplier: 1.3,
        directiveIds: [
          'vix-regime',     // 100 — Oil vol spikes on geopolitics
          'liquidity-check',       // 100 — Crude spreads matter for $1 scalps
          'portfolio-performance',// 100 — Don't over-allocate energy
          'session-open-effect',   // 100 — NY open crude moves
        ],
      },
    ],
    name: 'Oil Speed Scalp V1',
    description: 'Sub-minute WTI crude (USOIL) scalping protocol. Extremely event-driven — EIA inventories, OPEC headlines, geopolitical supply shocks. Strong mean-reverting tendencies within daily ranges.',
    tradingStyle: 'Tick Scalp',
    recommendedTimeframe: '5s–30s',
    avgHoldTime: 'Seconds to a few minutes',
    winRateTarget: '65–75%',
    idealFor: 'XTrend oil speed trading during NY session (13:30–20:00 GMT). EIA report Wednesdays 14:30 GMT = massive volatility. Avoid Asian session — oil is thin and whippy.',
    seasonalAffinity: { monthly: { 0: -0.05, 1: 0.00, 2: 0.10, 3: 0.10, 4: 0.05, 5: 0.15, 6: 0.15, 7: 0.10, 8: 0.10, 9: 0.00, 10: -0.10, 11: -0.10 }, dateRanges: [{ start: {month:5,day:1}, end: {month:8,day:31}, weight: 0.10, label: 'Summer driving season' }] },
  },

  // ── SPY: Speed Scalp V1 ──

  'spy-speed-v1': {
    groups: [
      {
        id: 'technical', name: 'Options-Driven Micro-Structure',
        description: 'Gamma pinning, round-number S/R, micro momentum — SPY is driven by options flow',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — Gamma acceleration in last hour
          'bollinger-band-squeeze',    // 100 — Pre-breakout squeeze at strikes
          'volume-confirmation',  // 100 — Options-driven volume spikes
          'volatility-tools',        // 100 — Micro-ATR for stop placement
          'rsi-oversold',         // 120 — Oversold at max pain level
          'rsi-overbought',       // 100 — Overbought at gamma wall
          'support-resistance-levels',   // 100 — SPY $5/$10 strike clusters
          'session-open-effect',// 100 — US session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Market Context',
        description: 'VIX, breadth, macro — SPY is the market',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — Econ data, Fed, earnings
          'vix-regime',           // 100 — VIX/SPY inverse correlation
        ],
      },
      {
        id: 'risk', name: 'Session & Execution Risk',
        description: 'SPY doesn\'t gap 5% — tighter risk gates than crypto',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.5, maxMultiplier: 1.25,
        directiveIds: [
          'vix-regime',    // 100 — Extreme VIX kills scalps
          'liquidity-check',      // 100 — SPY always liquid but check spread
          'portfolio-performance',// 100 — Don't over-allocate indices
          'session-open-effect',  // 100 — First 30min sets daily range
        ],
      },
    ],
    name: 'SPY Speed Scalp V1',
    description: 'Sub-minute SPX500/SPY scalping protocol. Exploits options-driven micro-structure: gamma pinning at strikes, 0DTE max pain gravity, opening drive and power hour momentum. The most liquid instrument on Earth.',
    tradingStyle: 'Tick Scalp',
    recommendedTimeframe: '5s–30s',
    avgHoldTime: 'Seconds to a few minutes',
    winRateTarget: '65–75%',
    idealFor: 'XTrend SPX500 speed trading during US session (14:30–21:00 GMT). Best during opening drive (first 30min) and power hour (last 60min) when gamma flows are strongest.',
    seasonalAffinity: { monthly: { 0: 0.10, 1: 0.05, 2: 0.00, 3: 0.10, 4: -0.05, 5: -0.10, 6: -0.10, 7: -0.05, 8: -0.15, 9: 0.05, 10: 0.10, 11: 0.15 }, dateRanges: [{ start: {month:11,day:24}, end: {month:0,day:2}, weight: 0.20, label: 'Santa Claus Rally' }] },
  },

  // ── SPY: Day Trading V1 ──

  'spy-day-v1': {
    groups: [
      {
        id: 'technical', name: 'Session Structure Technicals',
        description: 'Opening range, VWAP, trend, power hour — SPY day trading is session structure',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'ema-structure',        // 100 — 9/21/50 EMA alignment for trend
          'macd-crossover',       // 110 — Session trend changes
          'bollinger-band-squeeze',    // 100 — Pre-breakout compression
          'volume-confirmation',  // 100 — Institutional volume profile
          'support-resistance-levels',   // 100 — Key SPY levels ($500, $510, $520...)
          'speed-momentum',         // 100 — Intraday momentum shifts
          'rsi-oversold',         // 120 — VWAP bounce oversold
          'rsi-overbought',       // 100 — Overbought at resistance
        ],
        directiveMaxScores: { 'macd-crossover': 110, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Macro & Breadth',
        description: 'VIX, market breadth, Fed posture',
        weight: 0.30, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — Econ data dominates SPY
          'vix-regime',           // 100 — VIX/SPY correlation
          'analyst-adjustments',    // 100 — Wall Street SPY targets
        ],
      },
      {
        id: 'risk', name: 'Position & Session Risk',
        description: 'Day trade risk — session quality, position sizing, overnight avoidance',
        weight: 0.30, isRiskGate: true, minMultiplier: 0.55, maxMultiplier: 1.2,
        directiveIds: [
          'vix-regime',    // 100 — Don't day trade during VIX > 30
          'session-open-effect',// 100 — Only trade liquid US hours
          'liquidity-check',      // 100 — SPY always liquid but check
          'portfolio-performance',// 100 — Index allocation cap
        ],
      },
    ],
    name: 'SPY Day Trade V1',
    description: 'SPX500/SPY day trading protocol for multi-hour holds. Uses session structure — opening range, VWAP gravity, lunch drift, power hour acceleration. Not for scalping — positions held minutes to hours.',
    tradingStyle: 'Day Trade',
    recommendedTimeframe: '5m–1h',
    avgHoldTime: 'Minutes to hours',
    winRateTarget: '55–65%',
    idealFor: 'XTrend SPX500 day trading during full US session. Best entries: opening range break (first 30min), VWAP reversion mid-day, power hour trend (last 60min).',
    seasonalAffinity: { monthly: { 0: 0.10, 1: 0.05, 2: 0.00, 3: 0.10, 4: -0.05, 5: -0.10, 6: -0.10, 7: -0.05, 8: -0.15, 9: 0.05, 10: 0.10, 11: 0.15 }, dateRanges: [{ start: {month:11,day:24}, end: {month:0,day:2}, weight: 0.20, label: 'Santa Claus Rally' }, { start: {month:2,day:15}, end: {month:2,day:21}, weight: -0.10, label: 'Triple Witching' }] },
  },

  // ── QQQ: Speed Scalp V1 ──

  'qqq-speed-v1': {
    groups: [
      {
        id: 'technical', name: 'Tech Momentum Micro-Structure',
        description: 'QQQ trends harder than SPY — higher beta needs stronger momentum detection',
        weight: 0.45, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — Higher beta = stronger momentum signals
          'bollinger-band-squeeze',    // 100 — Tech squeeze before earnings/macro
          'volume-confirmation',  // 100 — NVDA/AAPL/MSFT volume dominance
          'volatility-tools',        // 100 — Wider ATR for tech volatility
          'rsi-oversold',         // 120 — Tech dip buying
          'rsi-overbought',       // 100 — Tech overbought = trend continuation
          'support-resistance-levels',   // 100 — QQQ round numbers
          'session-open-effect',// 100 — US session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Tech Sentiment',
        description: 'Tech earnings, rates sensitivity, risk appetite',
        weight: 0.20, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — Tech earnings, AI news, rate decisions
          'analyst-adjustments',    // 100 — Tech analyst targets matter more
        ],
      },
      {
        id: 'risk', name: 'High Beta Risk',
        description: 'QQQ moves 1.2x SPY — wider risk gate to allow for beta amplification',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.45, maxMultiplier: 1.3,
        directiveIds: [
          'vix-regime',    // 100 — Tech vol ≠ market vol
          'liquidity-check',      // 100 — QQQ always liquid but spreads widen in panic
          'portfolio-performance',// 100 — Tech allocation cap
          'session-open-effect',  // 100 — Tech opens with momentum
        ],
      },
    ],
    name: 'QQQ Speed Scalp V1',
    description: 'Sub-minute TECH100/QQQ scalping protocol. Higher beta than SPY — wider risk gates, stronger momentum weighting. NVDA/AAPL/MSFT drive 30% of movement. Tech earnings season adds volatility premium.',
    tradingStyle: 'Tick Scalp',
    recommendedTimeframe: '5s–30s',
    avgHoldTime: 'Seconds to a few minutes',
    winRateTarget: '65–75%',
    idealFor: 'XTrend TECH100 speed trading during US session. Best during tech earnings season and AI news cycles when QQQ vol is elevated.',
    seasonalAffinity: { monthly: { 0: 0.15, 1: 0.10, 2: 0.00, 3: 0.10, 4: -0.05, 5: -0.05, 6: -0.05, 7: -0.05, 8: -0.10, 9: 0.10, 10: 0.15, 11: 0.15 }, dateRanges: [{ start: {month:0,day:15}, end: {month:1,day:15}, weight: 0.10, label: 'Tech earnings season Q4' }, { start: {month:6,day:15}, end: {month:7,day:31}, weight: 0.10, label: 'Tech earnings season Q2' }] },
  },

  // ── QQQ: Day Trading V1 ──

  'qqq-day-v1': {
    groups: [
      {
        id: 'technical', name: 'Tech Trend Technicals',
        description: 'QQQ trends — trend following dominates mean reversion',
        weight: 0.45, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'ema-structure',        // 100 — Tech trend structure
          'macd-crossover',       // 110 — Trend changes on tech
          'bollinger-band-squeeze',    // 100 — Squeeze before earnings/macro
          'volume-confirmation',  // 100 — NVDA/AAPL/MSFT volume confirms
          'speed-momentum',         // 100 — Tech momentum is everything
          'support-resistance-levels',   // 100 — QQQ key levels
          'rsi-oversold',         // 120 — Tech dip = buy
          'rsi-overbought',       // 100 — Tech OB = stay long
        ],
        directiveMaxScores: { 'macd-crossover': 110, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Tech Fundamentals',
        description: 'Earnings, AI, rates — tech lives and dies by sentiment',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — Tech news cycles
          'analyst-adjustments',    // 100 — Tech analyst targets
          'earnings-proximity',   // 100 — Earnings season risk/reward
        ],
      },
      {
        id: 'risk', name: 'Tech Concentration Risk',
        description: 'Top 3 stocks = 30% of QQQ — concentration risk is real',
        weight: 0.30, isRiskGate: true, minMultiplier: 0.45, maxMultiplier: 1.3,
        directiveIds: [
          'vix-regime',    // 100 — Tech vol spikes on earnings
          'session-open-effect',// 100 — US session only
          'liquidity-check',      // 100 — Check spreads
          'portfolio-performance',// 100 — Index allocation cap
        ],
      },
    ],
    name: 'QQQ Day Trade V1',
    description: 'TECH100/QQQ day trading protocol. Trend-following bias — QQQ trends harder and mean-reverts less than SPY. Higher beta = bigger moves. Tech earnings season provides volatility catalysts.',
    tradingStyle: 'Day Trade',
    recommendedTimeframe: '5m–1h',
    avgHoldTime: 'Minutes to hours',
    winRateTarget: '55–65%',
    idealFor: 'XTrend TECH100 day trading during US session. Follow the trend — QQQ trends last longer than SPY. Best during tech earnings (Jan/Apr/Jul/Oct) and AI news cycles.',
    seasonalAffinity: { monthly: { 0: 0.15, 1: 0.10, 2: 0.00, 3: 0.10, 4: -0.05, 5: -0.05, 6: -0.05, 7: 0.05, 8: -0.10, 9: 0.10, 10: 0.15, 11: 0.15 }, dateRanges: [{ start: {month:6,day:15}, end: {month:7,day:31}, weight: 0.15, label: 'Tech earnings season summer' }] },
  },

  // ── US30: Dow Speed Scalp V1 ──

  'dow-speed-v1': {
    groups: [
      {
        id: 'technical', name: 'Industrial Micro-Structure',
        description: 'Dow is lower-beta, cyclicals-heavy — different rhythm than SPY/QQQ',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — Dow momentum (lower amplitude)
          'bollinger-band-squeeze',    // 100 — Squeeze before sector rotation
          'volume-confirmation',  // 100 — Volume confirms rotation
          'volatility-tools',        // 100 — Lower ATR, tighter stops
          'rsi-oversold',         // 120 — Value dip buying
          'rsi-overbought',       // 100 — Overbought cyclicals
          'support-resistance-levels',   // 100 — DJI respects round thousands
          'session-open-effect',// 100 — US session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Cyclical Sentiment',
        description: 'Dow is value/cyclicals — rates, inflation, employment',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — Econ data, Fed, employment
          'analyst-adjustments',    // 100 — Industrial analyst targets
        ],
      },
      {
        id: 'risk', name: 'Value Rotation Risk',
        description: 'Lower beta = tighter risk gate. Dow doesn\'t gap like QQQ.',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.55, maxMultiplier: 1.2,
        directiveIds: [
          'vix-regime',    // 100 — Dow vol is lower
          'liquidity-check',      // 100 — Always liquid but check
          'portfolio-performance',// 100 — Index allocation cap
          'session-open-effect',  // 100 — NY open rotation
        ],
      },
    ],
    name: 'Dow Speed Scalp V1',
    description: 'Sub-minute US30/DJI30 scalping protocol. Lower beta than SPY/QQQ — tighter risk gates, more emphasis on sector rotation and value/cyclical patterns. 30 industrial stocks, less tech-driven.',
    tradingStyle: 'Tick Scalp',
    recommendedTimeframe: '5s–30s',
    avgHoldTime: 'Seconds to a few minutes',
    winRateTarget: '65–75%',
    idealFor: 'XTrend US30/DJI30 speed trading during US session. Less volatile than SPY — tighter stops, smaller profit targets. Best during sector rotation days.',
    seasonalAffinity: { monthly: { 0: 0.10, 1: 0.05, 2: 0.00, 3: 0.10, 4: -0.05, 5: -0.10, 6: -0.10, 7: -0.05, 8: -0.15, 9: 0.05, 10: 0.10, 11: 0.15 } },
  },

  // ── UK100: FTSE Speed Scalp V1 ──

  'ftse-speed-v1': {
    groups: [
      {
        id: 'technical', name: 'FTSE Micro-Structure',
        description: 'FTSE is commodity-heavy (BP, Shell, miners) — different from US indices',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — FTSE momentum
          'bollinger-band-squeeze',    // 100 — Squeeze before London open
          'volume-confirmation',  // 100 — LSE volume profile
          'volatility-tools',        // 100 — FTSE ATR (GBP-denominated)
          'rsi-oversold',         // 120 — Commodity dip buying
          'rsi-overbought',       // 100 — Overbought miners/energy
          'support-resistance-levels',   // 100 — FTSE round numbers
          'session-open-effect',// 100 — London session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'UK Macro',
        description: 'FTSE sensitive to GBP, commodities, UK econ data',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — UK econ data, BoE, commodity news
          'analyst-adjustments',    // 100 — FTSE analyst targets
        ],
      },
      {
        id: 'risk', name: 'Cross-Session Risk',
        description: 'FTSE trades London hours — gap risk from US close, Asian open',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.5, maxMultiplier: 1.2,
        directiveIds: [
          'vix-regime',    // 100 — FTSE vol during UK events
          'liquidity-check',      // 100 — Check LSE spreads
          'portfolio-performance',// 100 — Index allocation cap
          'session-open-effect',  // 100 — London open (08:00 GMT)
        ],
      },
    ],
    name: 'FTSE Speed Scalp V1',
    description: 'Sub-minute UK100/FTSE100 scalping protocol. Commodity-heavy index (BP, Shell, Rio Tinto, Glencore) — sensitive to commodity prices and GBP. London session only.',
    tradingStyle: 'Tick Scalp',
    recommendedTimeframe: '5s–30s',
    avgHoldTime: 'Seconds to a few minutes',
    winRateTarget: '65–75%',
    idealFor: 'XTrend UK100 speed trading during London session (08:00–16:30 GMT). Best during UK econ data releases and commodity price moves.',
    seasonalAffinity: { monthly: { 0: 0.10, 1: 0.05, 2: 0.00, 3: 0.10, 4: -0.05, 5: -0.05, 6: -0.05, 7: -0.05, 8: -0.10, 9: 0.00, 10: 0.05, 11: 0.10 } },
  },

  // ── TSLA: Single Stock Speed Scalp V1 ──

  'tsla-speed-v1': {
    groups: [
      {
        id: 'technical', name: 'Tesla Micro-Structure',
        description: 'TSLA is the most volatile large-cap — Elon tweets, earnings, delivery numbers',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — TSLA moves fast
          'bollinger-band-squeeze',    // 100 — Squeeze before Elon/news
          'volume-confirmation',  // 100 — TSLA volume is massive
          'volatility-tools',        // 100 — TSLA ATR is huge for a stock
          'rsi-oversold',         // 120 — TSLA dip = generational buy (usually)
          'rsi-overbought',       // 100 — TSLA OB can keep running
          'support-resistance-levels',   // 100 — TSLA round numbers + fib levels
          'session-open-effect',// 100 — US session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Elon Factor',
        description: 'TSLA sentiment is unique — Elon, deliveries, AI narrative',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — Elon tweets, delivery numbers, product launches
          'social-buzz',          // 100 — TSLA social media activity is predictive
        ],
      },
      {
        id: 'risk', name: 'Single Stock Risk',
        description: 'TSLA is NOT an index — idiosyncratic risk requires wider gates',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.4, maxMultiplier: 1.35,
        directiveIds: [
          'vix-regime',    // 100 — TSLA vol can spike 2-3x normal
          'liquidity-check',      // 100 — TSLA always liquid but spreads widen
          'portfolio-performance',// 100 — Single stock risk — tighter allocation
          'earnings-proximity',   // 100 — Earnings risk/reward
        ],
      },
    ],
    name: 'TSLA Speed Scalp V1',
    description: 'Sub-minute Tesla (TSLA) single-stock scalping protocol. The most volatile mega-cap — Elon factor, delivery numbers, AI narrative. Much wider risk gates than index protocols.',
    tradingStyle: 'Tick Scalp',
    recommendedTimeframe: '5s–30s',
    avgHoldTime: 'Seconds to a few minutes',
    winRateTarget: '60–70%',
    idealFor: 'XTrend TSLA speed trading during US session. Expect wider spreads than indices. Do NOT hold through earnings. Elon tweets can move the stock 5% in minutes.',
    seasonalAffinity: { monthly: { 0: 0.15, 1: 0.10, 2: 0.00, 3: 0.10, 4: -0.05, 5: -0.05, 6: -0.05, 7: 0.05, 8: -0.10, 9: 0.10, 10: 0.15, 11: 0.15 } },
  },

  // ── DOGE: Meme Coin Speed Scalp V1 ──

  'doge-speed-v1': {
    groups: [
      {
        id: 'technical', name: 'Meme Coin Micro-Structure',
        description: 'DOGE is pure momentum — no fundamentals, all sentiment and flow',
        weight: 0.45, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — DOGE momentum is everything
          'bollinger-band-squeeze',    // 100 — Squeeze before Elon tweet / community event
          'volume-confirmation',  // 100 — DOGE volume spikes on social
          'volatility-tools',        // 100 — DOGE ATR is enormous
          'rsi-oversold',         // 120 — Meme dip = buy (usually)
          'rsi-overbought',       // 100 — DOGE OB = FOMO, can run further
          'support-resistance-levels',   // 100 — DOGE respects round cents
          'session-open-effect',// 100 — 24/7 but US peak is most active
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Meme Sentiment',
        description: 'DOGE lives and dies by social media',
        weight: 0.30, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'social-buzz',          // 100 — Social media drives DOGE
          'crypto-fear-greed',    //  60 — Background crypto sentiment
        ],
        directiveMaxScores: { 'crypto-fear-greed': 60 },
      },
      {
        id: 'risk', name: 'Meme Coin Risk',
        description: 'DOGE can drop 20% in an hour — wide risk gates essential',
        weight: 0.25, isRiskGate: true, minMultiplier: 0.35, maxMultiplier: 1.4,
        directiveIds: [
          'vix-regime',    // 100 — DOGE vol is extreme
          'liquidity-check',      // 100 — DOGE spreads can be wide
          'portfolio-performance',// 100 — Meme coin = tiny allocation
        ],
      },
    ],
    name: 'DOGE Speed Scalp V1',
    description: 'Sub-minute Dogecoin (DOGE) scalping protocol. Pure momentum and social sentiment — no fundamentals, no earnings, just flow. The widest risk gates of any protocol.',
    tradingStyle: 'Tick Scalp',
    recommendedTimeframe: '5s–30s',
    avgHoldTime: 'Seconds — get in, get out',
    winRateTarget: '55–65%',
    idealFor: 'XTrend DOGE speed trading — absolute smallest position size ($1). Meme coins can drop 20% in minutes. Use tightest possible stops. Only trade during high social activity.',
    seasonalAffinity: { monthly: { 0: 0.05, 1: -0.05, 2: 0.10, 3: 0.10, 4: 0.05, 5: -0.05, 6: 0.00, 7: 0.05, 8: -0.05, 9: 0.00, 10: 0.15, 11: 0.20 } },
  },

  // ── CHINA50: China Index Speed Scalp V1 ──

  'china-speed-v1': {
    groups: [
      {
        id: 'technical', name: 'China A50 Micro-Structure',
        description: 'CHINA50 is government-influenced — different from free markets',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — China momentum (policy-driven)
          'bollinger-band-squeeze',    // 100 — Squeeze before policy announcements
          'volume-confirmation',  // 100 — Volume on Shanghai/Shenzhen
          'volatility-tools',        // 100 — CHINA50 ATR (policy events)
          'rsi-oversold',         // 120 — China dips on regulatory fear
          'rsi-overbought',       // 100 — China OB on stimulus
          'support-resistance-levels',   // 100 — Round numbers + government intervention levels
          'session-open-effect',// 100 — Asian session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Policy Sentiment',
        description: 'China is policy-driven — PBoC, Politburo, regulatory announcements',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — PBoC, regulatory, trade war news
          'analyst-adjustments',    // 100 — China analyst targets
        ],
      },
      {
        id: 'risk', name: 'Policy & Session Risk',
        description: 'Government intervention, circuit breakers, capital controls',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.35, maxMultiplier: 1.3,
        directiveIds: [
          'vix-regime',    // 100 — China vol on policy events
          'liquidity-check',      // 100 — CHINA50 spreads can be wide
          'portfolio-performance',// 100 — Emerging market allocation
        ],
      },
    ],
    name: 'CHINA50 Speed Scalp V1',
    description: 'Sub-minute CHINA50/A50 scalping protocol. Policy-driven index — PBoC decisions, Politburo statements, regulatory announcements dominate. Government intervention risk is real.',
    tradingStyle: 'Tick Scalp',
    recommendedTimeframe: '5s–30s',
    avgHoldTime: 'Seconds to a few minutes',
    winRateTarget: '60–70%',
    idealFor: 'XTrend CHINA50 speed trading during Asian session (01:00–09:00 GMT). Government can halt trading or intervene at any time. Use extreme caution.',
    seasonalAffinity: { monthly: { 0: 0.05, 1: -0.10, 2: 0.10, 3: 0.00, 4: -0.05, 5: -0.05, 6: 0.00, 7: 0.00, 8: -0.05, 9: 0.10, 10: 0.05, 11: 0.00 }, dateRanges: [{ start: {month:0,day:20}, end: {month:1,day:15}, weight: -0.10, label: 'Chinese New Year — thin liquidity' }] },
  },

  // ── Momentum Stocks: Group Protocol V1 ──

  'momentum-stock-v1': {
    groups: [
      {
        id: 'technical', name: 'Momentum Technicals',
        description: 'Momentum stocks trend harder — stronger trend following, less mean reversion',
        weight: 0.35, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — Momentum stocks accelerate
          'ema-structure',        // 100 — Multi-timeframe trend alignment
          'macd-crossover',       // 110 — Trend change signals
          'volume-confirmation',  // 100 — Institutional flow confirmation
          'bollinger-band-squeeze',    // 100 — Squeeze before breakouts
          'rsi-oversold',         // 120 — Dip-buying momentum (oversold = opportunity)
          'support-resistance-levels',   // 100 — Key levels matter for hot stocks
          'speed-momentum',         // 100 — Rate of change confirms trend strength
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'macd-crossover': 110, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Sentiment & Expectations',
        description: 'Momentum stocks live and die by analyst targets, news flow, and earnings surprises',
        weight: 0.35, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — News drives momentum stocks
          'analyst-adjustments',    // 100 — Upgrades/downgrades move these stocks
          'social-buzz',          // 100 — Reddit/Twitter/StockTwits activity
          'earnings-proximity',   // 100 — Earnings are make-or-break events
        ],
      },
      {
        id: 'risk', name: 'High-Momentum Risk',
        description: 'These stocks can drop 40% in a month — wider risk gates than steady stocks',
        weight: 0.30, isRiskGate: true, minMultiplier: 0.40, maxMultiplier: 1.30,
        directiveIds: [
          'vix-regime',    // 100 — Momentum vol is high, set expectations
          'liquidity-check',      // 100 — Tight spreads essential for entry
          'portfolio-performance',// 100 — Don't over-allocate single momentum names
          'earnings-momentum',    // 100 — Post-earnings drift is real
        ],
      },
    ],
    name: 'Momentum Stocks V1',
    description: 'Group protocol for stocks with 100%+ annual gains and continued high expectations. Trend-following bias — winners keep winning until they don\'t. Higher sentiment weight than index protocols — these stocks are driven by narrative.',
    tradingStyle: 'Day Trade / Swing',
    recommendedTimeframe: '5m–1d',
    avgHoldTime: 'Hours to days',
    winRateTarget: '55–65%',
    idealFor: 'High-momentum stocks: NVDA, MSTR, PLTR, AVGO, COIN, MARA, RIOT, HOOD, RKLB, ASTS, SOFI. Score the wishlist, trade the top 1-2 signals. Never hold through earnings without confirmation.',
    seasonalAffinity: { monthly: { 0: 0.10, 1: 0.05, 2: 0.00, 3: 0.10, 4: -0.05, 5: -0.10, 6: -0.10, 7: -0.05, 8: -0.15, 9: 0.05, 10: 0.10, 11: 0.15 } },
  },

  // ── Pandemic/Health Crisis: Group Protocol V1 ──

  'pandemic-v1': {
    groups: [
      {
        id: 'technical', name: 'Event-Driven Technicals',
        description: 'Health crisis stocks move on headlines — momentum with catalyst awareness',
        weight: 0.35, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — Outbreak news = instant momentum
          'volume-confirmation',  // 100 — Volume spike confirms headline move
          'bollinger-band-squeeze',    // 100 — Squeeze before trial results / WHO announcements
          'rsi-oversold',         // 120 — Overreaction dip-buying on negative headlines
          'rsi-overbought',       // 100 — Overbought on panic = reversion opportunity
          'support-resistance-levels',   // 100 — Bio/pharma respects key levels
          'volatility-tools',        // 100 — Biotech ATR explodes on news
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'News & Crisis Sentiment',
        description: 'Pandemic stocks ARE sentiment — WHO, CDC, government contracts drive everything',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — WHO/CDC headlines, trial results, gov contracts
          'social-buzz',          // 100 — Social media panic/fear tracking
          'analyst-adjustments',    // 100 — Biotech analyst upgrades on pipeline news
        ],
      },
      {
        id: 'risk', name: 'Biotech Event Risk',
        description: 'Biotech can gap 50% on trial failure — wide gates essential',
        weight: 0.25, isRiskGate: true, minMultiplier: 0.35, maxMultiplier: 1.4,
        directiveIds: [
          'vix-regime',    // 100 — Biotech vol is extreme during outbreaks
          'liquidity-check',      // 100 — Small-cap bio spreads widen dramatically
          'portfolio-performance',// 100 — Never over-allocate single biotech names
        ],
      },
    ],
    name: 'Pandemic & Health Crisis V1',
    description: 'Group protocol for pandemic/health-crisis stocks. Highest sentiment weight (40%) of any protocol — these stocks move on headlines, not technicals. Biotech gapping risk requires widest risk gate (0.35–1.40). Covers vaccines, diagnostics, supply chain, bio-defense.',
    tradingStyle: 'Event-Driven / Swing',
    recommendedTimeframe: '5m–1d',
    avgHoldTime: 'Hours to days (event-dependent)',
    winRateTarget: '50–60%',
    idealFor: 'Pandemic watchlist stocks: PFE, MRNA, BNTX, MRK, HOLX, DHR, CVS, UNH, ECL, BAH, EBS, TDOC, CODX, SNGX. Best during outbreak news cycles, WHO declarations, BARDA contracts, and trial result announcements.',
    seasonalAffinity: { monthly: { 0: 0.15, 1: 0.10, 2: 0.00, 3: -0.05, 4: -0.05, 5: -0.10, 6: -0.10, 7: -0.10, 8: -0.05, 9: 0.00, 10: 0.05, 11: 0.10 }, dateRanges: [{ start: {month:9,day:1}, end: {month:2,day:28}, weight: 0.15, label: 'Flu season — healthcare demand surge' }] },
  },

  // ── Leverage Shares: Bidirectional Protocol V2 ──

  'leverage-v2': {
    groups: [
      {
        id: 'technical', name: 'Amplified Technicals',
        description: '9 directives across 79 symbols — indices, sectors, commodities, thematics, stocks. 3x leverage amplifies every move.',
        weight: 0.30, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — 3x amplifies momentum 3x
          'volume-confirmation',  // 100 — Volume confirms leverage flow
          'bollinger-band-squeeze',    // 100 — Squeeze = breakout imminent (3x magnitude)
          'rsi-oversold',         // 120 — Oversold leverage = violent bounce
          'rsi-overbought',       // 100 — Overbought leverage = sharp reversion
          'support-resistance-levels',   // 100 — Key levels matter 3x more
          'volatility-tools',        // 100 — ATR is 3x the underlying
          'ema-structure',        // 100 — Trend alignment across timeframes
          'session-open-effect',// 100 — Only trade liquid sessions (LSE hours)
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Market Direction & Rotation',
        description: 'With 79 diverse symbols, correlation patterns reveal macro tides vs sector rotations',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — Macro news drives indices + sectors
          'analyst-adjustments',    // 100 — Sector/stock analyst direction
          'spy-qqq-relative-strength',     // 100 — When all leverage moves together = cleaner signal
        ],
      },
      {
        id: 'risk', name: '3x Amplified Risk (79-symbol universe)',
        description: '79 symbols across 5 categories. 3x leverage = 3x drawdowns. Wider pool = wider gate for signal diversity.',
        weight: 0.45, isRiskGate: true, minMultiplier: 0.25, maxMultiplier: 1.40,
        directiveIds: [
          'vix-regime',    // 100 — VIX/fear context for 3x exposure
          'liquidity-check',      // 100 — LSE leverage spreads can gap
          'portfolio-performance',// 100 — 3x = tiny position = tight cap
          'budget-gate',          // 100 — Never over-allocate leverage capital
        ],
      },
    ],
    name: 'Leverage Shares V2',
    description: 'Bidirectional leverage protocol for 79 symbols: 55 long (3x) + 24 short (-3x). Covers indices, sectors, commodities, thematics, and single stocks. Correlation-drag detects macro tides vs sector rotation. 45% risk weight with budget gate prevents leverage over-allocation. Designed for a ~100 symbol universe.',
    tradingStyle: 'Day Trade / Scalp',
    recommendedTimeframe: '1m–15m',
    avgHoldTime: 'Minutes to hours (NOT overnight)',
    winRateTarget: '50–60%',
    idealFor: '79 Leverage Shares across 5 categories. Never hold overnight — compounding decay erodes 3x value. Position size = 1/3 of normal due to amplification. SEES scans all 79 to find the single best leverage opportunity at any moment.',
    seasonalAffinity: { monthly: { 0: 0.10, 1: 0.05, 2: 0.00, 3: 0.10, 4: -0.05, 5: -0.10, 6: -0.10, 7: -0.05, 8: -0.15, 9: 0.05, 10: 0.10, 11: 0.15 } },
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
          'bollinger-band-squeeze',   // 100 — VIX squeezes before explosions
          'volume-confirmation', // 100 — Volume spike confirms VIX move
          'volatility-tools',       // 100 — ATR explodes during VIX events
          'support-resistance-levels',  // 100 — VIX respects historical levels
          'mean-reversion',      // 100 — VIX always mean-reverts
        ],
      },
      {
        id: 'sentiment', name: 'Sentiment',
        description: 'VIX IS sentiment — fear gauge',
        weight: 0.35, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',      // 100 — Fear-driven news spikes VIX
          'vix-regime',          // 100 — What regime is VIX itself in?
        ],
      },
      {
        id: 'risk', name: 'Risk',
        description: 'VIX-specific: contango, term structure, SPX correlation',
        weight: 0.25, isRiskGate: true, minMultiplier: 0.3, maxMultiplier: 1.2,
        directiveIds: [
          'vix-regime',   // 100 — Don't fade extreme vol
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
    seasonalAffinity: { monthly: { 0: 0.00, 1: -0.05, 2: 0.10, 3: 0.05, 4: 0.00, 5: 0.00, 6: -0.05, 7: -0.05, 8: 0.15, 9: 0.10, 10: -0.05, 11: -0.05 }, dateRanges: [{ start: {month:8,day:1}, end: {month:9,day:30}, weight: 0.15, label: 'Sep/Oct volatility season' }] },
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
          'support-resistance-levels',  // 100 — Gold respects key levels ($2000, $2500)
          'bollinger-band-squeeze',   // 100 — Gold squeezes before macro moves
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
          'news-sentiment-positive',         // 100 — Geopolitical risk drives gold
          'analyst-adjustments',      // 100 — Wall Street gold targets
        ],
      },
      {
        id: 'risk', name: 'Risk',
        description: 'Gold-specific: contango, storage, correlation reversal',
        weight: 0.25, isRiskGate: true, minMultiplier: 0.3, maxMultiplier: 1.2,
        directiveIds: [
          'vix-regime',   // 100 — Gold vol ≠ equity vol
          'liquidity-check',     // 100 — Spread check on XAUUSD
          'portfolio-performance', // 100 — Don't over-allocate gold
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
    seasonalAffinity: { monthly: { 0: 0.15, 1: 0.10, 2: 0.00, 3: 0.00, 4: -0.10, 5: -0.10, 6: -0.05, 7: -0.05, 8: 0.15, 9: 0.10, 10: 0.05, 11: 0.15 } },
  },

  // ── JPN225: Nikkei Speed Scalp V1 ──

  'nikkei-speed-v1': {
    groups: [
      {
        id: 'technical', name: 'Nikkei Micro-Structure',
        description: 'JPN225 follows Nikkei 225 futures — yen sensitivity is key. Active Tokyo session only.',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — Nikkei futures momentum
          'bollinger-band-squeeze',    // 100 — Squeeze before Tokyo open
          'volume-confirmation',  // 100 — TSE volume profile
          'volatility-tools',        // 100 — JPY-denominated ATR
          'rsi-oversold',         // 120 — BOJ dip buying pattern
          'rsi-overbought',       // 100 — Overbought exporters
          'support-resistance-levels',   // 100 — Nikkei fib levels
          'session-open-effect',// 100 — Tokyo session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Japan Macro',
        description: 'JPN225 sensitive to USDJPY, BOJ policy, Asian risk appetite',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — BOJ, Japan econ data, Asia risk
          'analyst-adjustments',    // 100 — Nikkei analyst targets
        ],
      },
      {
        id: 'risk', name: 'Asian Session Risk',
        description: 'JPN225 trades Tokyo hours — thin before open, gap risk from US close',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.4, maxMultiplier: 1.2,
        directiveIds: [
          'vix-regime',    // 100 — Nikkei vol during BOJ/Asia events
          'liquidity-check',      // 100 — Check TSE spreads
          'portfolio-performance',// 100 — Index allocation cap
          'session-open-effect',  // 100 — Tokyo open (00:00 UTC)
          'rollover-risk',        // 100 — Gap risk around rollover
        ],
      },
    ],
    name: 'Nikkei Speed Scalp V1',
    description: 'Sub-minute JPN225/Nikkei225 scalping protocol. Yen-sensitive index (exporters, tech, auto). Tokyo session only (00:00–06:00 UTC). BOJ policy and USDJPY moves are primary drivers.',
    tradingStyle: 'Tick Scalp',
    recommendedTimeframe: '5s–30s',
    avgHoldTime: 'Seconds to a few minutes',
    winRateTarget: '60–70%',
    idealFor: 'XTrend JPN225 speed trading during Tokyo session. Best during BOJ announcements, Japan econ data, and USDJPY volatility.',
    seasonalAffinity: { monthly: { 0: 0.05, 1: 0.00, 2: 0.10, 3: 0.10, 4: -0.05, 5: 0.00, 6: 0.00, 7: 0.00, 8: -0.10, 9: 0.05, 10: 0.10, 11: 0.10 }, dateRanges: [{ start: {month:2,day:25}, end: {month:3,day:10}, weight: 0.10, label: 'Japanese fiscal year-end window dressing' }] },
  },

  // ── EUSTX50: Euro Stoxx Speed Scalp V1 ──

  'euro-stoxx-v1': {
    groups: [
      {
        id: 'technical', name: 'Euro Stoxx Micro-Structure',
        description: 'EUSTX50 is the Eurozone blue-chip index — banks, luxury, industrials. Frankfurt/Paris session.',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — Euro Stoxx momentum
          'bollinger-band-squeeze',    // 100 — Squeeze before European open
          'volume-confirmation',  // 100 — Euronext/Xetra volume
          'volatility-tools',        // 100 — EUR-denominated ATR
          'rsi-oversold',         // 120 — ECB dip buying pattern
          'rsi-overbought',       // 100 — Overbought luxury/industrial
          'support-resistance-levels',   // 100 — Euro Stoxx round numbers
          'session-open-effect',// 100 — European session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Eurozone Macro',
        description: 'EUSTX50 sensitive to EUR, ECB policy, EU political risk',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — ECB, EU econ data, political risk
          'analyst-adjustments',    // 100 — Euro Stoxx analyst targets
        ],
      },
      {
        id: 'risk', name: 'European Session Risk',
        description: 'EUSTX50 trades European hours — gap risk from US close, Asian open',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.45, maxMultiplier: 1.2,
        directiveIds: [
          'vix-regime',    // 100 — EStoxx vol during ECB/EU events
          'liquidity-check',      // 100 — Check Eurex spreads
          'portfolio-performance',// 100 — Index allocation cap
          'session-open-effect',  // 100 — European open (07:00 UTC)
          'rollover-risk',        // 100 — Gap risk around rollover
        ],
      },
    ],
    name: 'Euro Stoxx Speed Scalp V1',
    description: 'Sub-minute EUSTX50/EuroStoxx50 scalping protocol. Eurozone blue-chip index (SAP, LVMH, ASML, Siemens, TotalEnergies). Frankfurt/Paris session (07:00–16:30 UTC). ECB policy and EUR moves are primary drivers.',
    tradingStyle: 'Tick Scalp',
    recommendedTimeframe: '5s–30s',
    avgHoldTime: 'Seconds to a few minutes',
    winRateTarget: '60–70%',
    idealFor: 'XTrend EUSTX50 speed trading during European session. Best during ECB announcements, EU econ data, and EUR volatility.',
    seasonalAffinity: { monthly: { 0: 0.05, 1: 0.00, 2: 0.05, 3: 0.10, 4: -0.05, 5: -0.05, 6: -0.05, 7: -0.05, 8: -0.10, 9: 0.05, 10: 0.05, 11: 0.10 } },
  },

  // ── Default fallback ──

  // ── OIL: Supply/Demand & Geopolitics Protocol ──

  'oil-supply-v1': {
    groups: [
      {
        id: 'technical', name: 'Technical Analysis',
        description: 'Oil technicals — range-bound with trend breaks',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'ema-structure',       // 100 — Oil trends with supply shifts
          'support-resistance-levels',  // 100 — Oil respects technical levels
          'bollinger-band-squeeze',   // 100 — OPEC meetings = squeeze → expansion
          'volume-confirmation', // 100 — Volume confirms supply events
          'volatility-tools',       // 100 — ATR spikes on geopolitical events
          'speed-momentum',        // 100 — Supply shock momentum
        ],
      },
      {
        id: 'sentiment', name: 'Sentiment & Fundamentals',
        description: 'Oil drivers: supply, geopolitics, inventories, USD',
        weight: 0.35, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'cad-usd-oil-correlation', // 100 — Oil/CAD correlation signal
          'news-sentiment-positive',          // 100 — OPEC, EIA, geopolitical news
          'analyst-adjustments',       // 100 — Energy sector analyst targets
        ],
      },
      {
        id: 'risk', name: 'Risk',
        description: 'Oil-specific: contango/backwardation, geopolitical risk',
        weight: 0.25, isRiskGate: true, minMultiplier: 0.3, maxMultiplier: 1.2,
        directiveIds: [
          'vix-regime',   // 100 — Oil vol spikes on geopolitics
          'liquidity-check',     // 100 — Spread check on WTI/Brent
          'portfolio-performance', // 100 — Energy allocation cap
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
    seasonalAffinity: { monthly: { 0: -0.05, 1: 0.00, 2: 0.10, 3: 0.10, 4: 0.05, 5: 0.15, 6: 0.15, 7: 0.10, 8: 0.10, 9: 0.00, 10: -0.10, 11: -0.10 } },
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
          'bollinger-band-squeeze',   // 100 — Squeeze before session breakout
          'support-resistance-levels',  // 100 — Pairs respect round numbers
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
          'session-open-effect',           //  80 — Session timing for specific pairs
          'news-sentiment-positive',      // 100 — Economic data, central bank news
          'analyst-adjustments',   // 100 — Bank forecasts for pairs
        ],
      },
      {
        id: 'risk', name: 'Risk',
        description: 'Forex risk: correlation, session liquidity, rollover',
        weight: 0.25, isRiskGate: true, minMultiplier: 0.3, maxMultiplier: 1.2,
        directiveIds: [
          'session-open-effect', // 100 — Trade only in liquid sessions
          'vix-regime',     // 100 — Avoid during central bank events
          'liquidity-check',       // 100 — Spread check on crosses
          'spy-qqq-relative-strength',      // 100 — Avoid correlated pair overexposure
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
    seasonalAffinity: { monthly: {} },
  },

  // ── CAD Sniper V1 ──

  'cad-sniper-v1': {
    groups: [
      {
        id: 'technical', name: 'CAD Technical Structure',
        description: 'CAD pairs trend strongly with oil — momentum, EMA structure, multi-TF alignment, micro S/R',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',         // 120 — Core velocity on CAD pairs
          'multi-timeframe-trend',  // 120 — D/4H/1H alignment for trend bias
          'micro-sr-levels',        // 100 — Key S/R on CAD crosses
          'ema-structure',          // 100 — 9/21/50 EMA alignment
          'bollinger-band-squeeze',      // 100 — Pre-oil-news compression
          'volume-confirmation',    // 100 — Volume confirms CAD moves
          'support-resistance-levels',     // 100 — Key levels (USDCAD: 1.30, 1.35, 1.40)
          'session-open-effect',  // 100 — US/Canada session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'multi-timeframe-trend': 120 },
      },
      {
        id: 'sentiment', name: 'CAD Macro Drivers',
        description: 'Oil correlation is the primary CAD driver — WTI up means CAD up. BOC decisions, GDP, employment.',
        weight: 0.20, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'cad-usd-oil-correlation', // 100 — WTI/CAD correlation
          'news-sentiment-positive',          // 100 — BOC rate decisions, Canada GDP, OPEC
        ],
      },
      {
        id: 'risk', name: 'CAD Risk Gates',
        description: 'BOC events, oil shock, cross-pair correlation drag',
        weight: 0.40, isRiskGate: true, minMultiplier: 0.4, maxMultiplier: 1.25,
        directiveIds: [
          'vix-regime',     // 100 — Kill during BOC/oil shock volatility
          'liquidity-check',       // 100 — Cross CAD pairs can have wide spreads
          'portfolio-performance',// 100 — Don't over-allocate across multiple CAD pairs
          'spy-qqq-relative-strength',      // 100 — Multiple CAD positions = amplified oil risk
        ],
      },
    ],
    name: 'CAD Sniper V1',
    description: 'CAD-focused protocol for all 5 CAD crosses: USDCAD, EURCAD, GBPCAD, AUDCAD, NZDCAD. CAD is the commodity currency — oil correlation drives sustained trends ideal for speed scalping.',
    tradingStyle: 'Trend / Scalp',
    recommendedTimeframe: '5s–15m',
    avgHoldTime: 'Seconds to minutes',
    winRateTarget: '60–70%',
    idealFor: 'US/Canada session (14:30–21:00 GMT). Best during oil inventory releases (Wed 15:30 GMT) and BOC rate decisions. Avoid Canadian holidays when liquidity drops.',
    seasonalAffinity: { monthly: {} },
  },

  // ── DXY Sensitivity V1 ──

  'dxy-sensitivity-v1': {
    groups: [
      {
        id: 'technical', name: 'Micro-Structure Technicals',
        description: 'Forex/metals micro-moves — DXY-driven momentum, squeezes, volume spikes',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — Micro-velocity across USD pairs
          'bollinger-band-squeeze',    // 100 — Squeeze before economic data
          'volume-confirmation',  // 100 — Volume confirms macro move
          'rsi-oversold',         // 120 — Oversold bounce on USD pairs
          'rsi-overbought',       // 100 — Overbought reversion
          'support-resistance-levels',   // 100 — Round number S/R on majors
          'session-open-effect',// 100 — London/NY overlap only
          'volatility-tools',        // 100 — ATR for stop placement
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'USD Sentiment',
        description: 'DXY regime is the primary sentiment driver — everything else follows',
        weight: 0.20, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — Fed speak, NFP, CPI, FOMC
        ],
      },
      {
        id: 'risk', name: 'DXY-Driven Risk',
        description: 'Heavy DXY risk gating — USD strength/weakness gates all positions',
        weight: 0.40, isRiskGate: true, minMultiplier: 0.3, maxMultiplier: 1.25,
        directiveIds: [
          'dxy-regime',           // 100 — DXY strength/weakness gates everything
          'vix-regime',    // 100 — Macro vol kills scalps
          'liquidity-check',      // 100 — Major spreads during news
          'portfolio-performance',// 100 — Don't over-allocate correlated pairs
          'spy-qqq-relative-strength',     // 100 — Multiple USD positions = amplified risk
        ],
      },
    ],
    name: 'DXY Sensitivity V1',
    description: 'USD-driven protocol for gold, silver, forex majors, and crypto. DXY regime gates all positions — USD strength/weakness is the primary driver. Designed for XTrend speed trading during London/NY overlap.',
    tradingStyle: 'Tick Scalp',
    recommendedTimeframe: '5s–30s',
    avgHoldTime: 'Seconds to a few minutes',
    winRateTarget: '60–70%',
    idealFor: 'XTrend speed trading on DXY-sensitive symbols: XAUUSD, XAGUSD, EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDJPY, USDCHF, BTCUSD. Best during London/NY overlap (12:00–16:00 GMT) and US economic data releases.',
    seasonalAffinity: { monthly: {} },
  },

  // ══════════════════════════════════════════════════════════════════
  // Sprint 2026-07-03 — New Protocol Presets
  // ══════════════════════════════════════════════════════════════════

  // ── Divergence Suite V1 ──
  'divergence-suite-v1': {
    groups: [
      {
        id: 'technical', name: 'Divergence Detection',
        description: 'RSI + MACD + OBV divergence detection. OBV divergence carries highest weight (smart money).',
        weight: 0.45, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'rsi-divergence',       // 110 — RSI price/vs indicator divergence
          'macd-divergence',      // 115 — MACD histogram divergence (stronger)
          'obv-divergence',       // 120 — OBV volume divergence (strongest)
        ],
        directiveMaxScores: {
          'rsi-divergence': 110,
          'macd-divergence': 115,
          'obv-divergence': 120,
        },
      },
      {
        id: 'sentiment', name: 'Trend Confirmation',
        description: 'Volume confirmation and momentum to validate divergence signals',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'volume-confirmation',  // 100 — Elevated volume confirms signal
          'speed-momentum',         // 100 — Momentum direction check
        ],
      },
      {
        id: 'risk', name: 'Divergence Risk Gates',
        description: 'Divergence signals need trend context — never trade divergence against strong trend',
        weight: 0.30, isRiskGate: true, minMultiplier: 0.4, maxMultiplier: 1.2,
        directiveIds: [
          'vix-regime',    // 100 — High vol = false divergences
          'market-regime',        // 100 — Trending vs ranging context
          'liquidity-check',      // 100 — Spread check
        ],
      },
    ],
    name: 'Divergence Suite V1',
    description: 'Multi-indicator divergence detection suite. Combines RSI, MACD, and OBV divergence with volume confirmation. OBV (smart money) divergence given highest weight. Best used as a reversal/mean-reversion signal in ranging markets.',
    tradingStyle: 'Swing / Position',
    recommendedTimeframe: '1h–1d',
    avgHoldTime: 'Hours to days',
    winRateTarget: '60–70%',
    idealFor: 'Reversal detection on liquid equities and indices. Works best in ranging/mean-reverting markets — disable during strong trends.',
  },

  // ── MTF Conservative V1 ──
  'mtf-conservative-v1': {
    groups: [
      {
        id: 'technical', name: 'MTF Alignment (Conservative)',
        description: 'All 3 timeframes (1d, 1h, 15m) must align bullish. High accuracy, low frequency.',
        weight: 0.50, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'mtf-confluence-conservative', // 115 — All 3 bullish required
          'ema-structure',               // 100 — EMA structure confirmation
          'volume-confirmation',         // 100 — Volume must confirm
        ],
        directiveMaxScores: {
          'mtf-confluence-conservative': 115,
        },
      },
      {
        id: 'sentiment', name: 'Trend Context',
        description: 'Macro trend and sentiment confirmation',
        weight: 0.20, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — News must not contradict
          'analyst-adjustments',    // 100 — Analyst direction check
        ],
      },
      {
        id: 'risk', name: 'Conservative Risk',
        description: 'Tight risk gates — conservative entries need conservative risk',
        weight: 0.30, isRiskGate: true, minMultiplier: 0.5, maxMultiplier: 1.15,
        directiveIds: [
          'vix-regime',    // 100 — No entries in extreme vol
          'liquidity-check',      // 100 — Must be tradeable
          'portfolio-performance',// 100 — Don't overallocate
          'session-open-effect',  // 100 — Avoid open volatility
        ],
      },
    ],
    name: 'MTF Confluence Conservative V1',
    description: 'Requires ALL 3 timeframes (daily, hourly, 15-min) to align bullish for entry. ~3-5 high-confidence signals per month on SPY. Very high accuracy — designed for position entries, not scalping.',
    tradingStyle: 'Swing / Position',
    recommendedTimeframe: '1d (signal), 1h/15m (confirmation)',
    avgHoldTime: 'Days to weeks',
    winRateTarget: '65–75%',
    idealFor: 'SPY, QQQ, AAPL, MSFT — liquid index ETFs and mega-caps. Use for core position entries.',
  },

  // ── MTF Weighted V1 ──
  'mtf-weighted-v1': {
    groups: [
      {
        id: 'technical', name: 'MTF Composite (Weighted)',
        description: '50/35/15 weighted composite across 3 timeframes. More signals, balanced accuracy.',
        weight: 0.45, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'mtf-confluence-weighted', // 110 — Weighted composite
          'macd-crossover',          // 110 — MACD signal confirmation
          'rsi-oversold',            // 120 — RSI entry timing
        ],
        directiveMaxScores: {
          'mtf-confluence-weighted': 110,
          'macd-crossover': 110,
          'rsi-oversold': 120,
        },
      },
      {
        id: 'sentiment', name: 'Market Bias',
        description: 'VIX regime and news sentiment for directional bias',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'vix-regime',           // 100 — VIX context
          'news-sentiment-positive',       // 100 — News bias
        ],
      },
      {
        id: 'risk', name: 'Balanced Risk',
        description: 'Standard risk gates — weighted entries need standard protection',
        weight: 0.30, isRiskGate: true, minMultiplier: 0.45, maxMultiplier: 1.2,
        directiveIds: [
          'vix-regime',    // 100
          'liquidity-check',      // 100
          'portfolio-performance',// 100
          'budget-gate',          // 100 — Risk budget check
        ],
      },
    ],
    name: 'MTF Confluence Weighted V1',
    description: 'Uses 50/35/15 macro/meso/micro weighting for ~15-20 signals per month on SPY. More trading opportunities than conservative variant, balanced per-signal accuracy. Composite > 0.3 = bullish entry.',
    tradingStyle: 'Swing / Day Trade',
    recommendedTimeframe: '1h–1d',
    avgHoldTime: 'Hours to days',
    winRateTarget: '55–65%',
    idealFor: 'Active traders wanting more frequent signals. SPY, QQQ, liquid stocks. Pair with trailing stops for best results.',
  },

  // ── VWAP Simple V1 ──
  'vwap-simple-v1': {
    groups: [
      {
        id: 'technical', name: 'VWAP AND-Gate',
        description: 'Price at VWAP + RSI confirming + Volume elevated = mean-reversion entry',
        weight: 0.45, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'vwap-confluence-simple', // 105 — AND-gate: VWAP + RSI + Volume
          'vwap',                   // 100 — VWAP standalone
          'volume-confirmation',    // 100 — Volume check
        ],
        directiveMaxScores: {
          'vwap-confluence-simple': 105,
        },
      },
      {
        id: 'sentiment', name: 'Session Context',
        description: 'Session timing and news check',
        weight: 0.20, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'session-open-effect', // 100 — Best during active sessions
          'news-sentiment-positive',        // 100 — No adverse news
        ],
      },
      {
        id: 'risk', name: 'Mean-Reversion Risk',
        description: 'Mean-reversion trades need tight risk — VWAP can fail during trends',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.4, maxMultiplier: 1.2,
        directiveIds: [
          'market-regime',        // 100 — VWAP fails in strong trends
          'vix-regime',    // 100 — No mean-reversion in extreme vol
          'liquidity-check',      // 100
          'portfolio-performance',// 100
        ],
      },
    ],
    name: 'VWAP Simple AND-Gate V1',
    description: 'Prop-firm staple mean-reversion strategy. Price must be at VWAP (within 0.5%), RSI must be neutral (40-65), and volume must be elevated. Simple 3-condition AND-gate — all must confirm. High win rate on liquid equities.',
    tradingStyle: 'Day Trade / Scalp',
    recommendedTimeframe: '5m–15m',
    avgHoldTime: 'Minutes to hours',
    winRateTarget: '60–70%',
    idealFor: 'Intraday mean-reversion on SPY, QQQ, AAPL, MSFT. Best during active sessions (9:30-11:30, 14:00-16:00 ET).',
  },

  // ── VWAP Bands V1 ──
  'vwap-bands-v1': {
    groups: [
      {
        id: 'technical', name: 'VWAP Standard Deviation Bands',
        description: 'VWAP ±1σ/±2σ bands for precision entries. -2σ = deep discount buy zone.',
        weight: 0.45, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'vwap-confluence-bands', // 110 — σ-band based scoring
          'rsi-oversold',          // 120 — RSI confirmation at -2σ
          'volume-surge',          // 100 — Volume surge confirms institutional interest
        ],
        directiveMaxScores: {
          'vwap-confluence-bands': 110,
          'rsi-oversold': 120,
        },
      },
      {
        id: 'sentiment', name: 'Market Structure',
        description: 'Trend context for band entries — buy at -2σ in uptrends only',
        weight: 0.20, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'market-regime',        // 100 — Avoid -2σ entries in downtrends
          'news-sentiment-positive',       // 100
        ],
      },
      {
        id: 'risk', name: 'Band Risk Gates',
        description: 'Deep discount entries can be value traps — need risk context',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.35, maxMultiplier: 1.25,
        directiveIds: [
          'vix-regime',    // 100
          'liquidity-check',      // 100
          'portfolio-performance',// 100
          'rollover-risk',        // 100 — Avoid holding through events
        ],
      },
    ],
    name: 'VWAP Full Bands V1',
    description: 'Uses VWAP standard deviation (±1σ, ±2σ) bands for precision mean-reversion entries. -2σ zone = deep institutional discount (strong buy). +2σ zone = overextended (bearish). More nuanced than simple AND-gate — accounts for how far price has deviated from VWAP.',
    tradingStyle: 'Swing / Day Trade',
    recommendedTimeframe: '15m–1h',
    avgHoldTime: 'Hours to 1-2 days',
    winRateTarget: '55–65%',
    idealFor: 'Patience entries at extreme VWAP deviations. Works on all liquid symbols. Best entries at -2σ during uptrends.',
  },

  // ── Gap Scanner V1 ──
  'gap-scanner-v1': {
    groups: [
      {
        id: 'technical', name: 'Gap Detection',
        description: 'Overnight/opening gap detection with fill-probability scoring',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'gap-scanner',          // 100 — Gap type/size/direction classification
          'volume-confirmation',  // 100 — Volume confirms gap signal
          'session-open-effect',  // 100 — Session open behavior
        ],
      },
      {
        id: 'sentiment', name: 'Gap Context',
        description: 'News catalyst and market bias for gap validation',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment-positive',       // 100 — Gap caused by news?
          'vix-regime',           // 100 — Vol context for gap
        ],
      },
      {
        id: 'risk', name: 'Gap Risk Gates',
        description: 'Gap trading is high-risk — tight risk gates',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.3, maxMultiplier: 1.15,
        directiveIds: [
          'vix-regime',    // 100 — Extreme vol = gaps are news-driven
          'liquidity-check',      // 100 — Wide spreads during gaps
          'portfolio-performance',// 100
          'budget-gate',          // 100 — Risk budget for gap trades
        ],
      },
    ],
    name: 'Gap Scanner V1',
    description: 'Detects overnight/opening price gaps and scores them by fill probability. Small gaps (0.5-2%) have high fill probability — fade them. Large gaps (2-5%) may gap-and-go — follow momentum. Extreme gaps (5%+) are news-driven and unpredictable. Best used within first 15-60 min of market open.',
    tradingStyle: 'Day Trade',
    recommendedTimeframe: '1m–5m',
    avgHoldTime: 'Minutes to hours',
    winRateTarget: '55–65%',
    idealFor: 'Opening-range trading on SPY, QQQ, and liquid stocks. Use only during first hour of US market session.',
  },

  // ── Earnings Momentum Auto-Play V1 (Sprint 2026-07-04) ──
  'earnings-momentum-v1': {
    groups: [
      {
        id: 'technical', name: 'Earnings Quality',
        description: 'Earnings surprise magnitude + revision trend + recency. Heavily weighted toward fundamental quality.',
        weight: 0.45, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'earnings-momentum',        // 90 — Surprise magnitude + QoQ growth + recency (DB-backed)
          'rsi-oversold',             // 120 — Entry timing on dips
          'volume-confirmation',      // 100 — Volume must confirm pre-earnings interest
        ],
        directiveMaxScores: {
          'earnings-momentum': 90,
          'rsi-oversold': 120,
        },
      },
      {
        id: 'sentiment', name: 'Analyst & News Context',
        description: 'Analyst consensus and news sentiment must support the earnings momentum',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'analyst-adjustments',        // 100 — Analyst target direction
          'news-sentiment-positive',           // 100 — No adverse news before earnings
          'earnings-proximity',       // 100 — Must be 5-14 days from earnings (sweet spot)
        ],
      },
      {
        id: 'risk', name: 'Pre-Earnings Risk Gates',
        description: 'Tight risk — pre-earnings moves can reverse. Exit 1-2 days before event.',
        weight: 0.30, isRiskGate: true, minMultiplier: 0.3, maxMultiplier: 1.1,
        directiveIds: [
          'vix-regime',        // 100 — No entries in extreme vol
          'liquidity-check',          // 100 — Must be tradeable
          'portfolio-performance',   // 100 — Don't overallocate to single earnings play
          'budget-gate',              // 100 — Risk budget for earnings trades
        ],
      },
    ],
    name: 'Earnings Momentum Auto-Play V1',
    description: 'Captures pre-earnings drift by entering on strong earnings momentum 5-14 days before the report date. Auto-exits 1-2 days before earnings to avoid the binary event. Based on the well-documented pre-earnings announcement drift anomaly. Uses DB-backed earnings-momentum directive (surprise magnitude, QoQ growth, recency).',
    tradingStyle: 'Swing / Event-Driven',
    recommendedTimeframe: '1d (signal), 1h (entry timing)',
    avgHoldTime: '3-10 days',
    winRateTarget: '55–65%',
    idealFor: 'Liquid stocks with consistent earnings beats. Best entered 5-14 days before earnings, exited 1-2 days before. NOT for holding through earnings — this captures the run-up, not the binary gamble.',
  },

  // ── MT5 Technical Core V1 ───────────────────────────
  // Production protocol for demo validation on MetaQuotes-Demo.
  // Uses ONLY MT5-sourced directives — no Finnhub/Alpha Vantage dependency.
  // All technical signals come from price/candle data via the MT5 bridge.
  // DXY regime uses EURUSD proxy (always available from MT5).
  // Risk gates: budget, liquidity, session timing, rollover.

  'mt5-technical-core-v1': {
    groups: [
      {
        id: 'technical',
        name: 'Price Action & Momentum',
        description: 'Core technicals from MT5 candle data — no external API needed',
        weight: 0.40,
        isRiskGate: false,
        minMultiplier: 1.0,
        maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',           // 120 — 5-bar velocity (highest weight)
          'rsi-oversold',             // 120 — Oversold reversion
          'rsi-overbought',           // 100 — Overbought warning
          'macd-crossover',           // 110 — MACD signal line cross
          'atr-dip',                  //  95 — Normalised dip from highs
          'volume-confirmation',      // 100 — Volume confirms move
          'volume-rhythm',            // 100 — Accumulation/distribution pattern
          'bollinger-band-squeeze',        // 100 — Volatility compression before breakout
          'vwap',                     // 100 — Institutional volume-weighted price
          'doji-pattern',             // 100 — Reversal candlestick
          'hammer-pattern',           // 100 — Reversal candlestick
          'engulfing-pattern',        // 100 — Strong reversal signal
          'mt5-engulfing',            // 100 — MT5-ported engulfing (RSI confirmed)
          'mt5-harami',               // 100 — MT5-ported harami (RSI confirmed)
          'support-resistance-levels',       // 100 — Key levels
          'confluence-reversal-combo',// 100 — Multiple reversal signals
          'momentum-continuation-combo',// 100 — Trend continuation
          'momentum-exhaustion',      // 100 — Trend exhaustion warning
          'overhead-supply-pressure', // 100 — Supply zone overhead
        ],
        directiveMaxScores: {
          'speed-momentum': 120,
          'rsi-oversold': 120,
          'macd-crossover': 110,
          'atr-dip': 95,
        },
      },
      {
        id: 'sentiment',
        name: 'Macro Context (MT5-Sourced)',
        description: 'DXY regime from EURUSD proxy + gold correlation',
        weight: 0.25,
        isRiskGate: false,
        minMultiplier: 1.0,
        maxMultiplier: 1.0,
        directiveIds: [
          'dxy-regime',               // 100 — USD strength/weakness from EURUSD
          'gold-macro-correlation',    // 100 — Gold vs DXY/real yields context
          'cad-usd-oil-correlation',   // 100 — CAD petrocurrency correlation
        ],
      },
      {
        id: 'risk',
        name: 'Position & Execution Risk',
        description: 'Risk gates protect the small account — budget, liquidity, session timing',
        weight: 0.35,
        isRiskGate: true,
        minMultiplier: 0.4,           // Worst risk = 40% of signal survives
        maxMultiplier: 1.2,           // Low risk = 20% boost
        directiveIds: [
          'budget-gate',              // 100 — Signal budget management
          'liquidity-check',          //  80 — Spread/volume adequacy
          'rollover-risk',            // 100 — Avoid rollover windows
          'session-open-effect',      // 110 — Session timing filter
          'position-size-confidence', // 100 — Confidence-weighted sizing
          'target-achieved',          // 100 — Profit target proximity
          'time-stop',                // 100 — Position aging
          'market-regime',            // 100 — Trending vs ranging context
        ],
        directiveMaxScores: {
          'liquidity-check': 80,
          'session-open-effect': 110,
        },
      },
    ],
    name: 'MT5 Technical Core V1',
    description: 'Production-ready protocol for MetaQuotes-Demo validation. Uses ONLY MT5-sourced directives — no Finnhub/Alpha Vantage dependency. All technical signals from candle data via MT5 bridge. DXY regime uses EURUSD proxy. Focus on liquid forex + gold with tight risk gates for small account protection ($1,000 balance).',
    tradingStyle: 'Swing / Intraday',
    recommendedTimeframe: '15m',
    avgHoldTime: '1–4 hours',
    winRateTarget: '55–65%',
    idealFor: 'Demo validation on MetaQuotes-Demo account #10011309743. EURUSD, GBPUSD, XAUUSD. 0.01 lot entries. Tight stops at 1.5× ATR. Risk gates protect the $1K balance from over-trading and session risk.',
  },

  // ── MT5 Technical Core — SHORT variant ────────────────
  // Pairs with mt5-technical-core-v1 for dual-protocol LONG/SHORT scoring.

  'mt5-technical-short': {
    groups: SHORT_DIRECTIVE_GROUPS,
    name: 'MT5 Technical Core (SHORT)',
    description: 'Short-side variant of MT5 Technical Core. Uses bearish directives — overbought, breakdown, distribution. Pair with mt5-technical-core-v1 for dual BUY/SELL on EURUSD, GBPUSD, XAUUSD.',
    directionMode: 'SHORT_ONLY',
    tradingStyle: 'Swing / Intraday',
    recommendedTimeframe: '15m',
    avgHoldTime: '1–4 hours',
    winRateTarget: '50–60%',
    idealFor: 'Short-side opportunities on liquid forex + gold. Pairs with MT5 Technical Core V1 for dual scoring.',
  },
};
