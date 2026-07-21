/**
 * DataImportOrchestrator
 * ======================
 * Single handler tracking freshness across ALL data types and dispatching
 * the right import when data is stale or missing.
 *
 * Architecture:
 *   check(overallFreshness) → dispatch per type → import → log → return
 *
 * Data types managed:
 *  - marketBar  → ImportJobsService (MT5/AV/T212/Yahoo)
 *  - earnings   → EarningsService (Alpha Vantage)
 *  - news       → NewsImportService (Finnhub, cron every 6h)
 *  - profile    → SymbolNameEnricherService (company name from provider getProfile())
 *  - price      → PriceRefreshService (provider chain live quotes)
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { FreshnessService } from '../market-data/freshness.service';
import { PriceRefreshService } from '../market-data/price-refresh.service';
import { ImportJobsService } from '../import-jobs/import-jobs.service';
import { SymbolNameEnricherService } from '../symbols/symbol-name-enricher.service';

export interface ImportAction {
  dataType: string;
  status: 'imported' | 'skipped' | 'failed' | 'already_fresh';
  recordsAffected: number;
  durationMs: number;
  source: string;
  error?: string;
}

export interface OrchestrationResult {
  symbolId: string;
  ticker?: string;
  overallStatus: 'fresh' | 'partially_fresh' | 'stale' | 'missing';
  actions: ImportAction[];
  totalDurationMs: number;
  timestamp: string;
}

@Injectable()
export class DataImportOrchestrator {
  private readonly logger = new Logger(DataImportOrchestrator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly freshness: FreshnessService,
    private readonly priceRefresh: PriceRefreshService,
    private readonly importJobs: ImportJobsService,
    private readonly enricher: SymbolNameEnricherService,
  ) {}

  /**
   * Ensure a single symbol has fresh data across all types.
   * Checks freshness, imports stale/missing data, logs audit trail.
   */
  async ensureSymbolFresh(
    symbolId: string,
    ticker?: string,
    options?: {
      skipMarketBars?: boolean;
      skipEarnings?: boolean;
      skipNews?: boolean;
      skipPrices?: boolean;
      skipProfile?: boolean;
    },
  ): Promise<OrchestrationResult> {
    const start = Date.now();
    const actions: ImportAction[] = [];

    // 1. Check freshness across all types
    const freshnessResult = await this.freshness.overallFreshness(symbolId, ticker);

    // 2. Dispatch imports for stale/missing types
    for (const [type, result] of Object.entries(freshnessResult.types)) {
      if (result.status === 'fresh') {
        actions.push({ dataType: type, status: 'already_fresh', recordsAffected: 0, durationMs: 0, source: 'none' });
        continue;
      }

      const typeStart = Date.now();

      try {
        switch (type) {
          case 'marketBar': {
            if (options?.skipMarketBars) break;
            await this.importJobs.enqueueImport({
              symbolId,
              timeframe: '1h',
              provider: 'mt5',
              source: 'orchestrator',
            });
            actions.push({ dataType: type, status: 'imported', recordsAffected: 1, durationMs: Date.now() - typeStart, source: 'mt5/av/t212/yahoo' });
            break;
          }
          case 'price': {
            if (options?.skipPrices) break;
            const priceResult = await this.priceRefresh.refreshPrices([ticker || symbolId]);
            const changed = priceResult.refreshed.filter(r => r.changed).length;
            actions.push({ dataType: type, status: 'imported', recordsAffected: changed, durationMs: Date.now() - typeStart, source: priceResult.refreshed[0]?.source || 'unknown' });
            break;
          }
          case 'earnings': {
            if (options?.skipEarnings) break;
            // Earnings import is bulk-only (no single-symbol API) — mark as skipped
            actions.push({ dataType: type, status: 'skipped', recordsAffected: 0, durationMs: 0, source: 'bulk-only', error: 'Earnings are imported in bulk via POST /api/earnings/import' });
            break;
          }
          case 'news': {
            if (options?.skipNews) break;
            // News is cron-driven — mark as skipped
            actions.push({ dataType: type, status: 'skipped', recordsAffected: 0, durationMs: 0, source: 'cron', error: 'News auto-imports via tiered cron (see NewsImportService)' });
            break;
          }
          case 'profile': {
            if (options?.skipProfile) break;
            if (!ticker) {
              // Resolve ticker from symbolId
              const sym = await this.prisma.symbol.findUnique({ where: { id: symbolId }, select: { ticker: true } });
              ticker = sym?.ticker;
            }
            if (ticker) {
              const name = await this.enricher.enrichOne(ticker);
              if (name) {
                actions.push({ dataType: type, status: 'imported', recordsAffected: 1, durationMs: Date.now() - typeStart, source: 'provider' });
              } else {
                actions.push({ dataType: type, status: 'skipped', recordsAffected: 0, durationMs: Date.now() - typeStart, source: 'none', error: 'All providers failed to resolve name' });
              }
            } else {
              actions.push({ dataType: type, status: 'skipped', recordsAffected: 0, durationMs: 0, source: 'unknown', error: 'No ticker available for enrichment' });
            }
            break;
          }
          default: {
            actions.push({ dataType: type, status: 'skipped', recordsAffected: 0, durationMs: 0, source: 'unknown', error: `No importer for type: ${type}` });
          }
        }
      } catch (err) {
        actions.push({ dataType: type, status: 'failed', recordsAffected: 0, durationMs: Date.now() - typeStart, source: 'error', error: (err as Error).message });
      }
    }

    // 3. Log audit trail
    await this.logAudit(symbolId, ticker, freshnessResult.status, actions);

    // 4. Determine overall status
    const imported = actions.filter(a => a.status === 'imported').length;
    const failed = actions.filter(a => a.status === 'failed').length;
    const fresh = actions.filter(a => a.status === 'already_fresh').length;

    let overallStatus: OrchestrationResult['overallStatus'];
    if (failed > 0 && imported === 0) overallStatus = 'stale';
    else if (failed > 0) overallStatus = 'partially_fresh';
    else if (imported > 0) overallStatus = 'partially_fresh';
    else if (fresh === actions.length) overallStatus = 'fresh';
    else overallStatus = 'missing';

    return {
      symbolId,
      ticker,
      overallStatus,
      actions,
      totalDurationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Batch-orchestrate freshness for multiple symbols.
   */
  async ensureBatchFresh(symbols: Array<{ symbolId: string; ticker?: string }>): Promise<OrchestrationResult[]> {
    const results: OrchestrationResult[] = [];
    for (const sym of symbols) {
      try {
        results.push(await this.ensureSymbolFresh(sym.symbolId, sym.ticker));
      } catch (err) {
        this.logger.warn(`Orchestration failed for ${sym.symbolId}: ${(err as Error).message}`);
      }
    }
    return results;
  }

  /**
   * Orchestrate freshness for all active portfolio symbols.
   */
  async ensurePortfolioFresh(): Promise<{ symbols: number; results: OrchestrationResult[] }> {
    if (!this.prisma.isAvailable) return { symbols: 0, results: [] };

    const positions = await this.prisma.position.findMany({
      select: { symbol: true },
      distinct: ['symbol'],
    });
    const symbols = await this.prisma.symbol.findMany({
      where: { ticker: { in: positions.map(p => p.symbol) } },
      select: { id: true, ticker: true },
    });

    const symbolEntries = symbols.map(s => ({ symbolId: s.id, ticker: s.ticker }));
    const results = await this.ensureBatchFresh(symbolEntries);
    return { symbols: symbols.length, results };
  }

  // ── Audit ──────────────────────────────────────────────

  private async logAudit(
    symbolId: string,
    ticker: string | undefined,
    freshnessStatus: string,
    actions: ImportAction[],
  ): Promise<void> {
    if (!this.prisma.isAvailable) return;

    try {
      for (const action of actions) {
        if (action.status === 'already_fresh') continue; // Don't log no-ops

        await this.prisma.dataImportLog.create({
          data: {
            dataType: action.dataType,
            source: `${ticker || symbolId} — ${action.source}`,
            status: action.status === 'imported' ? 'success' : action.status === 'failed' ? 'failed' : 'partial',
            recordsFetched: action.recordsAffected,
            recordsStored: action.status === 'imported' ? action.recordsAffected : 0,
            recordsSkipped: action.status === 'skipped' ? 1 : 0,
            errorMessage: action.error || null,
            rateLimitHits: 0,
            durationMs: action.durationMs,
            fetchedAt: new Date(),
          },
        });
      }

      this.logger.log(`Audit logged: ${actions.length} actions for ${ticker || symbolId} (${freshnessStatus})`);
    } catch (err) {
      this.logger.warn(`Failed to log audit for ${symbolId}: ${(err as Error).message}`);
    }
  }
}
