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
  weight: number;
  isRiskGate: boolean;
  minMultiplier: number;
  maxMultiplier: number;
  /**
   * The DISTINCT directive ids in this group — one entry per directive, never a repeat (#1165).
   *
   * ⚠️ A group may hold SEVERAL CONFIGURED INSTANCES of one directive (`directiveInstances`), and
   * this list must still name it ONCE. The scorer accumulates `capacityMax += maxScore` per result in
   * this list, so a repeat here inflates the protocol's configured capacity and therefore shifts every
   * percentage — the `INV-STABLE-DENOMINATOR` failure, arrived at from the config side.
   */
  directiveIds: string[];
  directiveMaxScores?: Record<string, number>;
  /**
   * Every CONFIGURED INSTANCE of every directive in the group (#1165).
   *
   * One item per `protocol_directive_entry` row. A directive with one entry appears once with
   * `label: ''`; a directive with two entries appears twice. Absent ⇒ the pre-#1165 behaviour exactly
   * (each directive runs once, with its declared defaults).
   *
   * ⚠️ Instances are AVERAGED into one directive slot by `DirectivesService.runAll`, not summed. That
   * is the aggregation decision (register row 122): adding a comparison must not change the protocol's
   * scale, and it must not be able to inflate a composite by adding instances of a directional
   * directive. The previous keying — `directiveParams`, a map by directive id — could not express a
   * second instance at all.
   */
  directiveInstances?: DirectiveInstance[];
}

/** One configured instance of a directive: the unit the scorer can address and report. */
export interface DirectiveInstance {
  /** `protocol_directive_entry.id` — stable identity of the CONFIGURED instance. */
  entryId: string;
  directiveId: string;
  /** `''` is the primary instance; a named instance is a second configuration of the same directive. */
  label: string;
  /** Absent or null ⇒ the directive's declared defaults, which is the pre-#1165 behaviour exactly. */
  params?: Record<string, number | boolean> | null;
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
      'rsi-oversold', 'rsi-overbought', 'macd-crossover', 'ema-structure',
      'volume-confirmation', 'speed-momentum', 'bollinger-band-squeeze',
      'support-resistance-levels', 'volatility-tools', 'session-open-effect',
      // Gold-specific directives (#283 audit — all top-10 heavyweight for XAUUSD):
      'gold-session-profile',   // session-based gold patterns (impact ~957)
      'gold-round-numbers',     // psychological price levels for gold (ready)
      'engulfing-pattern',      // candlestick reversal (impact ~898)
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
      // NOTE (#626): 'earnings-proximity' intentionally removed — its feed
      // (input.earningsDate) is not wired, so it can only return a constant
      // mock score. Kept as alpha + rehomed to the screener in #648.
      'analyst-adjustments',
      'earnings-momentum', 'social-buzz', 'insider-activity',
      // Gold macro driver — DXY, real yields, VIX correlation for XAUUSD/XAGUSD:
      'gold-macro-correlation',
    ],
  },
  {
    id: 'risk',
    name: 'Risk & Structural',
    description: 'Correlation, dilution, concentration, volatility, liquidity',
    weight: 0.25,
    isRiskGate: true,
    minMultiplier: 0.3,
    maxMultiplier: 1.2,
    directiveIds: [
      'spy-qqq-relative-strength', 'dilution-impact',
      'liquidity-check', 'budget-gate', 'rollover-risk', 'dxy-regime',
    ],
  },
];

export const SHORT_DIRECTIVE_GROUPS: DirectiveGroup[] = [
  {
    id: 'bearish-technical',
    name: 'Bearish Technical Analysis',
    description: 'Overbought, breakdown, distribution',
    weight: 0.40,
    isRiskGate: false,
    minMultiplier: 1.0,
    maxMultiplier: 1.0,
    directiveIds: [
      'rsi-overbought', 'stochastic', 'williams-r', 'cci', 'mfi',
      'engulfing-pattern', 'pin-bar-pattern', 'doji-pattern',
      'resistance-levels-strategy', 'obv-divergence', 'macd-crossover', 'speed-momentum',
    ],
  },
  {
    id: 'bearish-sentiment',
    name: 'Bearish Sentiment & Fundamentals',
    description: 'Negative news, downgrades, fear',
    weight: 0.35,
    isRiskGate: false,
    minMultiplier: 1.0,
    maxMultiplier: 1.0,
    directiveIds: [
      // NOTE (#626): 'earnings-proximity' intentionally removed (constant mock,
      // alpha; rehomed to the screener in #648).
      'analyst-adjustments',
      'earnings-momentum', 'social-buzz',
    ],
  },
  {
    id: 'short-risk',
    name: 'Short-Side Risk & Structural',
    description: 'Short-specific risk gates',
    weight: 0.25,
    isRiskGate: true,
    minMultiplier: 0.3,
    maxMultiplier: 1.2,
    directiveIds: [
      'spy-qqq-relative-strength', 'dilution-impact',
      'vix-strategy', 'liquidity-check', 'budget-gate', 'rollover-risk', 'dxy-regime',
    ],
  },
];

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

export function getGroupForDirective(directiveId: string): DirectiveGroup | undefined {
  const groupId = DIRECTIVE_TO_GROUP.get(directiveId);
  return DIRECTIVE_GROUPS.find((g) => g.id === groupId);
}

export function isRiskDirective(directiveId: string): boolean {
  return DIRECTIVE_TO_GROUP.get(directiveId) === 'risk';
}

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
      'speed-momentum', 'bollinger-band-squeeze', 'volume-confirmation',
      'volatility-tools', 'rsi-oversold', 'support-resistance-levels',
      'multi-timeframe-trend', 'micro-sr-levels', 'rsi-overbought', 'session-open-effect',
    ],
    directiveMaxScores: { 'speed-momentum': 120, 'rsi-oversold': 120 },
  },
  {
    id: 'sentiment',
    name: 'Sentiment & Fundamentals',
    description: 'Crypto-specific sentiment signals',
    weight: 0.35,
    isRiskGate: false,
    minMultiplier: 1.0,
    maxMultiplier: 1.0,
    directiveIds: ['crypto-fear-greed', 'social-buzz'],
    directiveMaxScores: { 'crypto-fear-greed': 60 },
  },
  {
    id: 'risk',
    name: 'Risk & Structural',
    description: 'Bitcoin-specific risk: halving cycle, weekend effects, volatility',
    weight: 0.25,
    isRiskGate: true,
    minMultiplier: 0.3,
    maxMultiplier: 1.2,
    directiveIds: [
      'btc-halving-cycle', 'crypto-weekend-effect',
      'liquidity-check',
    ],
    directiveMaxScores: { 'btc-halving-cycle': 200, 'crypto-weekend-effect': 50 },
  },
];

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
