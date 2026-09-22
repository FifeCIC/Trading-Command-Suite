/**
 * GlobalDiversificationService
 * ==============================
 * Cross-broker diversification engine.
 *
 * Responsibilities:
 *   - Aggregate all positions across ALL brokers (MT5, Trading212, ISA)
 *   - Detect duplicate symbols held on multiple brokers
 *   - Calculate global exposure per symbol / per broker
 *   - Pre-trade cross-broker duplicate check
 *   - Manage global diversification settings (DB-backed)
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { resolvePositionPnl } from '../../common/utils/position-pnl';
// #778 — broker-maintained vs cached-import rows: the ONE shared definition.
import { isLivePosition } from '../../common/utils/position-freshness';

// ── Default Settings ───────────────────────────────────

const DEFAULT_GLOBAL_SETTINGS: Record<string, string> = {
  'diversification.mode': 'warn',            // 'strict' | 'warn' | 'off'
  'diversification.maxCrossBrokerSymbols': '0', // max same symbol across brokers (0 = no duplicates)
  'diversification.maxGlobalExposurePct': '25', // max % of total portfolio in one symbol
  'diversification.maxSectorExposurePct': '50', // max % in one sector
  'diversification.brokerAllocation.mt5': '50',  // % of total funds allocated to MT5
  'diversification.brokerAllocation.trading212': '35', // % to Trading212 GIA
  'diversification.brokerAllocation.isa': '15',  // % to Stocks ISA
};

// ── Interfaces ────────────────────────────────────────

export interface CrossBrokerDuplicate {
  symbol: string;
  brokers: string[];
  totalQuantity: number;
  totalValue: number;
  positions: BrokerPositionSummary[];
}

export interface BrokerPositionSummary {
  brokerId: string;
  brokerName: string;
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  currency: string;
}

export interface GlobalExposure {
  symbol: string;
  totalValue: number;
  totalValueGbp: number;
  pctOfPortfolio: number;
  brokerBreakdown: { brokerId: string; value: number; quantity: number }[];
}

export interface DiversificationSummary {
  totalPortfolioValue: number;
  totalPortfolioValueGbp: number;
  brokerBreakdown: {
    brokerId: string;
    brokerName: string;
    totalValue: number;
    currency: string;
    positionCount: number;
    allocationPct: number;
  }[];
  crossBrokerDuplicates: CrossBrokerDuplicate[];
  globalExposures: GlobalExposure[];
  settings: Record<string, string>;
  warnings: string[];
  /**
   * #778 — rows excluded from every figure above because no broker sync maintains them
   * (cached portfolio-import rows). Counted and dated so the exclusion is visible.
   */
  cachedImportPositions: { count: number; newestQuote: string | null; note: string };
}

export interface PreTradeCheckResult {
  allowed: boolean;
  blocked: boolean;
  reason?: string;
  severity: 'info' | 'warn' | 'block';
  existingPositions?: CrossBrokerDuplicate;
  globalExposure?: GlobalExposure;
}

// ── Service ───────────────────────────────────────────

@Injectable()
export class GlobalDiversificationService {
  private readonly logger = new Logger(GlobalDiversificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Settings ────────────────────────────────────────

  async getSettings(): Promise<Record<string, string>> {
    if (!this.prisma.isAvailable) return { ...DEFAULT_GLOBAL_SETTINGS };

    try {
      const rows = await this.prisma.globalSetting.findMany();
      const merged = { ...DEFAULT_GLOBAL_SETTINGS };
      for (const row of rows) {
        merged[row.key] = row.value;
      }
      return merged;
    } catch (err) {
      this.logger.warn(`Failed to read global settings: ${(err as Error).message}`);
      return { ...DEFAULT_GLOBAL_SETTINGS };
    }
  }

  async updateSetting(key: string, value: string): Promise<void> {
    if (!this.prisma.isAvailable) return;
    try {
      await this.prisma.globalSetting.upsert({
        where: { key },
        update: { value, updatedAt: new Date() },
        create: { key, value },
      });
    } catch (err) {
      this.logger.error(`Failed to update setting ${key}: ${(err as Error).message}`);
    }
  }

  async updateSettings(settings: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await this.updateSetting(key, value);
    }
  }

  // ── Position Aggregation ────────────────────────────

  /**
   * Aggregate open positions across all brokers from the DB — **broker-maintained rows only**.
   *
   * ⚠️ #778 — the Position table also holds cached portfolio-IMPORT rows (a one-off Trading 212
   * import with quotes frozen at import time). They are NOT current holdings: counting them put
   * ~99.98% of “portfolio value“ on an 8-week-old snapshot, and let a frozen row trip the
   * pre-trade cross-broker duplicate guard. Only rows a broker sync maintains participate in
   * diversification; excluded rows are counted, dated and reported via `cachedImportBlock()`.
   */
  async getAllPositions(): Promise<BrokerPositionSummary[]> {
    const { live } = await this.loadPositionRows();
    return live;
  }

  /** #778 — the excluded rows, counted and dated (never silently dropped). */
  private cachedImportBlock(cached: any[]): { count: number; newestQuote: string | null; note: string } {
    if (cached.length === 0) return { count: 0, newestQuote: null, note: '' };
    const newest = cached.reduce((a, b) =>
      new Date(a.lastQuotedAt ?? 0).getTime() >= new Date(b.lastQuotedAt ?? 0).getTime() ? a : b,
    );
    const newestIso = newest.lastQuotedAt instanceof Date
      ? newest.lastQuotedAt.toISOString()
      : String(newest.lastQuotedAt ?? '');
    const providers = [...new Set(cached.map((r) => r.provider))].join(', ');
    return {
      count: cached.length,
      newestQuote: newestIso,
      note:
        `${cached.length} position row(s) are cached portfolio-import records (${providers}; newest quote ` +
        `${newestIso.slice(0, 10)}) — not refreshed by any broker sync, excluded from diversification figures (#778).`,
    };
  }

  /** One read of the position table, split by the shared freshness rule. */
  private async loadPositionRows(): Promise<{ live: BrokerPositionSummary[]; cached: any[] }> {
    if (!this.prisma.isAvailable) return { live: [], cached: [] };
    try {
      const rows = await this.prisma.position.findMany({
        orderBy: [{ provider: 'asc' }, { symbol: 'asc' }],
      });

      const brokerNames: Record<string, string> = {
        mt5: 'MT5',
        trading212: 'Trading212',
        isa: 'Stocks ISA',
      };

      const live = rows
        .filter((r) => isLivePosition(r.lastQuotedAt))
        .map((r) => {
          // 2026-09-10 — side-aware P&L (short rows previously inverted here too).
          const { pnl, pnlPct } = resolvePositionPnl({
            side: r.side,
            avgPrice: r.avgPrice,
            currentPrice: r.currentPrice ?? r.avgPrice,
            quantity: r.quantity,
            brokerPnl: r.pnl,
          });
          return {
            brokerId: r.provider,
            brokerName: brokerNames[r.provider] || r.provider,
            symbol: r.symbol,
            quantity: r.quantity,
            avgPrice: r.avgPrice,
            currentPrice: r.currentPrice ?? 0,
            marketValue: (r.currentPrice ?? r.avgPrice) * r.quantity,
            unrealizedPnl: pnl ?? 0,
            unrealizedPnlPct: pnlPct ?? 0,
            currency: r.provider === 'mt5' ? 'GBP' : r.provider === 'trading212' ? 'USD' : 'GBP',
          };
        });

      return { live, cached: rows.filter((r) => !isLivePosition(r.lastQuotedAt)) };
    } catch (err) {
      this.logger.warn(`Failed to fetch positions: ${(err as Error).message}`);
      return { live: [], cached: [] };
    }
  }

  // ── Cross-Broker Duplicate Detection ─────────────────

  /**
   * Find symbols that are held on more than one broker.
   * This is the core diversification concern — same stock on MT5 AND T212.
   */
  findCrossBrokerDuplicates(positions: BrokerPositionSummary[]): CrossBrokerDuplicate[] {
    const bySymbol = new Map<string, BrokerPositionSummary[]>();
    for (const pos of positions) {
      const existing = bySymbol.get(pos.symbol) || [];
      existing.push(pos);
      bySymbol.set(pos.symbol, existing);
    }

    const duplicates: CrossBrokerDuplicate[] = [];
    for (const [symbol, posList] of bySymbol) {
      const brokers = [...new Set(posList.map((p) => p.brokerId))];
      if (brokers.length > 1) {
        duplicates.push({
          symbol,
          brokers,
          totalQuantity: posList.reduce((s, p) => s + p.quantity, 0),
          totalValue: posList.reduce((s, p) => s + p.marketValue, 0),
          positions: posList,
        });
      }
    }
    return duplicates;
  }

  // ── Global Exposure ─────────────────────────────────

  /**
   * Calculate how much of the total portfolio is in each symbol,
   * aggregating across all brokers.
   */
  calculateGlobalExposure(
    positions: BrokerPositionSummary[],
    totalValue: number,
  ): GlobalExposure[] {
    if (totalValue <= 0) return [];

    const bySymbol = new Map<string, BrokerPositionSummary[]>();
    for (const pos of positions) {
      const existing = bySymbol.get(pos.symbol) || [];
      existing.push(pos);
      bySymbol.set(pos.symbol, existing);
    }

    const exposures: GlobalExposure[] = [];
    for (const [symbol, posList] of bySymbol) {
      const totalSymbolValue = posList.reduce((s, p) => s + p.marketValue, 0);
      exposures.push({
        symbol,
        totalValue: totalSymbolValue,
        totalValueGbp: totalSymbolValue, // simplified — would need FX conversion
        pctOfPortfolio: (totalSymbolValue / totalValue) * 100,
        brokerBreakdown: posList.map((p) => ({
          brokerId: p.brokerId,
          value: p.marketValue,
          quantity: p.quantity,
        })),
      });
    }

    return exposures.sort((a, b) => b.pctOfPortfolio - a.pctOfPortfolio);
  }

  // ── Broker Breakdown ────────────────────────────────

  calculateBrokerBreakdown(positions: BrokerPositionSummary[]): DiversificationSummary['brokerBreakdown'] {
    const byBroker = new Map<string, { totalValue: number; count: number; currency: string }>();
    const brokerNames: Record<string, string> = {
      mt5: 'MT5',
      trading212: 'Trading212',
      isa: 'Stocks ISA',
    };

    for (const pos of positions) {
      const existing = byBroker.get(pos.brokerId) || {
        totalValue: 0, count: 0, currency: pos.currency,
      };
      existing.totalValue += pos.marketValue;
      existing.count++;
      byBroker.set(pos.brokerId, existing);
    }

    const grandTotal = [...byBroker.values()].reduce((s, b) => s + b.totalValue, 0);

    return [...byBroker.entries()].map(([brokerId, data]) => ({
      brokerId,
      brokerName: brokerNames[brokerId] || brokerId,
      totalValue: data.totalValue,
      currency: data.currency,
      positionCount: data.count,
      allocationPct: grandTotal > 0 ? (data.totalValue / grandTotal) * 100 : 0,
    }));
  }

  // ── Full Summary ────────────────────────────────────

  async getDiversificationSummary(): Promise<DiversificationSummary> {
    const settings = await this.getSettings();
    const { live: positions, cached } = await this.loadPositionRows();

    const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
    const crossBrokerDuplicates = this.findCrossBrokerDuplicates(positions);
    const globalExposures = this.calculateGlobalExposure(positions, totalValue);
    const brokerBreakdown = this.calculateBrokerBreakdown(positions);

    const warnings: string[] = [];

    // Check settings-driven warnings
    const mode = settings['diversification.mode'] || 'warn';
    if (mode !== 'off' && crossBrokerDuplicates.length > 0) {
      warnings.push(
        `${crossBrokerDuplicates.length} symbol(s) held across multiple brokers: ${crossBrokerDuplicates.map((d) => d.symbol).join(', ')}`,
      );
    }

    const maxExposure = parseFloat(settings['diversification.maxGlobalExposurePct'] || '25');
    for (const exp of globalExposures) {
      if (exp.pctOfPortfolio > maxExposure) {
        warnings.push(
          `${exp.symbol} represents ${exp.pctOfPortfolio.toFixed(1)}% of portfolio (limit: ${maxExposure}%)`,
        );
      }
    }

    return {
      totalPortfolioValue: totalValue,
      totalPortfolioValueGbp: totalValue,
      brokerBreakdown,
      crossBrokerDuplicates,
      globalExposures,
      settings,
      cachedImportPositions: this.cachedImportBlock(cached),
      warnings,
    };
  }

  // ── Pre-Trade Check ─────────────────────────────────

  /**
   * Check if opening a position for `symbol` on `targetBroker` would
   * violate global diversification rules.
   *
   * Called by the automation loop BEFORE executing any trade.
   */
  async checkPreTrade(
    symbol: string,
    targetBroker: string,
  ): Promise<PreTradeCheckResult> {
    const settings = await this.getSettings();
    const mode = settings['diversification.mode'] || 'warn';

    // If diversification is off, always allow
    if (mode === 'off') {
      return { allowed: true, blocked: false, severity: 'info' };
    }

    // ⚠️ LIVE rows only — a cached import row must never gate a live trade (#778).
    const positions = await this.getAllPositions();

    // Find existing positions for this symbol
    const symbolPositions = positions.filter(
      (p) => p.symbol.toUpperCase() === symbol.toUpperCase(),
    );

    // Check if symbol is already held on a DIFFERENT broker
    const otherBrokerPositions = symbolPositions.filter(
      (p) => p.brokerId !== targetBroker,
    );

    if (otherBrokerPositions.length > 0) {
      const duplicate: CrossBrokerDuplicate = {
        symbol: symbol.toUpperCase(),
        brokers: [...new Set(otherBrokerPositions.map((p) => p.brokerId))],
        totalQuantity: otherBrokerPositions.reduce((s, p) => s + p.quantity, 0),
        totalValue: otherBrokerPositions.reduce((s, p) => s + p.marketValue, 0),
        positions: otherBrokerPositions,
      };

      if (mode === 'strict') {
        return {
          allowed: false,
          blocked: true,
          reason: `${symbol} is already held on ${duplicate.brokers.join(', ')}. Cross-broker duplicates are blocked (strict mode).`,
          severity: 'block',
          existingPositions: duplicate,
        };
      }

      // 'warn' mode — allowed but flagged
      return {
        allowed: true,
        blocked: false,
        reason: `${symbol} is already held on ${duplicate.brokers.join(', ')}. Diversification reduced.`,
        severity: 'warn',
        existingPositions: duplicate,
      };
    }

    // Check global exposure limit
    const totalValue = positions.reduce((s, p) => s + p.marketValue, 0);
    const existingExposure = symbolPositions.reduce((s, p) => s + p.marketValue, 0);
    const maxExposurePct = parseFloat(settings['diversification.maxGlobalExposurePct'] || '25');
    const currentPct = totalValue > 0 ? (existingExposure / totalValue) * 100 : 0;

    if (currentPct >= maxExposurePct) {
      if (mode === 'strict') {
        return {
          allowed: false,
          blocked: true,
          reason: `${symbol} already at ${currentPct.toFixed(1)}% of portfolio (limit: ${maxExposurePct}%).`,
          severity: 'block',
          globalExposure: {
            symbol: symbol.toUpperCase(),
            totalValue: existingExposure,
            totalValueGbp: existingExposure,
            pctOfPortfolio: currentPct,
            brokerBreakdown: symbolPositions.map((p) => ({
              brokerId: p.brokerId,
              value: p.marketValue,
              quantity: p.quantity,
            })),
          },
        };
      }
      return {
        allowed: true,
        blocked: false,
        reason: `${symbol} already at ${currentPct.toFixed(1)}% of portfolio — consider reducing exposure.`,
        severity: 'warn',
      };
    }

    return { allowed: true, blocked: false, severity: 'info' };
  }
}
