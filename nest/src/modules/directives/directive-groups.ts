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
