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

  // ── XAU: Gold Speed Scalp V1 ──

  'xau-speed-v1': {
    groups: [
      {
        id: 'technical', name: 'Micro-Structure Technicals',
        description: 'Gold micro-moves: momentum, squeezes, volume spikes for sub-minute entries',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'speed-momentum',       // 120 — Gold micro-velocity
          'bollinger-squeeze',    // 100 — Squeeze before data releases
          'volume-confirmation',  // 100 — Volume spike confirms gold move
          'atr-expansion',        // 100 — Micro-ATR for gold tick sizing
          'rsi-oversold',         // 120 — Gold oversold bounce
          'rsi-overbought',       // 100 — Gold overbought reversion
          'support-resistance',   // 100 — Gold round numbers ($2000, $2050...)
          'session-timing-filter',// 100 — Only liquid gold sessions
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Sentiment & Macro Context',
        description: 'Gold IS sentiment — DXY, real rates, fear gauge',
        weight: 0.20, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment',            // 100 — Gold reacts to every headline
          'gold-macro-correlation',    // 100 — DXY/real rates context
        ],
      },
      {
        id: 'risk', name: 'Execution Risk',
        description: 'Gold-specific: spread widening during news, weekend gaps, over-allocation',
        weight: 0.40, isRiskGate: true, minMultiplier: 0.4, maxMultiplier: 1.3,
        directiveIds: [
          'volatility-regime',     // 100 — Extreme vol kills gold scalps
          'liquidity-check',       // 100 — Gold spreads widen on news
          'position-concentration',// 100 — Don't over-allocate gold
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
          'bollinger-squeeze',    // 100 — Squeeze before EIA/OPEC events
          'volume-confirmation',  // 100 — Volume spike confirms crude move
          'atr-expansion',        // 100 — Micro-ATR for oil tick sizing
          'rsi-oversold',         // 120 — Oil oversold bounce (mean reversion)
          'rsi-overbought',       // 100 — Oil overbought reversion
          'support-resistance',   // 100 — Oil key levels ($70, $75, $80, $85)
          'session-timing-filter',// 100 — NY session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Sentiment & Fundamentals',
        description: 'Oil drivers: OPEC, EIA, geopolitics, USD',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment',            // 100 — OPEC, EIA, geopolitics dominate
          'cad-usd-oil-correlation',   // 100 — Oil/CAD correlation confirmation
        ],
      },
      {
        id: 'risk', name: 'Execution Risk',
        description: 'Oil-specific: geopolitical vol spikes, NY session liquidity windows',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.45, maxMultiplier: 1.3,
        directiveIds: [
          'volatility-regime',     // 100 — Oil vol spikes on geopolitics
          'liquidity-check',       // 100 — Crude spreads matter for $1 scalps
          'position-concentration',// 100 — Don't over-allocate energy
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
          'bollinger-squeeze',    // 100 — Pre-breakout squeeze at strikes
          'volume-confirmation',  // 100 — Options-driven volume spikes
          'atr-expansion',        // 100 — Micro-ATR for stop placement
          'rsi-oversold',         // 120 — Oversold at max pain level
          'rsi-overbought',       // 100 — Overbought at gamma wall
          'support-resistance',   // 100 — SPY $5/$10 strike clusters
          'session-timing-filter',// 100 — US session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Market Context',
        description: 'VIX, breadth, macro — SPY is the market',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment',       // 100 — Econ data, Fed, earnings
          'vix-regime',           // 100 — VIX/SPY inverse correlation
        ],
      },
      {
        id: 'risk', name: 'Session & Execution Risk',
        description: 'SPY doesn\'t gap 5% — tighter risk gates than crypto',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.5, maxMultiplier: 1.25,
        directiveIds: [
          'volatility-regime',    // 100 — Extreme VIX kills scalps
          'liquidity-check',      // 100 — SPY always liquid but check spread
          'position-concentration',// 100 — Don't over-allocate indices
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
          'bollinger-squeeze',    // 100 — Pre-breakout compression
          'volume-confirmation',  // 100 — Institutional volume profile
          'support-resistance',   // 100 — Key SPY levels ($500, $510, $520...)
          'momentum-roc',         // 100 — Intraday momentum shifts
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
          'news-sentiment',       // 100 — Econ data dominates SPY
          'vix-regime',           // 100 — VIX/SPY correlation
          'analyst-consensus',    // 100 — Wall Street SPY targets
        ],
      },
      {
        id: 'risk', name: 'Position & Session Risk',
        description: 'Day trade risk — session quality, position sizing, overnight avoidance',
        weight: 0.30, isRiskGate: true, minMultiplier: 0.55, maxMultiplier: 1.2,
        directiveIds: [
          'volatility-regime',    // 100 — Don't day trade during VIX > 30
          'session-timing-filter',// 100 — Only trade liquid US hours
          'liquidity-check',      // 100 — SPY always liquid but check
          'position-concentration',// 100 — Index allocation cap
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
          'bollinger-squeeze',    // 100 — Tech squeeze before earnings/macro
          'volume-confirmation',  // 100 — NVDA/AAPL/MSFT volume dominance
          'atr-expansion',        // 100 — Wider ATR for tech volatility
          'rsi-oversold',         // 120 — Tech dip buying
          'rsi-overbought',       // 100 — Tech overbought = trend continuation
          'support-resistance',   // 100 — QQQ round numbers
          'session-timing-filter',// 100 — US session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Tech Sentiment',
        description: 'Tech earnings, rates sensitivity, risk appetite',
        weight: 0.20, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment',       // 100 — Tech earnings, AI news, rate decisions
          'analyst-consensus',    // 100 — Tech analyst targets matter more
        ],
      },
      {
        id: 'risk', name: 'High Beta Risk',
        description: 'QQQ moves 1.2x SPY — wider risk gate to allow for beta amplification',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.45, maxMultiplier: 1.3,
        directiveIds: [
          'volatility-regime',    // 100 — Tech vol ≠ market vol
          'liquidity-check',      // 100 — QQQ always liquid but spreads widen in panic
          'position-concentration',// 100 — Tech allocation cap
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
          'bollinger-squeeze',    // 100 — Squeeze before earnings/macro
          'volume-confirmation',  // 100 — NVDA/AAPL/MSFT volume confirms
          'momentum-roc',         // 100 — Tech momentum is everything
          'support-resistance',   // 100 — QQQ key levels
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
          'news-sentiment',       // 100 — Tech news cycles
          'analyst-consensus',    // 100 — Tech analyst targets
          'earnings-proximity',   // 100 — Earnings season risk/reward
        ],
      },
      {
        id: 'risk', name: 'Tech Concentration Risk',
        description: 'Top 3 stocks = 30% of QQQ — concentration risk is real',
        weight: 0.30, isRiskGate: true, minMultiplier: 0.45, maxMultiplier: 1.3,
        directiveIds: [
          'volatility-regime',    // 100 — Tech vol spikes on earnings
          'session-timing-filter',// 100 — US session only
          'liquidity-check',      // 100 — Check spreads
          'position-concentration',// 100 — Index allocation cap
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
          'bollinger-squeeze',    // 100 — Squeeze before sector rotation
          'volume-confirmation',  // 100 — Volume confirms rotation
          'atr-expansion',        // 100 — Lower ATR, tighter stops
          'rsi-oversold',         // 120 — Value dip buying
          'rsi-overbought',       // 100 — Overbought cyclicals
          'support-resistance',   // 100 — DJI respects round thousands
          'session-timing-filter',// 100 — US session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Cyclical Sentiment',
        description: 'Dow is value/cyclicals — rates, inflation, employment',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment',       // 100 — Econ data, Fed, employment
          'analyst-consensus',    // 100 — Industrial analyst targets
        ],
      },
      {
        id: 'risk', name: 'Value Rotation Risk',
        description: 'Lower beta = tighter risk gate. Dow doesn\'t gap like QQQ.',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.55, maxMultiplier: 1.2,
        directiveIds: [
          'volatility-regime',    // 100 — Dow vol is lower
          'liquidity-check',      // 100 — Always liquid but check
          'position-concentration',// 100 — Index allocation cap
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
          'bollinger-squeeze',    // 100 — Squeeze before London open
          'volume-confirmation',  // 100 — LSE volume profile
          'atr-expansion',        // 100 — FTSE ATR (GBP-denominated)
          'rsi-oversold',         // 120 — Commodity dip buying
          'rsi-overbought',       // 100 — Overbought miners/energy
          'support-resistance',   // 100 — FTSE round numbers
          'session-timing-filter',// 100 — London session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'UK Macro',
        description: 'FTSE sensitive to GBP, commodities, UK econ data',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment',       // 100 — UK econ data, BoE, commodity news
          'analyst-consensus',    // 100 — FTSE analyst targets
        ],
      },
      {
        id: 'risk', name: 'Cross-Session Risk',
        description: 'FTSE trades London hours — gap risk from US close, Asian open',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.5, maxMultiplier: 1.2,
        directiveIds: [
          'volatility-regime',    // 100 — FTSE vol during UK events
          'liquidity-check',      // 100 — Check LSE spreads
          'position-concentration',// 100 — Index allocation cap
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
          'bollinger-squeeze',    // 100 — Squeeze before Elon/news
          'volume-confirmation',  // 100 — TSLA volume is massive
          'atr-expansion',        // 100 — TSLA ATR is huge for a stock
          'rsi-oversold',         // 120 — TSLA dip = generational buy (usually)
          'rsi-overbought',       // 100 — TSLA OB can keep running
          'support-resistance',   // 100 — TSLA round numbers + fib levels
          'session-timing-filter',// 100 — US session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Elon Factor',
        description: 'TSLA sentiment is unique — Elon, deliveries, AI narrative',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment',       // 100 — Elon tweets, delivery numbers, product launches
          'social-buzz',          // 100 — TSLA social media activity is predictive
        ],
      },
      {
        id: 'risk', name: 'Single Stock Risk',
        description: 'TSLA is NOT an index — idiosyncratic risk requires wider gates',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.4, maxMultiplier: 1.35,
        directiveIds: [
          'volatility-regime',    // 100 — TSLA vol can spike 2-3x normal
          'liquidity-check',      // 100 — TSLA always liquid but spreads widen
          'position-concentration',// 100 — Single stock risk — tighter allocation
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
          'bollinger-squeeze',    // 100 — Squeeze before Elon tweet / community event
          'volume-confirmation',  // 100 — DOGE volume spikes on social
          'atr-expansion',        // 100 — DOGE ATR is enormous
          'rsi-oversold',         // 120 — Meme dip = buy (usually)
          'rsi-overbought',       // 100 — DOGE OB = FOMO, can run further
          'support-resistance',   // 100 — DOGE respects round cents
          'session-timing-filter',// 100 — 24/7 but US peak is most active
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
          'volatility-regime',    // 100 — DOGE vol is extreme
          'liquidity-check',      // 100 — DOGE spreads can be wide
          'position-concentration',// 100 — Meme coin = tiny allocation
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
          'bollinger-squeeze',    // 100 — Squeeze before policy announcements
          'volume-confirmation',  // 100 — Volume on Shanghai/Shenzhen
          'atr-expansion',        // 100 — CHINA50 ATR (policy events)
          'rsi-oversold',         // 120 — China dips on regulatory fear
          'rsi-overbought',       // 100 — China OB on stimulus
          'support-resistance',   // 100 — Round numbers + government intervention levels
          'session-timing-filter',// 100 — Asian session only
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Policy Sentiment',
        description: 'China is policy-driven — PBoC, Politburo, regulatory announcements',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment',       // 100 — PBoC, regulatory, trade war news
          'analyst-consensus',    // 100 — China analyst targets
        ],
      },
      {
        id: 'risk', name: 'Policy & Session Risk',
        description: 'Government intervention, circuit breakers, capital controls',
        weight: 0.35, isRiskGate: true, minMultiplier: 0.35, maxMultiplier: 1.3,
        directiveIds: [
          'volatility-regime',    // 100 — China vol on policy events
          'liquidity-check',      // 100 — CHINA50 spreads can be wide
          'position-concentration',// 100 — Emerging market allocation
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
          'bollinger-squeeze',    // 100 — Squeeze before breakouts
          'rsi-oversold',         // 120 — Dip-buying momentum (oversold = opportunity)
          'support-resistance',   // 100 — Key levels matter for hot stocks
          'momentum-roc',         // 100 — Rate of change confirms trend strength
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'macd-crossover': 110, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Sentiment & Expectations',
        description: 'Momentum stocks live and die by analyst targets, news flow, and earnings surprises',
        weight: 0.35, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment',       // 100 — News drives momentum stocks
          'analyst-consensus',    // 100 — Upgrades/downgrades move these stocks
          'social-buzz',          // 100 — Reddit/Twitter/StockTwits activity
          'earnings-proximity',   // 100 — Earnings are make-or-break events
        ],
      },
      {
        id: 'risk', name: 'High-Momentum Risk',
        description: 'These stocks can drop 40% in a month — wider risk gates than steady stocks',
        weight: 0.30, isRiskGate: true, minMultiplier: 0.40, maxMultiplier: 1.30,
        directiveIds: [
          'volatility-regime',    // 100 — Momentum vol is high, set expectations
          'liquidity-check',      // 100 — Tight spreads essential for entry
          'position-concentration',// 100 — Don't over-allocate single momentum names
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
          'bollinger-squeeze',    // 100 — Squeeze before trial results / WHO announcements
          'rsi-oversold',         // 120 — Overreaction dip-buying on negative headlines
          'rsi-overbought',       // 100 — Overbought on panic = reversion opportunity
          'support-resistance',   // 100 — Bio/pharma respects key levels
          'atr-expansion',        // 100 — Biotech ATR explodes on news
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'News & Crisis Sentiment',
        description: 'Pandemic stocks ARE sentiment — WHO, CDC, government contracts drive everything',
        weight: 0.40, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment',       // 100 — WHO/CDC headlines, trial results, gov contracts
          'social-buzz',          // 100 — Social media panic/fear tracking
          'analyst-consensus',    // 100 — Biotech analyst upgrades on pipeline news
        ],
      },
      {
        id: 'risk', name: 'Biotech Event Risk',
        description: 'Biotech can gap 50% on trial failure — wide gates essential',
        weight: 0.25, isRiskGate: true, minMultiplier: 0.35, maxMultiplier: 1.4,
        directiveIds: [
          'volatility-regime',    // 100 — Biotech vol is extreme during outbreaks
          'liquidity-check',      // 100 — Small-cap bio spreads widen dramatically
          'position-concentration',// 100 — Never over-allocate single biotech names
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
          'bollinger-squeeze',    // 100 — Squeeze = breakout imminent (3x magnitude)
          'rsi-oversold',         // 120 — Oversold leverage = violent bounce
          'rsi-overbought',       // 100 — Overbought leverage = sharp reversion
          'support-resistance',   // 100 — Key levels matter 3x more
          'atr-expansion',        // 100 — ATR is 3x the underlying
          'ema-structure',        // 100 — Trend alignment across timeframes
          'session-timing-filter',// 100 — Only trade liquid sessions (LSE hours)
        ],
        directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
      },
      {
        id: 'sentiment', name: 'Market Direction & Rotation',
        description: 'With 79 diverse symbols, correlation patterns reveal macro tides vs sector rotations',
        weight: 0.25, isRiskGate: false, minMultiplier: 1.0, maxMultiplier: 1.0,
        directiveIds: [
          'news-sentiment',       // 100 — Macro news drives indices + sectors
          'analyst-consensus',    // 100 — Sector/stock analyst direction
          'correlation-drag',     // 100 — When all leverage moves together = cleaner signal
        ],
      },
      {
        id: 'risk', name: '3x Amplified Risk (79-symbol universe)',
        description: '79 symbols across 5 categories. 3x leverage = 3x drawdowns. Wider pool = wider gate for signal diversity.',
        weight: 0.45, isRiskGate: true, minMultiplier: 0.25, maxMultiplier: 1.40,
        directiveIds: [
          'volatility-regime',    // 100 — VIX/fear context for 3x exposure
          'liquidity-check',      // 100 — LSE leverage spreads can gap
          'position-concentration',// 100 — 3x = tiny position = tight cap
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
