import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
/**
 * UiScore — the owner's 1–10 verdict on how good a page's UI is (added 2026-10-06).
 *
 * ⚠️ WHY THIS IS A NEW FIELD AND NOT A WIDER `keen`. The store already held 80 entries with
 * `keen ∈ {1,2,3}`, where 3 meant "very keen" — the owner's ENTHUSIASM FOR THE PAGE, not the quality
 * of its UI. Widening that key to 1–10 would have re-rendered 27 stored "Very keen (3)" verdicts as
 * **3/10**: a confident rating of a UI that nobody rated. Different question, different scale, so
 * different key — and the old values are left exactly as they were rather than migrated by guesswork.
 */
export type UiScore = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface UiReviewEntry {
  importance: 'H' | 'M' | 'L' | null;
  hide: boolean | null;
  /**
   * ⚠️ LEGACY — superseded by `uiScore` on 2026-10-06. No longer written and no longer rendered.
   * Kept in the type because the stored JSON still carries it, and an untyped dangling field is one
   * somebody re-interprets later by guessing. Meaning: "how keen was the owner on this page", on a
   * **1–3** scale. It is NOT a UI score and must never be read as one.
   */
  keen: 1 | 2 | 3 | null;
  /** 1–10 UI-quality rating. `null` = not rated yet, which is NOT the same as a low score. */
  uiScore: UiScore | null;
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
    // ⚠️ VALIDATED HERE BECAUSE A TYPE IS NOT ENFORCED AT RUNTIME. `UiScore` is a compile-time union;
    // the PUT body arrives as JSON. `unknown` forces these checks to be real rather than a formality
    // the compiler optimises away. Rejecting beats clamping: a clamp would record a rating nobody
    // gave, and the owner would read it as their own verdict — the "plausible output, no error"
    // shape this repo keeps paying for.
    const rawUiScore: unknown = (patch as { uiScore?: unknown }).uiScore;
    if (rawUiScore !== undefined && rawUiScore !== null) {
      if (
        typeof rawUiScore !== 'number' ||
        !Number.isInteger(rawUiScore) ||
        rawUiScore < 1 ||
        rawUiScore > 10
      ) {
        throw new BadRequestException(
          `uiScore must be a whole number 1–10, or null to clear it (received ${JSON.stringify(rawUiScore)})`,
        );
      }
    }
    const settings = await this.get();
    const uiReview: UiReviewConfig = settings.uiReview || { entries: {} };
    const previous: UiReviewEntry = uiReview.entries[viewKey] || {
      importance: null,
      hide: null,
      keen: null,
      uiScore: null,
      note: '',
      updatedAt: '',
    };
    const entry: UiReviewEntry = { ...previous, ...patch, updatedAt: new Date().toISOString() };
    uiReview.entries[viewKey] = entry;
    await this.update({ uiReview });
    return entry;
  }

  /**
   * deleteUiReviewEntry() — remove ONE page's verdict, or every verdict when no key is given.
   *
   * ⚠️ #1040 — THIS EXISTS BECAUSE THE STORE WAS WRITE-ONLY PER KEY. A verdict could be written and
   * overwritten but never removed, so a key created by mistake was permanent. That is not
   * hypothetical: the round-trip verification of this feature used the key `__selftest__`, and it is
   * still in `app-settings.json` today. A write-only store has no way to correct its own history,
   * which is a worse defect than the stray key it produced.
   *
   * ⚠️ An absent key is NOT an error and does NOT throw: deleting something that is already gone has
   * the outcome the caller wanted. `removed` reports which keys were ACTUALLY deleted, so a caller
   * can tell "it was there and is now gone" from "there was nothing there" — the same rule as the rest
   * of this repo, that a no-op and a success must not be indistinguishable when the caller cares.
   */
  async deleteUiReviewEntry(viewKey?: string): Promise<{ removed: string[] }> {
    const settings = await this.get();
    const uiReview: UiReviewConfig = settings.uiReview || { entries: {} };
    const removed: string[] = [];

    if (viewKey) {
      // ⚠️ `hasOwnProperty`, not a truthiness test: an entry is always an object, but a prototype
      // key like `constructor` would pass `in` and then delete nothing while reporting success.
      if (Object.prototype.hasOwnProperty.call(uiReview.entries, viewKey)) {
        delete uiReview.entries[viewKey];
        removed.push(viewKey);
      }
    } else {
      removed.push(...Object.keys(uiReview.entries));
      uiReview.entries = {};
    }

    if (removed.length === 0) return { removed };

    // ⚠️⚠️ THIS MUST NOT GO THROUGH `update()`. `update()` does `deepMerge(current, partial)`, and a
    // MERGE CANNOT REMOVE A KEY: the deleted key is still present in `current`, so the merge puts it
    // straight back. Measured 2026-10-01 — the first version of this method called `update()` and
    // reported `removed: ['__selftest__']` while the key REMAINED in the store. A silent no-op
    // wearing a success message, which is the worst kind: the caller has no reason to look again.
    //
    // So the delete writes the WHOLE settings object directly, bypassing the merge. This is the same
    // trap the seeder rules already record — "an upsert-only seeder cannot delete" — reached here
    // through a different door. Any path that REMOVES must not reuse a mechanism built only to ADD.
    const next: AppSettings = { ...settings, uiReview: { entries: uiReview.entries } };
    await this.saveToDb(next);
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(next, null, 2));
    } catch {
      // The DB write is the authority; the file is the agent-readable mirror. A mirror failure is
      // not a reason to report the delete as failed when the store itself changed.
    }
    this.logger.log(
      `UI review cleared: ${removed.length} key(s) — ${removed.slice(0, 3).join(', ')}${removed.length > 3 ? ` (+${removed.length - 3} more)` : ''}`,
    );
    return { removed };
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
