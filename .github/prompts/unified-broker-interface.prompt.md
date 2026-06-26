# unified-broker-interface: Universal Broker Portfolio, Account & Execution Surface

**Prompt ID:** unified-broker-interface
**Date:** 2026-06-26
**Status:** ready
**Priority:** FOUNDATION — must be built before automation loop

## Goal

Extend `IProviderAdapter` with optional portfolio, account, and order-execution methods so every broker exposes a unified surface. The automation loop, dashboard, and strategies must never say "Trading212" or "MT5" — they say "the active broker."

## Current State (The Gap)

```
IProviderAdapter          ← universal: getQuote, getCandles, getProfile, healthCheck
        │
        ├── Trading212Adapter  ← has getPositions(), getAccountCash(), placeMarketOrder()
        │                         but these are NOT on the shared interface
        │
        ├── Mt5Adapter         ← NO getPositions(), NO getAccount(), NO placeOrder()
        │                         Trading goes through separate Mt5TradingService
        │
        └── AlpacaAdapter      ← NO getPositions(), NO getAccount(), NO placeOrder()
```

**Result:** Every consumer hardcodes which broker it talks to.
- `PortfolioService` → hardcodes `Trading212Adapter`
- `TradingStrategyService.execute()` → hardcodes `this.mt5.placeOrder()`
- No way to ask "what positions does the MT5 broker hold?" through the shared interface

## Target State

```
IBrokerPortfolio    (optional — implemented by brokers that support it)
        │
        ├── getPositions():  Promise<BrokerPosition[]>
        ├── getAccount():    Promise<BrokerAccount>
        └── placeOrder?(params: BrokerOrderRequest): Promise<BrokerOrderResult>
        
IProviderAdapter extends IBrokerPortfolio (optional methods)

AdapterFactory.create('mt5') → returns IProviderAdapter (with optional IBrokerPortfolio)
AdapterFactory.create('trading212') → returns IProviderAdapter (with optional IBrokerPortfolio)
AdapterFactory.create('alpaca') → returns IProviderAdapter (with optional IBrokerPortfolio)
```

## New Interfaces

### IBrokerPortfolio (add to `interfaces/provider-adapter.interface.ts`)

```typescript
export interface BrokerPosition {
  brokerId: string;        // 'mt5' | 'trading212' | 'alpaca'
  brokerName: string;      // 'MetaTrader 5' | 'Trading212' | 'Alpaca'
  symbol: string;          // 'EURUSD' | 'AAPL_US_EQ' → normalized to 'AAPL'
  ticker: string;          // original broker ticker
  quantity: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  currency: string;        // 'USD' | 'GBP' | 'EUR'
  openedAt: string;        // ISO date
}

export interface BrokerAccount {
  brokerId: string;
  brokerName: string;
  balance: number;
  equity: number;
  margin: number;
  marginFree: number;
  marginLevel: number | null;
  currency: string;
  mode: 'live' | 'demo' | 'paper' | 'mock';
  connected: boolean;
}

export interface BrokerOrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  sl?: number;
  tp?: number;
  comment?: string;
}

export interface BrokerOrderResult {
  success: boolean;
  ticket?: string | number;
  price?: number;
  error?: string;
}
```

### Add to IProviderAdapter

```typescript
export interface IProviderAdapter {
  // ... existing methods ...

  // ─── Optional: Broker Portfolio & Execution ─────────────────
  
  /** Whether this broker supports portfolio/account/order operations. */
  readonly supportsBrokerage?: boolean;

  /** Fetch open positions for this broker. */
  getPositions?(): Promise<BrokerPosition[]>;

  /** Fetch account summary (balance, equity, margin). */
  getAccount?(): Promise<BrokerAccount | null>;

  /** Place a market order. */
  placeOrder?(params: BrokerOrderRequest): Promise<BrokerOrderResult>;
}
```

## Adapter Migration Plan

### 1. Trading212Adapter (already has the methods)

```typescript
// Already implemented — just wire to interface:
readonly supportsBrokerage = true;

// getPositions() → map T212Position[] → BrokerPosition[]
// getAccount() → map getAccountCash() → BrokerAccount
// placeOrder() → delegate to existing placeMarketOrder()
```

Key: T212 tickers like `AAPL_US_EQ` must be normalized to `AAPL` in `BrokerPosition.symbol`.

### 2. Mt5Adapter (needs new methods)

```typescript
readonly supportsBrokerage = true;

async getPositions(): Promise<BrokerPosition[]> {
  // Call MT5 bridge /positions endpoint
  // Map MT5 position → BrokerPosition
}

async getAccount(): Promise<BrokerAccount | null> {
  // Call MT5 bridge /account endpoint
  // Map MT5 account → BrokerAccount
}

async placeOrder(params: BrokerOrderRequest): Promise<BrokerOrderResult> {
  // Delegate to existing Mt5TradingService (inject via forwardRef if needed)
  // OR call bridge directly with same format
}
```

### 3. AlpacaAdapter (new — future)

```typescript
readonly supportsBrokerage = true;
// Implement getPositions, getAccount, placeOrder via Alpaca API
```

## PortfolioService → Broker-Agnostic

```typescript
@Injectable()
export class PortfolioService {
  constructor(
    private readonly adapterFactory: AdapterFactory,
    private readonly scoringService: ScoringService,
  ) {}

  async getPortfolio(brokerId: string): Promise<UnifiedPortfolio> {
    const adapter = this.adapterFactory.create(brokerId);
    if (!adapter?.supportsBrokerage || !adapter.getPositions) {
      return { brokerId, positions: [], account: null, error: 'Broker does not support portfolio' };
    }

    const [positions, account] = await Promise.all([
      adapter.getPositions(),
      adapter.getAccount?.() ?? null,
    ]);

    return { brokerId, positions, account };
  }

  async getAllPortfolios(): Promise<UnifiedPortfolio[]> {
    const brokers = this.adapterFactory.getBrokerageAdapters(); // filters by supportsBrokerage
    return Promise.all(brokers.map(b => this.getPortfolio(b.id)));
  }
}
```

## TradingStrategyService.execute() → Broker-Agnostic

```typescript
async execute(strategyId: string) {
  // ... evaluation logic (unchanged) ...

  // Instead of:
  //   const result = await this.mt5.placeOrder({ ... });
  // Do:
  const broker = this.adapterFactory.create(strategy.brokerId);
  if (!broker?.placeOrder) {
    return { executed: false, reason: `Broker ${strategy.brokerId} does not support orders` };
  }
  const result = await broker.placeOrder({
    symbol: strategy.symbol,
    side: orderType,
    quantity: size,
    sl: slPrice,
    tp: tpPrice,
    comment: `TCS ${strategy.name} | ${evalResult.composite}%`,
  });
}
```

## AdapterFactory Extensions

```typescript
// New method:
getBrokerageAdapters(): IProviderAdapter[] {
  return Array.from(this.adapters.values())
    .filter(a => a.instance?.supportsBrokerage)
    .map(a => a.instance!);
}
```

## PR Review

- `nest/src/modules/providers/interfaces/provider-adapter.interface.ts` — add `BrokerPosition`, `BrokerAccount`, `BrokerOrderRequest`, `BrokerOrderResult`, optional methods on `IProviderAdapter`
- `nest/src/modules/providers/adapters/trading212.adapter.ts` — wire existing methods to interface
- `nest/src/modules/providers/adapters/mt5.adapter.ts` — implement `getPositions`, `getAccount`, `placeOrder`
- `nest/src/modules/providers/adapter-factory.ts` — add `getBrokerageAdapters()`
- `nest/src/modules/portfolio/portfolio.service.ts` — remove hardcoded `Trading212Adapter`, use `AdapterFactory`
- `nest/src/modules/trading/trading-strategy.service.ts` — remove hardcoded `Mt5TradingService`, use `AdapterFactory`
- `nest/src/modules/trading/trading-strategy.controller.ts` — add `brokerId` to strategy create/update DTOs
- `nest/prisma/schema.prisma` — add `brokerId String @default("mt5")` to `TradingStrategy` model

## Verification

```bash
# After implementation, these should all work:
curl http://localhost:3201/api/portfolio?broker=mt5
curl http://localhost:3201/api/portfolio?broker=trading212
curl http://localhost:3201/api/portfolio?broker=alpaca  # returns error if no key
curl http://localhost:3201/api/portfolio/all            # unified view
```
