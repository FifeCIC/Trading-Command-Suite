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

// ─── Bitcoin Speed Protocol ───────────────────────────────────

/**
 * BTC-SPEED-V1: Bitcoin Speed Scalp Protocol
 *
 * Designed for 5m–15m speed/scalp trading on Bitcoin.
 * Variable maxScores create a ~915-point protocol ceiling,
 * distinguishing common strong scores (80%) from rare cyclical
 * opportunities (95%+ requiring halving cycle alignment).
 *
 * See: docs/BTC-SPEED-PROTOCOL-THEORY.md
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
export const PROTOCOL_REGISTRY: Record<string, { groups: DirectiveGroup[]; name: string; description: string }> = {
  default: {
    groups: DIRECTIVE_GROUPS,
    name: 'SEES Default',
    description: 'General-purpose equity scoring protocol covering technical, sentiment, and risk directives.',
  },
  'btc-speed-v1': {
    groups: BTC_SPEED_GROUPS,
    name: 'Bitcoin Speed Scalp V1',
    description: 'Bitcoin speed/scalp trading protocol with halving cycle macro bonus and variable directive weights (maxScore 40–200).',
  },
};
