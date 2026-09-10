/**
 * PortfolioPriceService
 * =====================
 * Resolves live prices for portfolio positions via provider fallback chain
 * and computes real-time P&L, allocation, and portfolio-level aggregation.
 *
 * Provider chain: MT5 → Yahoo → Polygon → Finnhub → Twelve Data → FMP
 * Falls back through each provider if the previous fails or has no quote.
 */

import { Injectable, Logger } from '@nestjs/common';
import { AdapterFactory } from '../providers/adapter-factory';
import {
  sideDirection,
  unrealizedPnlAmount as pnlAmount,
  unrealizedPnlPct as pnlPercent,
} from '../../common/utils/position-pnl';

export interface LivePosition {
  symbol: string;
  ticker: string;
  quantity: number;
  avgCost: number;
  currentPrice: number | null;
  priceSource: string | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  allocation: number | null; // % of portfolio
}

export interface ComputedPortfolio {
  source: string;
  positions: LivePosition[];
  summary: {
    totalPositions: number;
    pricedPositions: number;
    totalMarketValue: number;
    totalCost: number;
    totalUnrealizedPnl: number;
    totalUnrealizedPnlPct: number;
    priceSource: string | null;
  };
  timestamp: string;
}

@Injectable()
export class PortfolioPriceService {
  private readonly logger = new Logger(PortfolioPriceService.name);

  /** Provider fallback chain in priority order */
  private readonly PRICE_PROVIDERS = ['mt5', 'yahoo', 'polygon', 'finnhub', 'twelvedata', 'fmp'];

  constructor(private readonly adapterFactory: AdapterFactory) {}

  /**
   * Get a live quote for a single symbol using the provider fallback chain.
   */
  async getLivePrice(symbol: string): Promise<{ price: number; source: string } | null> {
    for (const providerId of this.PRICE_PROVIDERS) {
      try {
        const adapter = this.adapterFactory.create(providerId);
        if (!adapter) continue;

        const quote = await adapter.getQuote(symbol);
        if (!quote) continue;

        // Extract mid price — prefer bid/ask midpoint, fall back to last
        const price =
          quote.bid != null && quote.ask != null
            ? (quote.bid + quote.ask) / 2
            : quote.last ?? quote.bid ?? quote.ask ?? null;

        if (price != null && price > 0) {
          return { price, source: providerId };
        }
      } catch (err) {
        // Provider failed — try next in chain
      }
    }

    return null;
  }

  /**
   * Computes a live portfolio with real-time prices and derived P&L.
   *
   * @param positions — raw positions from any source (MT5, T212, paper)
   * @param source — label for the data source (mt5, trading212, all, paper)
   */
  async computePortfolio(
    positions: Array<{
      symbol: string;
      quantity?: number;
      volume?: number;
      avgCost?: number;
      averagePrice?: number;
      currentPrice?: number;
      side?: string | number | null;
    }>,
    source: string = 'all',
  ): Promise<ComputedPortfolio> {
    const livePositions: LivePosition[] = [];

    for (const pos of positions) {
      const symbol = (pos.symbol || '').toUpperCase();
      if (!symbol) continue;

      const quantity = pos.quantity ?? pos.volume ?? 0;
      const avgCost = pos.avgCost ?? pos.averagePrice ?? 0;

      // Try to get a live price
      const liveQuote = await this.getLivePrice(symbol);

      const currentPrice = liveQuote?.price ?? pos.currentPrice ?? null;
      const priceSource = liveQuote?.source ?? (pos.currentPrice ? 'stored' : null);

      let marketValue: number | null = null;
      let unrealizedPnl: number | null = null;
      let unrealizedPnlPct: number | null = null;

      if (currentPrice != null && quantity > 0) {
        marketValue = currentPrice * quantity;
        if (avgCost > 0) {
          // 2026-09-10 — side-aware: a short profits as the price falls, so the
          // long-only formula inverted every short's P&L sign.
          unrealizedPnl = pnlAmount(avgCost, currentPrice, quantity, (pos as any).side);
          unrealizedPnlPct = pnlPercent(avgCost, currentPrice, (pos as any).side);
        }
      }

      livePositions.push({
        symbol,
        ticker: symbol,
        quantity,
        avgCost,
        currentPrice,
        priceSource,
        marketValue,
        unrealizedPnl,
        unrealizedPnlPct,
        allocation: null, // computed below after totals
      });
    }

    // ── Portfolio aggregation ──
    const totalMarketValue = livePositions.reduce(
      (sum, p) => sum + (p.marketValue ?? 0), 0,
    );
    const totalCost = livePositions.reduce(
      (sum, p) => sum + (p.avgCost * p.quantity), 0,
    );
    const totalUnrealizedPnl = livePositions.reduce(
      (sum, p) => sum + (p.unrealizedPnl ?? 0), 0,
    );
    const totalUnrealizedPnlPct =
      totalCost > 0 ? (totalUnrealizedPnl / totalCost) * 100 : 0;
    const pricedPositions = livePositions.filter(p => p.currentPrice != null).length;
    const priceSource =
      livePositions.find(p => p.priceSource)?.priceSource ?? null;

    // Compute allocation % per position
    if (totalMarketValue > 0) {
      for (const p of livePositions) {
        p.allocation = p.marketValue != null
          ? (p.marketValue / totalMarketValue) * 100
          : null;
      }
    }

    return {
      source,
      positions: livePositions,
      summary: {
        totalPositions: livePositions.length,
        pricedPositions,
        totalMarketValue: Math.round(totalMarketValue * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        totalUnrealizedPnl: Math.round(totalUnrealizedPnl * 100) / 100,
        totalUnrealizedPnlPct: Math.round(totalUnrealizedPnlPct * 100) / 100,
        priceSource,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
