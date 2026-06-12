/**
 * Trading Strategy Interface
 * ==========================
 * A TradingStrategy is a ScoringStrategy PLUS allocation rules, account selection,
 * trade duration, and automation settings. This is the layer above scoring that
 * decides "buy X amount of Y for Z days."
 */

export interface TradingStrategy {
  id: string;
  name: string;
  scoringStrategyId: string;

  allocation: {
    maxPortfolioRisk: number;     // 0.15 = 15% max portfolio at risk
    perTradeRisk: number;         // 0.02 = 2% risk per trade
    maxPositions: number;         // max concurrent positions
    maxPerSymbol: number;         // 0.25 = 25% max allocation per symbol
    positionSizing: 'fixed' | 'kelly' | 'risk-based';
    fixedLotSize: number;         // if fixed sizing
  };

  tradeManagement: {
    stopLossPercent: number;
    takeProfitPercent: number;
    maxHoldDuration: string;      // '7d', '30d', 'unlimited'
    trailingStop: boolean;
    scalingOut: boolean;
  };

  account: {
    provider: 'alpaca' | 'trading212' | 'mt5' | 'ibkr';
    accountId: string;
    isPaper: boolean;
  };

  automation: {
    schedule: string;             // cron expression or 'manual'
    minScore: number;             // 60 = only trade when score ≥ 60
    maxSlippage: number;          // 0.005 = 0.5% max slippage
    orderType: 'market' | 'limit';
    enabled: boolean;
  };

  /** Which symbol types/symbols to trade */
  scope: {
    symbolTypes: string[];        // ['stocks', 'crypto', 'forex']
    excludeSymbols: string[];     // symbols to skip
    maxSymbols: number;           // top N symbols to trade
  };

  status: 'draft' | 'active' | 'paused' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface StrategyPosition {
  id: string;
  tradingStrategyId: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: string;
  closeReason?: string;
  pnl?: number;
}

export interface StrategyExecutionLog {
  id: string;
  tradingStrategyId: string;
  timestamp: string;
  action: 'open' | 'close' | 'adjust' | 'skip';
  symbol?: string;
  score?: number;
  reason: string;
}

export const DEFAULT_TRADING_STRATEGY: Omit<TradingStrategy, 'id' | 'name' | 'scoringStrategyId' | 'createdAt' | 'updatedAt'> = {
  allocation: {
    maxPortfolioRisk: 0.15,
    perTradeRisk: 0.02,
    maxPositions: 5,
    maxPerSymbol: 0.25,
    positionSizing: 'risk-based',
    fixedLotSize: 100,
  },
  tradeManagement: {
    stopLossPercent: 0.05,
    takeProfitPercent: 0.10,
    maxHoldDuration: '30d',
    trailingStop: false,
    scalingOut: false,
  },
  account: {
    provider: 'alpaca',
    accountId: 'paper',
    isPaper: true,
  },
  automation: {
    schedule: 'manual',
    minScore: 60,
    maxSlippage: 0.005,
    orderType: 'market',
    enabled: false,
  },
  scope: {
    symbolTypes: ['stocks'],
    excludeSymbols: [],
    maxSymbols: 3,
  },
  status: 'draft',
};
