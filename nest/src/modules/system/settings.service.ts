import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DEFAULT_NEWS_CATEGORY_ALLOWLIST } from '../news/news-taxonomy';
import * as fs from 'fs';
import * as path from 'path';

export interface NewsTierConfig {
  id: string;
  enabled: boolean;
  maxPerDay: number;
  intervalMin: number;
}

export interface NewsImportSettings {
  dailyLimit: number;
  tiers: NewsTierConfig[];
  /** Categories accepted at import time — everything else is never stored.
   *  See news-taxonomy.ts for the category rules and the default list. */
  categoryAllowlist: string[];
  /** Impact floor for stored articles. Default 'low' (no filter) — the
   *  category allowlist does the real work; raising to 'medium'/'high' drops
   *  low-impact items (use carefully: loses neutral-sentiment predictions). */
  minImpact: 'low' | 'medium' | 'high';
}

export interface AppSettings {
  earnings: { importHorizonMonths: number; autoRefreshDays: number };
  correlation: { refreshMinutes: number; warningThreshold: number };
  seasonality: { weightMultiplier: number };
  analyst: { refreshHours: number };
  data: { stalenessHours: number };
  newsImport: NewsImportSettings;
  healthChecks: HealthChecksConfig;
  uiReview: UiReviewConfig;
}

/**
 * UiReviewEntry — the owner's verdict on ONE page, captured while walking the whole app.
 *
 * STEP IN THE PIPELINE: written by `/development/ui-review` on every interaction → stored here →
 * mirrored to `nest/app-settings.json`, which is the copy an agent reads to work from.
 *
 * ⚠️ The three fields are deliberately permissive (`null` = not yet answered). A page with no
 * verdict must be distinguishable from a page judged "low importance" — collapsing "fine" and
 * "cannot judge" into one value is the defect this repo keeps re-finding.
 */
export interface UiReviewEntry {
  importance: 'H' | 'M' | 'L' | null;
  hide: boolean | null;
  keen: 1 | 2 | 3 | null;
  /** Free text — what the owner suggests changing about this page. */
  note: string;
  /** ISO timestamp of the last write, so a stale verdict is visible rather than implied. */
  updatedAt: string;
}

/** Every page's verdict, keyed by its full view path (e.g. `/trading/positions-monitor`). */
export interface UiReviewConfig {
  entries: Record<string, UiReviewEntry>;
}

export interface HealthChecksConfig {
  systemVitals: boolean;
  dbDiagnostics: boolean;
  slowQueries: boolean;
  apiTrends: boolean;
  providerGrid: boolean;
  traceCorrelations: boolean;
  diskInfo: boolean;
  errorRates: boolean;
  cronHeartbeats: boolean;
  portStatus: boolean;
  autoRefreshSec: number;
}

export const NEWS_IMPORT_DEFAULTS: NewsImportSettings = {
  dailyLimit: 100,
  tiers: [
    { id: 'positions', enabled: true, maxPerDay: 30, intervalMin: 120 },
    { id: 'active-protocols', enabled: true, maxPerDay: 20, intervalMin: 240 },
    { id: 'macro', enabled: true, maxPerDay: 15, intervalMin: 360 },
    { id: 'sector', enabled: true, maxPerDay: 15, intervalMin: 360 },
    { id: 'other', enabled: false, maxPerDay: 20, intervalMin: 1440 },
  ],
  categoryAllowlist: [...DEFAULT_NEWS_CATEGORY_ALLOWLIST],
  minImpact: 'low',
};

const DEFAULTS: AppSettings = {
  earnings: { importHorizonMonths: 3, autoRefreshDays: 7 },
  correlation: { refreshMinutes: 360, warningThreshold: 0.7 },
  seasonality: { weightMultiplier: 1.0 },
  analyst: { refreshHours: 24 },
  data: { stalenessHours: 24 },
  newsImport: NEWS_IMPORT_DEFAULTS,
  healthChecks: {
    systemVitals: true,
    dbDiagnostics: true,
    slowQueries: true,
    apiTrends: true,
    providerGrid: true,
    traceCorrelations: true,
    diskInfo: true,
    errorRates: true,
    cronHeartbeats: true,
    portStatus: true,
    autoRefreshSec: 15,
  },
  uiReview: { entries: {} },
};

const SETTING_KEY = 'app';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly filePath = path.join(process.cwd(), 'app-settings.json');

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<AppSettings> {
    try {
      if (this.prisma.isAvailable) {
        const row = await this.prisma.appSetting.findUnique({ where: { id: SETTING_KEY } });
        if (row) return { ...DEFAULTS, ...(row.value as any) };
      }
    } catch (err) {
      this.logger.warn(`DB settings read failed: ${(err as Error).message}`);
    }
    // Fallback: read from legacy JSON file, then migrate to DB
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = { ...DEFAULTS, ...JSON.parse(raw) };
        await this.saveToDb(data).catch(() => {});
        return data;
      }
    } catch {}
    return { ...DEFAULTS };
  }

  async update(partial: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get();
    const merged = this.deepMerge(current, partial);
    await this.saveToDb(merged);
    try { fs.writeFileSync(this.filePath, JSON.stringify(merged, null, 2)); } catch {}
    this.logger.log('Settings updated');
    return merged;
  }

  async reset(): Promise<AppSettings> {
    try { if (this.prisma.isAvailable) await this.prisma.appSetting.delete({ where: { id: SETTING_KEY } }).catch(() => {}); } catch {}
    try { if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath); } catch {}
    return { ...DEFAULTS };
  }

  /** Convenience: get only health check config (cached for fast reads). */
  async getHealthChecks(): Promise<HealthChecksConfig> {
    const settings = await this.get();
    return settings.healthChecks || DEFAULTS.healthChecks;
  }

  /** Convenience: update health check config. */
  async updateHealthChecks(partial: Partial<HealthChecksConfig>): Promise<HealthChecksConfig> {
    const settings = await this.get();
    settings.healthChecks = { ...settings.healthChecks, ...partial };
    await this.update(settings);
    return settings.healthChecks;
  }

  /** Every page verdict so far. Missing keys simply mean "not answered yet". */
  async getUiReview(): Promise<UiReviewConfig> {
    const settings = await this.get();
    return settings.uiReview || { entries: {} };
  }

  /**
   * setUiReviewEntry() — write ONE page's verdict.
   *
   * ⚠️ A PER-ENTRY write, not "send the whole table back". The page saves on every interaction, so
   * posting the entire map each time would (a) let two quick clicks race and silently lose one, and
   * (b) rewrite the whole settings blob on every dropdown change. This merges one key and returns
   * the stored entry, so the client can show what was actually saved rather than assume it.
   *
   * `update()` persists to the `appsetting` row AND mirrors to `nest/app-settings.json` — the file
   * an agent reads. No schema change: the table already exists.
   */
  async setUiReviewEntry(viewKey: string, patch: Partial<UiReviewEntry>): Promise<UiReviewEntry> {
    const settings = await this.get();
    const uiReview: UiReviewConfig = settings.uiReview || { entries: {} };
    const previous: UiReviewEntry = uiReview.entries[viewKey] || {
      importance: null,
      hide: null,
      keen: null,
      note: '',
      updatedAt: '',
    };
    const entry: UiReviewEntry = { ...previous, ...patch, updatedAt: new Date().toISOString() };
    uiReview.entries[viewKey] = entry;
    await this.update({ uiReview });
    return entry;
  }

  private async saveToDb(data: AppSettings): Promise<void> {
    if (!this.prisma.isAvailable) return;
    await this.prisma.appSetting.upsert({
      where: { id: SETTING_KEY },
      update: { value: data as any },
      create: { id: SETTING_KEY, value: data as any },
    });
  }

  private deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result = { ...target };
    for (const key of Object.keys(source) as (keyof T)[]) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] as any, source[key] as any);
      } else if (source[key] !== undefined) {
        result[key] = source[key] as any;
      }
    }
    return result;
  }
}
