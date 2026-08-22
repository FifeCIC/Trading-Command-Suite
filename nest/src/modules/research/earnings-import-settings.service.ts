/**
 * EarningsImportSettingsService — pickiness controls for the earnings import
 * ========================================================================
 * Stores user settings as JSON under `global_setting` (keys:
 * `earnings_import_settings` / `earnings_import_last`), applies scope /
 * market-cap / session filters "as best each source supports", and tracks
 * the last import run for the status endpoint.
 *
 * Filters:
 *  - scope:        'all' | 'watchlist' | 'portfolio' — symbol universe
 *  - minMarketCap: USD floor; applied only to events that CARRY a market cap
 *                  (Nasdaq does, Finnhub doesn't). Events with unknown cap
 *                  are kept — they cannot be verified either way.
 *  - timeOfDay:    'all' | 'bmo' | 'amc' — session of the report.
 *
 * Never throws — DB rows are read with try/catch, defaults win on failure.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EarningsEvent } from '../providers/interfaces/provider-adapter.interface';

export interface EarningsImportSettings {
  autoImportEnabled: boolean;
  horizonMonths: number;
  scope: 'all' | 'watchlist' | 'portfolio';
  minMarketCap: number; // USD, 0 = off
  timeOfDay: 'all' | 'bmo' | 'amc';
  sources: string[]; // preferred order
}

export const DEFAULT_EARNINGS_IMPORT_SETTINGS: EarningsImportSettings = {
  autoImportEnabled: true,
  horizonMonths: 3,
  scope: 'all',
  minMarketCap: 0,
  timeOfDay: 'all',
  sources: ['finnhub', 'nasdaq'],
};

const SETTINGS_KEY = 'earnings_import_settings';
const LAST_IMPORT_KEY = 'earnings_import_last';
const KNOWN_SOURCES = ['finnhub', 'nasdaq'];

export interface FilterStats {
  droppedScope: number;
  droppedSession: number;
  droppedMarketCap: number;
}

@Injectable()
export class EarningsImportSettingsService {
  private readonly logger = new Logger(EarningsImportSettingsService.name);
  private running = false;
  private runningSince: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getSettings(): Promise<EarningsImportSettings> {
    try {
      const row = await this.prisma.globalSetting.findUnique({
        where: { key: SETTINGS_KEY },
      });
      if (row?.value) {
        const parsed = JSON.parse(row.value);
        return {
          ...DEFAULT_EARNINGS_IMPORT_SETTINGS,
          ...parsed,
          // clamp the loose fields
          horizonMonths: Math.min(12, Math.max(1, Number(parsed.horizonMonths) || 3)),
          minMarketCap: Math.max(0, Number(parsed.minMarketCap) || 0),
          sources: Array.isArray(parsed.sources)
            ? parsed.sources.filter((s: string) => KNOWN_SOURCES.includes(s))
            : DEFAULT_EARNINGS_IMPORT_SETTINGS.sources,
        };
      }
    } catch (err) {
      this.logger.warn(`Failed to read earnings import settings: ${(err as Error).message}`);
    }
    return { ...DEFAULT_EARNINGS_IMPORT_SETTINGS };
  }

  async updateSettings(patch: Partial<EarningsImportSettings>): Promise<EarningsImportSettings> {
    const current = await this.getSettings();
    const next: EarningsImportSettings = {
      ...current,
      ...patch,
      horizonMonths: Math.min(12, Math.max(1, Math.round(Number(patch.horizonMonths ?? current.horizonMonths)) || 3)),
      minMarketCap: Math.max(0, Number(patch.minMarketCap ?? current.minMarketCap) || 0),
      sources: Array.isArray(patch.sources) && patch.sources.length
        ? patch.sources.filter((s) => KNOWN_SOURCES.includes(s))
        : current.sources,
    };

    await this.prisma.globalSetting.upsert({
      where: { key: SETTINGS_KEY },
      update: { value: JSON.stringify(next) },
      create: { key: SETTINGS_KEY, value: JSON.stringify(next) },
    });
    this.logger.log(
      `Earnings import settings updated: scope=${next.scope}, minCap=${next.minMarketCap}, session=${next.timeOfDay}, auto=${next.autoImportEnabled}, horizon=${next.horizonMonths}m`,
    );
    return next;
  }

  /** Resolve the symbol universe for the scope. Null = no restriction. */
  async loadScopeSymbols(scope: EarningsImportSettings['scope']): Promise<Set<string> | null> {
    if (scope === 'all') return null;
    const symbols = new Set<string>();
    try {
      if (scope === 'portfolio') {
        const positions = await this.prisma.position.findMany({
          select: { symbol: true },
          distinct: ['symbol'],
        });
        for (const p of positions) symbols.add(p.symbol.toUpperCase());
      } else {
        // watchlist: union of every named watchlist's symbol JSON + watchlist items
        const lists = await this.prisma.watchlist.findMany({ select: { symbols: true } });
        for (const list of lists) {
          if (Array.isArray(list.symbols)) {
            for (const s of list.symbols) {
              if (typeof s === 'string' && s) symbols.add(s.toUpperCase());
            }
          }
        }
        try {
          const items = await (this.prisma as any).watchlistItem.findMany({
            select: { ticker: true },
          });
          for (const it of items) symbols.add(String(it.ticker).toUpperCase());
        } catch { /* table may not exist yet */ }
      }
    } catch (err) {
      this.logger.warn(`Scope resolution failed for "${scope}": ${(err as Error).message}`);
      return null;
    }
    this.logger.log(`Earnings import scope "${scope}": ${symbols.size} symbols`);
    return symbols;
  }

  /**
   * Apply settings filters to fetched events. Returns kept events + drop stats
   * so the import summary can explain what the filters removed.
   */
  applyFilters(
    events: EarningsEvent[],
    settings: EarningsImportSettings,
    scopeSymbols: Set<string> | null,
  ): { kept: EarningsEvent[]; stats: FilterStats } {
    const stats: FilterStats = { droppedScope: 0, droppedSession: 0, droppedMarketCap: 0 };
    const kept: EarningsEvent[] = [];

    for (const e of events) {
      if (scopeSymbols && !scopeSymbols.has(e.symbol.toUpperCase())) {
        stats.droppedScope++;
        continue;
      }

      if (settings.timeOfDay === 'bmo' && e.timeOfDay !== 'Before Open') {
        stats.droppedSession++;
        continue;
      }
      if (settings.timeOfDay === 'amc' && e.timeOfDay !== 'After Close') {
        stats.droppedSession++;
        continue;
      }

      if (
        settings.minMarketCap > 0 &&
        e.marketCap != null &&
        e.marketCap < settings.minMarketCap
      ) {
        stats.droppedMarketCap++;
        continue;
      }

      kept.push(e);
    }

    return { kept, stats };
  }

  // ── Import run state ──────────────────────────────────────────

  markRunning(): void {
    this.running = true;
    this.runningSince = new Date().toISOString();
  }

  markIdle(): void {
    this.running = false;
    this.runningSince = null;
  }

  getRunState(): { running: boolean; since: string | null } {
    return { running: this.running, since: this.runningSince };
  }

  async recordLastImport(summary: Record<string, unknown>): Promise<void> {
    try {
      await this.prisma.globalSetting.upsert({
        where: { key: LAST_IMPORT_KEY },
        update: { value: JSON.stringify(summary) },
        create: { key: LAST_IMPORT_KEY, value: JSON.stringify(summary) },
      });
    } catch (err) {
      this.logger.warn(`Failed to record earnings import status: ${(err as Error).message}`);
    }
  }

  async getLastImport(): Promise<Record<string, unknown> | null> {
    try {
      const row = await this.prisma.globalSetting.findUnique({
        where: { key: LAST_IMPORT_KEY },
      });
      return row?.value ? JSON.parse(row.value) : null;
    } catch {
      return null;
    }
  }
}
