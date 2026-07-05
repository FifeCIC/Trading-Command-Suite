/**
 * Crypto Provider Router
 * =======================
 * Smart routing layer for crypto ticker data. Detects whether a symbol is a
 * cryptocurrency and routes it to the best available data source with automatic
 * failover.
 *
 * Priority chain (per ticker):
 *   1. Binance (free, 24/7, no auth, primary crypto source)
 *   2. MT5 broker (if the connected MT5 account has crypto symbols)
 *   3. Yahoo Finance (free, slow, rate-limited, last resort)
 *   4. null — no data available, directive scores 0
 *
 * For non-crypto tickers, passes through to the standard provider pipeline.
 *
 * Usage:
 *   const router = new CryptoProviderRouter(adapterFactory, degradation);
 *   const quote = await router.getQuote('BTCUSD');
 *   const bars = await router.getCandles('ETHUSD', '1h', 200);
 */

import { Injectable, Logger } from '@nestjs/common';
import { AdapterFactory } from './adapter-factory';
import { ProviderDegradationService } from './provider-degradation.service';
import { ProviderQuote, MarketBar, ProviderProfile } from './interfaces/provider-adapter.interface';
import {
  isCryptoTicker,
  toBinanceSymbol,
  fromBinanceSymbol,
} from './adapters/binance.adapter';

export interface CryptoSourceInfo {
  source: string;          // 'binance', 'mt5', 'yahoo', 'none'
  ticker: string;          // original TCS ticker
  binanceSymbol?: string;  // mapped Binance symbol if applicable
  degraded: boolean;       // is the primary source degraded?
}

@Injectable()
export class CryptoProviderRouter {
  private readonly logger = new Logger(CryptoProviderRouter.name);

  /** Known crypto tickers that we actively trade or monitor */
  private static readonly KNOWN_CRYPTO = new Set([
    'BTCUSD', 'ETHUSD', 'SOLUSD',
    'BTC-USD', 'ETH-USD', 'SOL-USD',
    'BTC', 'ETH', 'SOL',
    'DOGEUSD', 'XRPUSD', 'ADAUSD', 'LTCUSD', 'LINKUSD',
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT',
  ]);

  constructor(
    private readonly adapterFactory: AdapterFactory,
    private readonly degradation: ProviderDegradationService,
  ) {}

  // ─── Public API ──────────────────────────────────────────

  /** Check if a ticker is a crypto we can route */
  isCrypto(ticker: string): boolean {
    if (!ticker) return false;
    const upper = ticker.toUpperCase();
    return CryptoProviderRouter.KNOWN_CRYPTO.has(upper) || isCryptoTicker(upper);
  }

  /** Get the best available source for a crypto ticker */
  getSourceInfo(ticker: string): CryptoSourceInfo {
    const binanceSymbol = toBinanceSymbol(ticker);
    const info: CryptoSourceInfo = {
      source: 'none',
      ticker,
      binanceSymbol: binanceSymbol || undefined,
      degraded: false,
    };

    // 1. Binance — always preferred for crypto
    if (this.degradation.isAvailable('binance')) {
      info.source = 'binance';
      return info;
    }

    // 2. MT5 — if the active account has crypto symbols
    if (this.degradation.isAvailable('mt5')) {
      info.source = 'mt5';
      info.degraded = true; // Binance is primary, MT5 is fallback
      return info;
    }

    // 3. Yahoo Finance — last resort for crypto prices
    if (this.degradation.isAvailable('yahoo')) {
      info.source = 'yahoo';
      info.degraded = true;
      return info;
    }

    return info;
  }

  /** Get a quote for any ticker, routing crypto automatically */
  async getQuote(ticker: string): Promise<ProviderQuote | null> {
    if (!this.isCrypto(ticker)) {
      // Non-crypto: use standard provider pipeline (MT5 primary)
      return this.getStandardQuote(ticker);
    }

    const sourceInfo = this.getSourceInfo(ticker);
    this.logger.debug(`Routing ${ticker} → ${sourceInfo.source}${sourceInfo.degraded ? ' (degraded)' : ''}`);

    // Try Binance first
    if (sourceInfo.source === 'binance') {
      const binance = this.adapterFactory.create('binance');
      if (binance) {
        const quote = await binance.getQuote(ticker);
        if (quote) {
          this.degradation.reportSuccess('binance');
          return quote;
        }
        this.degradation.reportError('binance', 'Quote returned null');
      }
      // Fall through to MT5 if Binance failed
    }

    // Try MT5 next (for crypto or as Binance fallback)
    if (sourceInfo.source === 'binance' || sourceInfo.source === 'mt5') {
      const mt5 = this.adapterFactory.create('mt5');
      if (mt5) {
        const quote = await mt5.getQuote(ticker);
        if (quote) {
          this.degradation.reportSuccess('mt5');
          return quote;
        }
      }
    }

    // Try Yahoo last
    if (sourceInfo.source === 'binance' || sourceInfo.source === 'mt5' || sourceInfo.source === 'yahoo') {
      const yahoo = this.adapterFactory.create('yahoo');
      if (yahoo) {
        const quote = await yahoo.getQuote(ticker);
        if (quote) return quote;
      }
    }

    return null;
  }

  /** Get candles for any ticker, routing crypto automatically */
  async getCandles(
    ticker: string,
    timeframe = '1h',
    limit = 200,
  ): Promise<MarketBar[]> {
    if (!this.isCrypto(ticker)) {
      return this.getStandardCandles(ticker, timeframe, limit);
    }

    const sourceInfo = this.getSourceInfo(ticker);

    // Try Binance first
    if (sourceInfo.source === 'binance') {
      const binance = this.adapterFactory.create('binance');
      if (binance) {
        const bars = await binance.getCandles(ticker, timeframe, limit);
        if (bars && bars.length > 0) {
          this.degradation.reportSuccess('binance');
          return bars;
        }
        this.degradation.reportError('binance', 'Candles returned empty');
      }
    }

    // Try MT5 next
    if (sourceInfo.source === 'binance' || sourceInfo.source === 'mt5') {
      const mt5 = this.adapterFactory.create('mt5');
      if (mt5) {
        const bars = await mt5.getCandles(ticker, timeframe, limit);
        if (bars && bars.length > 0) return bars;
      }
    }

    // Try Yahoo last
    if (sourceInfo.source === 'binance' || sourceInfo.source === 'mt5' || sourceInfo.source === 'yahoo') {
      const yahoo = this.adapterFactory.create('yahoo');
      if (yahoo) {
        const bars = await yahoo.getCandles(ticker, timeframe, limit);
        if (bars && bars.length > 0) return bars;
      }
    }

    return [];
  }

  /** Get a profile for a crypto ticker */
  async getProfile(ticker: string): Promise<ProviderProfile | null> {
    if (!this.isCrypto(ticker)) {
      const yahoo = this.adapterFactory.create('yahoo');
      if (yahoo) return yahoo.getProfile(ticker);
      return null;
    }

    const binance = this.adapterFactory.create('binance');
    if (binance) return binance.getProfile(ticker);
    return null;
  }

  /** Check health of all crypto data sources */
  async healthCheck(): Promise<{
    binance: boolean;
    mt5: boolean;
    yahoo: boolean;
    primarySource: string;
  }> {
    const [binanceOk, mt5Ok, yahooOk] = await Promise.all([
      this.checkSource('binance'),
      this.checkSource('mt5'),
      this.checkSource('yahoo'),
    ]);

    return {
      binance: binanceOk,
      mt5: mt5Ok,
      yahoo: yahooOk,
      primarySource: binanceOk ? 'binance' : mt5Ok ? 'mt5' : yahooOk ? 'yahoo' : 'none',
    };
  }

  /** Get all known crypto tickers */
  getKnownCryptoTickers(): string[] {
    return Array.from(CryptoProviderRouter.KNOWN_CRYPTO)
      .filter((t) => !t.includes('-') && !t.endsWith('USDT'))
      .sort();
  }

  // ─── Private Helpers ─────────────────────────────────────

  private async getStandardQuote(ticker: string): Promise<ProviderQuote | null> {
    const mt5 = this.adapterFactory.create('mt5');
    if (mt5) {
      const quote = await mt5.getQuote(ticker);
      if (quote) return quote;
    }
    const yahoo = this.adapterFactory.create('yahoo');
    if (yahoo) {
      return yahoo.getQuote(ticker);
    }
    return null;
  }

  private async getStandardCandles(
    ticker: string,
    timeframe: string,
    limit: number,
  ): Promise<MarketBar[]> {
    const mt5 = this.adapterFactory.create('mt5');
    if (mt5) {
      const bars = await mt5.getCandles(ticker, timeframe, limit);
      if (bars && bars.length > 0) return bars;
    }
    const yahoo = this.adapterFactory.create('yahoo');
    if (yahoo) {
      return yahoo.getCandles(ticker, timeframe, limit);
    }
    return [];
  }

  private async checkSource(id: string): Promise<boolean> {
    try {
      const adapter = this.adapterFactory.create(id);
      if (!adapter) return false;
      return await adapter.healthCheck();
    } catch {
      return false;
    }
  }
}
