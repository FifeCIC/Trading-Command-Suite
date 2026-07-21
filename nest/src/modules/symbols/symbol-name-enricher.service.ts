/**
 * SymbolNameEnricherService
 * =========================
 * Fetches company/instrument names from available providers and updates
 * the Symbol.name field in the database.
 *
 * Priority order:
 *   1. MT5 bridge /symbol/{ticker}/info (forex/CFD — has description)
 *   2. Yahoo Finance getProfile() (free, no API key)
 *   3. Alpaca getProfile() (if configured)
 *
 * Called automatically during symbol registration (import pipelines)
 * and via POST /api/symbols/enrich for backfilling.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { Mt5ConnectionManager } from '../providers/mt5/mt5-connection-manager.service';

const ENRICH_BATCH_SIZE = 10;  // symbols per batch to avoid rate limits
const ENRICH_BATCH_DELAY = 2000; // ms between batches

@Injectable()
export class SymbolNameEnricherService {
  private readonly logger = new Logger(SymbolNameEnricherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
    private readonly mt5: Mt5ConnectionManager,
  ) {}

  /**
   * Enrich a single symbol with its company/instrument name.
   * Returns the resolved name or null if all providers failed.
   */
  async enrichOne(ticker: string): Promise<string | null> {
    const sym = ticker.toUpperCase();

    // 1. Try MT5 bridge (best for forex/CFD — provides description)
    try {
      const mt5Info = await this.mt5.getSymbolInfo(sym);
      if (mt5Info?.name && mt5Info.name !== sym) {
        const name = mt5Info.description || mt5Info.name;
        await this.updateSymbolName(sym, name);
        this.logger.debug(`MT5: ${sym} → "${name}"`);
        return name;
      }
    } catch { /* continue */ }

    // 2. Try Finnhub (reliable, API key configured)
    try {
      const finnhubKey = process.env.FINNHUB_API_KEY;
      if (finnhubKey) {
        const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${finnhubKey}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data?.name && data.name !== sym && data.name !== sym.toUpperCase()) {
            await this.updateSymbolName(sym, data.name);
            this.logger.debug(`Finnhub: ${sym} → "${data.name}"`);
            return data.name;
          }
        }
      }
    } catch { /* continue */ }

    // 3. Try FMP adapter (if API key works)
    try {
      const fmp = this.adapterFactory.create('fmp');
      if (fmp?.getProfile) {
        const profile = await fmp.getProfile(sym);
        if (profile?.name && profile.name !== sym && profile.name !== sym.toUpperCase()) {
          await this.updateSymbolName(sym, profile.name);
          this.logger.debug(`FMP: ${sym} → "${profile.name}"`);
          return profile.name;
        }
      }
    } catch { /* continue */ }

    // 4. Try Yahoo Finance (v11 unreliable, last resort)
    try {
      const yahoo = this.adapterFactory.create('yahoo');
      if (yahoo?.getProfile) {
        const profile = await yahoo.getProfile(sym);
        if (profile?.name && profile.name !== sym && profile.name !== sym.toUpperCase()) {
          await this.updateSymbolName(sym, profile.name);
          this.logger.debug(`Yahoo: ${sym} → "${profile.name}"`);
          return profile.name;
        }
      }
    } catch { /* continue */ }

    // 3. Try Alpaca
    try {
      const alpaca = this.adapterFactory.create('alpaca');
      if (alpaca?.getProfile) {
        const profile = await alpaca.getProfile(sym);
        if (profile?.name && profile.name !== sym) {
          await this.updateSymbolName(sym, profile.name);
          this.logger.debug(`Alpaca: ${sym} → "${profile.name}"`);
          return profile.name;
        }
      }
    } catch { /* continue */ }

    return null;
  }

  /**
   * Enrich all symbols that still have name === ticker (missing company names).
   * Processes in batches to avoid rate limiting providers.
   */
  async enrichAll(): Promise<{ enriched: number; failed: number; total: number }> {
    if (!this.prisma.isAvailable) return { enriched: 0, failed: 0, total: 0 };

    const symbols = await this.prisma.symbol.findMany({
      where: { active: true },
      select: { ticker: true, name: true },
    });

    // Only enrich symbols where name equals ticker or is empty
    const needsEnrich = symbols.filter(
      (s) => !s.name || s.name === s.ticker || s.name.length <= 5,
    );

    this.logger.log(`Found ${needsEnrich.length} symbols needing name enrichment (of ${symbols.length} total)`);

    let enriched = 0;
    let failed = 0;

    for (let i = 0; i < needsEnrich.length; i += ENRICH_BATCH_SIZE) {
      const batch = needsEnrich.slice(i, i + ENRICH_BATCH_SIZE);
      for (const sym of batch) {
        const result = await this.enrichOne(sym.ticker);
        if (result) enriched++;
        else failed++;
      }
      if (i + ENRICH_BATCH_SIZE < needsEnrich.length) {
        await this.sleep(ENRICH_BATCH_DELAY);
      }
    }

    this.logger.log(`Enrichment complete: ${enriched} enriched, ${failed} failed`);
    return { enriched, failed, total: needsEnrich.length };
  }

  private async updateSymbolName(ticker: string, name: string): Promise<void> {
    if (!this.prisma.isAvailable) return;
    await this.prisma.symbol.updateMany({
      where: { ticker },
      data: { name },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
