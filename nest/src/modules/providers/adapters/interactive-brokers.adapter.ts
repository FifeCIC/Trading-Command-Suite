/**
 * Interactive Brokers (IBKR) Provider Adapter — Mock Stub
 * ========================================================
 * Implements IProviderAdapter with mock data for all methods.
 *
 * IBKR supports: stocks, ETFs, options, futures, forex, bonds, crypto.
 * This stub returns hardcoded responses — real API integration
 * requires TWS/Gateway connection (localhost:4001/4002).
 *
 * Env var gate: IBKR_MODE=none|mock (defaults to 'none' — disabled unless explicitly mocked)
 *
 * Registered at failoverPriority: 10 (low — mock data only)
 * Capabilities: quotes, candles
 *
 * ⚠️ NOT `profiles` (#966). See `getProfile()` below — it used to return a hardcoded
 * `Technology / Software / $50B` for every symbol, which is a plausible-looking fabrication
 * rather than obviously-mock data.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  IProviderAdapter,
  ProviderQuote,
  MarketBar,
  ProviderProfile,
  BrokerAccount,
  BrokerPosition,
  BrokerOrderRequest,
  BrokerOrderResult,
} from '../interfaces/provider-adapter.interface';

@Injectable()
export class InteractiveBrokersAdapter implements IProviderAdapter {
  readonly name = 'Interactive Brokers';
  readonly id = 'interactive-brokers';

  private readonly logger = new Logger(InteractiveBrokersAdapter.name);
  private readonly mode: 'mock' | 'none';

  constructor() {
    this.mode = (process.env.IBKR_MODE || 'none') as 'mock' | 'none';
    if (this.mode === 'none') {
      this.logger.warn('IBKR adapter disabled (IBKR_MODE=none)');
    } else {
      this.logger.log('IBKR adapter initialized in mock mode');
    }
  }

  private get enabled(): boolean {
    return this.mode !== 'none';
  }

  // ── IProviderAdapter Implementation ──────────────────────

  async getQuote(symbol: string): Promise<ProviderQuote | null> {
    if (!this.enabled) return null;
    return {
      symbol: symbol.toUpperCase(),
      bid: 100 + Math.random() * 10,
      ask: 101 + Math.random() * 10,
      last: 100.5 + Math.random() * 10,
      timestamp: new Date(),
    } as unknown as ProviderQuote;
  }

  async getCandles(
    symbol: string,
    timeframe: string,
    limit = 100,
  ): Promise<MarketBar[]> {
    if (!this.enabled) return [];
    const bars: MarketBar[] = [];
    let price = 100 + Math.random() * 50;
    const now = Date.now();
    const tfMs: Record<string, number> = {
      '1m': 60_000, '5m': 300_000, '15m': 900_000,
      '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
    };
    const interval = tfMs[timeframe] || 3_600_000;

    for (let i = limit; i >= 0; i--) {
      const open = price;
      const close = open + (Math.random() - 0.5) * 4;
      const high = Math.max(open, close) + Math.random() * 2;
      const low = Math.min(open, close) - Math.random() * 2;
      bars.push({
        timestamp: new Date(now - i * interval),
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: Math.round(Math.random() * 1_000_000),
      });
      price = close;
    }
    return bars;
  }

  /**
   * getProfile() — deliberately returns NULL, and that is the fix rather than a gap (#966).
   *
   * BEFORE: this returned `{ name: '<TICKER> Inc. (IBKR Mock)', exchange: 'NYSE',
   * sector: 'Technology', industry: 'Software', marketCap: 50_000_000_000 }` for EVERY symbol.
   *
   * ⚠️ A mock QUOTE is obviously mock — random numbers change every call and nobody persists them.
   * A mock PROFILE is not: "Technology / Software / $50B" is a plausible-looking fact that is
   * indistinguishable from a real one, and it flows into `getSnapshot().company` and from there
   * into the Symbols Browser. Had `IBKR_MODE=mock` ever been set on a machine whose profile chain
   * reached this adapter, every symbol in the app would have confidently claimed to be a $50B
   * NYSE software company. Same class as #959 (`'Xtrend'`) and the constants removed in #638.
   *
   * The honesty rule from `development-philosophy` §7: correct code that cannot be distinguished
   * from a wrong answer is a defect. Returning `null` makes the gap VISIBLE — the caller can then
   * report "IBKR was asked and had nothing", which is true, instead of a fabricated profile that
   * is not.
   *
   * If real IBKR fundamentals are ever wanted, they need a TWS/Gateway call
   * (`reqContractDetails` + `reqFundamentalData`), not a constant.
   */
  async getProfile(_symbol: string): Promise<ProviderProfile | null> {
    if (!this.enabled) return null;
    this.logger.debug('IBKR is a mock stub — refusing to fabricate a company profile (#966)');
    return null;
  }

  async healthCheck(): Promise<boolean> {
    return this.enabled;
  }

  async getAccount(): Promise<BrokerAccount | null> {
    if (!this.enabled) return null;
    return {
      brokerId: this.id,
      brokerName: this.name,
      balance: 100_000,
      equity: 100_000,
      margin: 0,
      marginFree: 100_000,
      marginLevel: null,
      currency: 'USD',
      mode: 'mock',
      connected: true,
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    if (!this.enabled) return [];
    return [
      {
        brokerId: this.id,
        brokerName: this.name,
        symbol: 'AAPL',
        ticker: 'AAPL',
        quantity: 50,
        avgCost: 175.30,
        currentPrice: 182.50,
        marketValue: 50 * 182.50,
        unrealizedPnl: 360,
        unrealizedPnlPct: Math.round(360 / (50 * 175.30) * 10000) / 100,
        currency: 'USD',
        openedAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      } as unknown as BrokerPosition,
    ];
  }

  async placeOrder(_params: BrokerOrderRequest): Promise<BrokerOrderResult> {
    this.logger.warn('IBKR placeOrder called in mock mode — no real execution');
    return {
      success: true,
      orderId: `IBKR-MOCK-${Date.now()}`,
      price: 100,
    } as unknown as BrokerOrderResult;
  }

  async getSymbols(): Promise<string[]> {
    return ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'];
  }
}
