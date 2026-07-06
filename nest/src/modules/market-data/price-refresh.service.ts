/**
 * PriceRefreshService
 * ===================
 * Refreshes live prices for symbols via the provider fallback chain
 * with a write-threshold: only updates Position.currentPrice when
 * the change exceeds a configurable percentage.
 *
 * Provider chain: MT5 → Yahoo → Polygon → Finnhub → Twelve Data → FMP
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';

@Injectable()
export class PriceRefreshService {
  private readonly logger = new Logger(PriceRefreshService.name);
  private readonly PROVIDERS = ['mt5', 'yahoo', 'polygon', 'finnhub', 'twelvedata', 'fmp'];

  /** Only update stored price if change exceeds this percentage (0.1 = 0.1%) */
  private readonly WRITE_THRESHOLD_PCT = 0.1;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  /**
   * Refresh prices for a batch of symbols.
   * Returns which symbols were updated and their new prices.
   */
  async refreshPrices(
    symbols: string[],
  ): Promise<{ refreshed: Array<{ symbol: string; price: number; source: string; changed: boolean }> }> {
    const refreshed: Array<{ symbol: string; price: number; source: string; changed: boolean }> = [];

    for (const symbol of symbols) {
      try {
        const livePrice = await this.resolveLivePrice(symbol);
        if (!livePrice) continue;

        const changed = await this.maybeUpdateStoredPrice(symbol, livePrice.price);
        refreshed.push({
          symbol,
          price: livePrice.price,
          source: livePrice.source,
          changed,
        });
      } catch (err) {
        this.logger.warn(`Price refresh failed for ${symbol}: ${(err as Error).message}`);
      }
    }

    return { refreshed };
  }

  /**
   * Refresh prices for all positions in the DB.
   */
  async refreshAllPositions(): Promise<{ refreshed: number }> {
    if (!this.prisma.isAvailable) return { refreshed: 0 };

    const positions = await this.prisma.position.findMany({
      select: { symbol: true },
      distinct: ['symbol'],
    });
    const symbols = positions.map(p => p.symbol);
    const result = await this.refreshPrices(symbols);
    return { refreshed: result.refreshed.filter(r => r.changed).length };
  }

  // ── Private ──────────────────────────────────────────

  private async resolveLivePrice(
    symbol: string,
  ): Promise<{ price: number; source: string } | null> {
    for (const providerId of this.PROVIDERS) {
      try {
        const adapter = this.adapterFactory.create(providerId);
        if (!adapter) continue;

        const quote = await adapter.getQuote(symbol);
        if (!quote) continue;

        const price =
          quote.bid != null && quote.ask != null
            ? (quote.bid + quote.ask) / 2
            : quote.last ?? quote.bid ?? quote.ask ?? null;

        if (price != null && price > 0) {
          return { price, source: providerId };
        }
      } catch {
        // Provider failed — try next
      }
    }
    return null;
  }

  /**
   * Update the stored Position.currentPrice only if the change exceeds
   * the write threshold. Returns true if the price was updated.
   */
  private async maybeUpdateStoredPrice(
    symbol: string,
    newPrice: number,
  ): Promise<boolean> {
    if (!this.prisma.isAvailable) return false;

    try {
      const positions = await this.prisma.position.findMany({
        where: { symbol },
        select: { id: true, currentPrice: true },
      });

      let updated = false;
      for (const pos of positions) {
        const oldPrice = pos.currentPrice;
        // Skip write if change is below threshold
        if (oldPrice != null && oldPrice > 0) {
          const pctChange = Math.abs((newPrice - oldPrice) / oldPrice) * 100;
          if (pctChange < this.WRITE_THRESHOLD_PCT) continue;
        }

        await this.prisma.position.update({
          where: { id: pos.id },
          data: { currentPrice: newPrice },
        });
        updated = true;
      }

      return updated;
    } catch (err) {
      this.logger.warn(`Failed to update stored price for ${symbol}: ${(err as Error).message}`);
      return false;
    }
  }
}
