/**
 * Protocol Presets
 * ================
 * Pre-configured scoring protocol definitions. Each preset maps a strategy
 * to a set of directives with weights.
 *
 * Weights are relative — the protocol's total maxScore is the sum of
 * each directive's own maxScore. The weight here acts as a multiplier
 * on the directive's natural score before aggregation.
 */

export interface ProtocolPreset {
  id: string;
  name: string;
  description: string;
  /** Directive IDs to include in this protocol */
  directives: string[];
}

export const PROTOCOL_PRESETS: ProtocolPreset[] = [
  {
    id: 'momentum-short',
    name: 'Momentum / Short-Term',
    description:
      'RSI, MACD, volume confirmation — 1-5 day horizon. Best for active swing trades.',
    directives: [
      'rsi-oversold',
      'macd-crossover',
      'volume-confirmation',
      'atr-dip',
    ],
  },
  {
    id: 'mean-reversion',
    name: 'Mean Reversion',
    description:
      'Bollinger bands, RSI extremes, session timing — intraday to 3 days. Best for range-bound markets.',
    directives: [
      'rsi-oversold',
      'bollinger-squeeze',
      'session-timing-filter',
      'ema-structure',
    ],
  },
  {
    id: 'swing-long',
    name: 'Swing / Long-Term',
    description:
      'EMA structure, Hurst exponent, earnings momentum, social buzz — weeks to months. Best for position trades.',
    directives: [
      'ema-structure',
      'hurst-regime',
      'earnings-momentum',
      'social-buzz',
    ],
  },
];

/** Look up a preset by ID. */
export function getPreset(id: string): ProtocolPreset | undefined {
  return PROTOCOL_PRESETS.find((p) => p.id === id);
}
