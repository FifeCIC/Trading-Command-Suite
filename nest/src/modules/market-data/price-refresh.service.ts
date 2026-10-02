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
import { nextPeak, peakProfitPctFor } from '../../common/trading/peak';

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

        // ⚠️ CALLED UNCONDITIONALLY, AND DELIBERATELY NOT INSIDE maybeUpdateStoredPrice().
        // That method SKIPS its write when the move is under WRITE_THRESHOLD_PCT (0.1%), which is
        // a sensible economy for a LAST price and a silent corruption of a PEAK: a maximum that
        // can miss small increments is UNDERSTATED, and an understated peak makes every
        // "did we give back profit?" answer read slightly too well. See #998.
        await this.recordPeaks(symbol, livePrice.price);

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
   * recordPeaks() — write the durable high-water mark for every OPEN position on this symbol (#998).
   *
   * BEFORE: a position's best price existed only as an in-memory Map in the StopGuardian
   * (`simTslWatermark`), declared ephemeral in its own comment, and gated behind `simTslEnabled`
   * — a flag ZERO of 39 bots had set. So the give-back measured for #998 had to be RECONSTRUCTED
   * from `marketbar` highs, which is an indication rather than a record, and every future answer
   * would move as the bar data moved.
   *
   * AFTER: `peakPrice` + `peakProfitPct` are stored on the position row, written on EVERY refresh,
   * independently of any exit control being armed.
   *
   * ⚠️ WHY IT IS A SEPARATE METHOD and not folded into maybeUpdateStoredPrice(). Merging the two
   * looks like a tidy saving of one query per symbol, and it would put the peak write behind the
   * 0.1% threshold `continue` — the defect this method exists to avoid. If you are optimising
   * here, the saving is available only by keeping the peak write OUTSIDE the gate.
   *
   * ⚠️ WHY NOT IN `position-sync`. That service UPSERTS the whole position row from the broker
   * each poll, and its `update` block names a fixed field list. Writing a peak there would be
   * fine (the columns are deliberately absent from that list) but it runs on the broker's cadence
   * and would miss intra-poll excursions — which is precisely the data a peak is FOR.
   */
  private async recordPeaks(symbol: string, newPrice: number): Promise<void> {
    if (!this.prisma.isAvailable) return;

    try {
      const positions = await this.prisma.position.findMany({
        where: { symbol },
        select: { id: true, side: true, avgPrice: true, peakPrice: true, peakProfitPct: true },
      });

      for (const pos of positions as any[]) {
        const peakPrice = nextPeak(pos.peakPrice, newPrice);
        const peakProfitPct = peakProfitPctFor(pos.peakProfitPct, pos.side, pos.avgPrice, newPrice);

        // Only write when the record actually MOVES. A monotonic field that is re-written with an
        // unchanged value every refresh is pure write amplification on a hot path.
        const priceMoved = peakPrice != null && peakPrice !== pos.peakPrice;
        const pctMoved = peakProfitPct != null && peakProfitPct !== pos.peakProfitPct;
        if (!priceMoved && !pctMoved) continue;

        await this.prisma.position.update({
          where: { id: pos.id },
          data: {
            ...(priceMoved ? { peakPrice } : {}),
            ...(pctMoved ? { peakProfitPct } : {}),
          },
        });
      }
    } catch (err) {
      // A peak is a RECORD, not a risk control: failing to write one must never break a price
      // refresh. Warn and continue rather than throwing into the caller's loop.
      this.logger.warn(`Failed to record peak for ${symbol}: ${(err as Error).message}`);
    }
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
