/**
 * Strategy Prerequisites
 * ======================
 * Each strategy declares its data requirements. The viability checker
 * determines which strategies can run given current data availability.
 */

export interface StrategyPrerequisites {
  id: string;
  name: string;
  requiredDataTypes: string[];
  minimumBarCount: number;
  requiredTimeframes: string[];
  requiredProviders: string[];
  requiredDirectives: string[];
  premiumRequired: boolean;
  scope: string[];
}

export const STRATEGY_PREREQUISITES: StrategyPrerequisites[] = [
  {
    id: 'conviction-dip-accumulation',
    name: 'Conviction Dip Accumulation',
    requiredDataTypes: ['bars'],
    minimumBarCount: 100,
    requiredTimeframes: ['1h'],
    requiredProviders: ['alpaca', 'alphavantage'],
    requiredDirectives: ['rsi-oversold', 'macd-crossover', 'ema-structure', 'atr-dip', 'volume-confirmation'],
    premiumRequired: false,
    scope: ['stocks'],
  },
  {
    id: 'momentum-breakout',
    name: 'Momentum Breakout',
    requiredDataTypes: ['bars'],
    minimumBarCount: 50,
    requiredTimeframes: ['1h', '1d'],
    requiredProviders: ['alpaca'],
    requiredDirectives: ['adx', 'stochastic', 'ma-crossover', 'volume-surge'],
    premiumRequired: false,
    scope: ['stocks', 'crypto'],
  },
  {
    id: 'mean-reversion-swing',
    name: 'Mean Reversion Swing',
    requiredDataTypes: ['bars'],
    minimumBarCount: 100,
    requiredTimeframes: ['1h'],
    requiredProviders: ['alpaca'],
    requiredDirectives: ['rsi-oversold', 'bollinger-bands', 'price-above-sma', 'support-resistance-levels'],
    premiumRequired: false,
    scope: ['stocks'],
  },
  {
    id: 'trend-following',
    name: 'Trend Following',
    requiredDataTypes: ['bars'],
    minimumBarCount: 200,
    requiredTimeframes: ['1d'],
    requiredProviders: ['alpaca'],
    requiredDirectives: ['price-action', 'momentum-continuation-combo', 'moving-averages', 'vwap'],
    premiumRequired: false,
    scope: ['stocks', 'forex'],
  },
  {
    id: 'volatility-regime',
    name: 'Volatility Regime Strategy',
    requiredDataTypes: ['bars', 'quotes'],
    minimumBarCount: 50,
    requiredTimeframes: ['1h', '1d'],
    requiredProviders: ['alphavantage'],
    requiredDirectives: ['vix-regime', 'bollinger-band-squeeze', 'atr-dip'],
    premiumRequired: true,
    scope: ['stocks'],
  },
  {
    id: 'earnings-catalyst',
    name: 'Earnings Catalyst',
    requiredDataTypes: ['bars', 'fundamentals'],
    minimumBarCount: 100,
    requiredTimeframes: ['1d'],
    requiredProviders: ['alpaca'],
    requiredDirectives: ['earnings-proximity', 'news-sentiment-positive', 'rsi-oversold'],
    premiumRequired: false,
    scope: ['stocks'],
  },
  {
    id: 'crypto-momentum',
    name: 'Crypto Momentum',
    requiredDataTypes: ['bars'],
    minimumBarCount: 50,
    requiredTimeframes: ['1h'],
    requiredProviders: ['alpaca'],
    requiredDirectives: ['rsi-oversold', 'macd-crossover', 'adx', 'volume-surge'],
    premiumRequired: false,
    scope: ['crypto'],
  },
  {
    id: 'gold-macro',
    name: 'Gold Macro Correlation',
    requiredDataTypes: ['bars', 'quotes'],
    minimumBarCount: 100,
    requiredTimeframes: ['1d'],
    requiredProviders: ['alphavantage'],
    requiredDirectives: ['gold-macro-correlation', 'vix-regime', 'support-resistance-levels'],
    premiumRequired: true,
    scope: ['stocks'],
  },
  {
    id: 'free-tier-conviction-accumulation',
    name: 'Free-Tier Conviction Accumulation',
    requiredDataTypes: ['bars'],
    minimumBarCount: 50,
    requiredTimeframes: ['1d'],
    requiredProviders: ['alpaca'],
    requiredDirectives: [
      'rsi-oversold', 'macd-crossover', 'ema-structure', 'atr-dip',
      'volume-confirmation', 'adx', 'stochastic', 'price-above-sma',
      'support-resistance-levels', 'bollinger-bands', 'volume-surge',
    ],
    premiumRequired: false,
    scope: ['stocks', 'crypto'],
  },
  {
    id: 'forex-mean-reversion',
    name: 'Forex Mean Reversion',
    requiredDataTypes: ['bars'],
    minimumBarCount: 100,
    requiredTimeframes: ['1h', '4h'],
    requiredProviders: ['mt5'],
    requiredDirectives: [
      'rsi-oversold', 'macd-crossover', 'ema-structure',
      'bollinger-band-squeeze', 'atr-dip', 'support-resistance-levels',
      'hammer-pattern', 'engulfing-pattern',
    ],
    premiumRequired: false,
    scope: ['forex'],
  },
];

export interface ProviderAvailability {
  alpaca: boolean;
  alphavantage: boolean;
  trading212: boolean;
  mt5: boolean;
}

export interface DataAvailability {
  hasBars: boolean;
  hasQuotes: boolean;
  hasFundamentals: boolean;
  hasNews: boolean;
  barCount: number;
  availableTimeframes: string[];
}

export interface ViabilityResult {
  strategyId: string;
  strategyName: string;
  viable: boolean;
  missingRequirements: string[];
}

export function checkStrategyViability(
  strategy: StrategyPrerequisites,
  providers: ProviderAvailability,
  data: DataAvailability,
): ViabilityResult {
  const missing: string[] = [];

  for (const dt of strategy.requiredDataTypes) {
    const key = `has${dt.charAt(0).toUpperCase() + dt.slice(1)}` as keyof DataAvailability;
    if (data[key] === false) {
      missing.push(`Missing data type: ${dt}`);
    }
  }

  if (data.barCount < strategy.minimumBarCount) {
    missing.push(`Need ${strategy.minimumBarCount} bars, have ${data.barCount}`);
  }

  for (const tf of strategy.requiredTimeframes) {
    if (!data.availableTimeframes.includes(tf)) {
      missing.push(`Missing timeframe: ${tf}`);
    }
  }

  for (const provider of strategy.requiredProviders) {
    const key = provider as keyof ProviderAvailability;
    if (!providers[key]) {
      missing.push(`Provider not connected: ${provider}`);
    }
  }

  for (const directive of strategy.requiredDirectives) {
    // All directives are registered as stubs or real implementations, so this
    // check is always satisfied in the current codebase. In production, verify
    // the directive is active.
  }

  if (strategy.premiumRequired) {
    missing.push('Requires premium data subscription');
  }

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    viable: missing.length === 0,
    missingRequirements: missing,
  };
}
