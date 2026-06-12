import { Injectable } from '@nestjs/common';

export interface StrategyDefinition {
  id: string;
  name: string;
  description: string;
  scope: string[];            // tickers in scope
  style: string;
  directives: { id: string; weight: number }[];
  averagingEnabled: boolean;
  entryThreshold: number;
  watchThreshold: number;
  timeframe: string;
}

@Injectable()
export class LongTermGrowthStrategy implements StrategyDefinition {
  readonly id = 'long-term-growth';
  readonly name = 'Long-Term Equity Growth';
  readonly description = 'Buy-and-hold with strategic averaging. Accumulates quality stocks on dips when conviction remains high and support levels are near.';
  readonly scope = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'GOOGL', 'AMZN', 'SPY', 'QQQ'];
  readonly style = 'buy-and-hold with averaging';
  readonly averagingEnabled = true;
  readonly entryThreshold = 60;
  readonly watchThreshold = 40;
  readonly timeframe = '1d';

  readonly directives = [
    { id: 'rsi-oversold', weight: 20 },
    { id: 'macd-crossover', weight: 15 },
    { id: 'ema-structure', weight: 15 },
    { id: 'atr-dip', weight: 10 },
    { id: 'volume-confirmation', weight: 10 },
    { id: 'support-resistance', weight: 15 },
    { id: 'panic-exhaustion', weight: 10 },
    { id: 'overhead-supply', weight: 5 },
  ];
}

/** Registry of all available strategies */
export const STRATEGY_REGISTRY: StrategyDefinition[] = [
  new LongTermGrowthStrategy(),
];
