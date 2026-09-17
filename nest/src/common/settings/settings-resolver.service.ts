import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  RUNTIME_SETTINGS,
  SETTINGS_BY_KEY,
  SettingDefinition,
  parseStoredSetting,
  validateSetting,
  isSettingFailure,
} from './settings-registry';
import {
  EnsureSettingsReport,
  asSeederPrisma,
  ensureDeclaredSettings,
} from './settings-seeder';

/**
 * SettingsResolverService — the ONE read path for a declared setting (#849).
 *
 * STEP IN THE PIPELINE: this sits under every caller that needs a setting value. Callers ask for a
 * KEY, never for a table. That indirection is the point — before this, four call sites read
 * `process.env.MT5_MAX_*` directly, two more read it again for a settings endpoint, and a UI control
 * wrote to a fourth store that nothing read. A value with four readers has four ways to disagree.
 *
 * WHY IT IS NOT A CACHE
 * ---------------------
 * A cache would reintroduce the problem in a new form: a value read once and trusted afterwards is
 * exactly how `.env` behaved (it needed a restart). These are read per call — a `global_setting` row
 * lookup is a primary-key hit, and correctness is worth more than a microsecond here.
 *
 * 🛑 THE ONE RULE THAT MAKES `ensureDefaults()` SAFE
 * --------------------------------------------------
 * It uses **`create`**, and it must NEVER use `upsert` with the declared default in `update`.
 *
 * The reason is not stylistic. Nothing writes a setting row until a user changes it, so the rows that
 * exist are precisely the ones a human deliberately set. An `upsert`-based seeder would therefore
 * OVERWRITE deliberate user choices with defaults on the next restart, silently — and it would look
 * like it was doing the right thing. `create`-if-missing cannot do that by construction, which is why
 * the guard is the choice of verb rather than a conditional someone can later remove.
 *
 * (This is the same choice `settings.service.ts` already makes for `appsetting`: `findUnique` then
 * `create`, with the explicit log line "already exist — skipping".)
 *
 * TWO VERBS, DELIBERATELY NOT ONE
 * -------------------------------
 *   - `ensureDefaults()`  — seed-on-install. Materialises EVERY declared default. Trigger: install/first boot.
 *   - `resolve()`         — the read path. Absent is normal and correct; the default is the value.
 * Conflating them produces a system that re-seeds on every boot.
 */

/** Where the value in hand actually came from. `invalid` is a distinct state, not a default. */
export type SettingSource = 'db' | 'default' | 'invalid';

export interface ResolvedSetting {
  key: string;
  label: string;
  value: number | boolean | string;
  /** `db` = a row exists; `default` = absent, declared default applies; `invalid` = row exists but is unusable. */
  source: SettingSource;
  /** The raw column contents, kept so a bad value can be inspected rather than guessed at. */
  storedValue?: string;
  /** Present only when `source === 'invalid'` — says WHY, rather than silently defaulting. */
  error?: string;
  userChangeable: boolean;
  owner: string;
  migratedFrom?: string;
}

/**
 * The ensure result. The SHAPE lives in settings-seeder.ts, because `nest/prisma/seed.ts` produces one
 * too — one definition, so the install path and the boot path cannot come to describe different things.
 */
export type EnsureReport = EnsureSettingsReport;

@Injectable()
export class SettingsResolverService implements OnModuleInit {
  private readonly logger = new Logger(SettingsResolverService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Seed-on-install, and repair-on-boot.
   *
   * Runs at EVERY boot because it is idempotent and create-only: the cost is one SELECT, plus a handful
   * of INSERTs on a fresh or partially-restored database. That is deliberate — an install that skipped
   * the seed script should still end up with a complete set of declared settings, and a row lost to a
   * partial restore should come back on the next start instead of remaining missing until somebody
   * notices a number is sitting at its default.
   *
   * ⚠️ A failure here must NOT stop the API booting. Every declared setting has a default, so an
   * unseeded database is still a working system — refusing to start over it would turn a cosmetic gap
   * into an outage. Hence the catch: log, continue.
   */
  async onModuleInit(): Promise<void> {
    try {
      const report = await this.ensureDefaults();
      for (const key of report.created) {
        this.logger.log(
          `setting "${key}" seeded at its declared default (no row existed)`,
        );
      }
      for (const e of report.errors) {
        this.logger.warn(`setting seed problem (${e.key}): ${e.reason}`);
      }
    } catch (err) {
      this.logger.error(
        `setting seed-on-boot failed (continuing unchanged): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Resolve one declared setting.
   *
   * ⚠️ ABSENT IS NOT EMPTY. A missing row returns the declared default with `source: 'default'`, so a
   * caller (and the UI) can tell "nobody has set this" from "someone set it to the default value".
   * Collapsing those two is the same defect as rendering `[]` and a failed query identically.
   *
   * ⚠️ AN UNREADABLE ROW IS NOT A DEFAULT. If the column holds something the declaration cannot parse,
   * the result is `source: 'invalid'` carrying the reason — never a silent fallback, because a risk
   * limit that quietly becomes its default is a number nobody chose.
   */
  async resolve(key: string): Promise<ResolvedSetting> {
    const def = SETTINGS_BY_KEY.get(key);
    if (!def) {
      throw new Error(
        `setting "${key}" is not declared in settings-registry.ts. ` +
          `Declare it (with a verified default) before reading it — an undeclared read is how a ` +
          `setting ends up in a store with no owner.`,
      );
    }

    let stored: string | null = null;
    let readFailed: string | null = null;
    try {
      if (this.prisma.isAvailable) {
        const row = await this.prisma.globalSetting.findUnique({
          where: { key },
        });
        stored = row?.value ?? null;
      }
    } catch (err) {
      // The DB being unreachable is not the same as the setting being absent, but it is also not a
      // reason to refuse to trade. We report the fallback honestly and let the caller decide.
      readFailed = (err as Error).message;
      this.logger.warn(
        `setting "${key}" could not be read from the DB: ${readFailed}`,
      );
    }

    if (stored === null) {
      return this.asDefault(def, readFailed ?? undefined);
    }

    const parsed = parseStoredSetting(def, stored);
    if (isSettingFailure(parsed)) {
      this.logger.error(
        `setting "${key}" holds an unusable value (${JSON.stringify(stored)}): ${parsed.reason}. ` +
          `Falling back to the declared default ${JSON.stringify(def.defaultValue)} — fix the row.`,
      );
      return {
        ...this.asDefault(def),
        source: 'invalid',
        storedValue: stored,
        error: parsed.reason,
      };
    }

    return {
      key: def.key,
      label: def.label,
      value: parsed.value,
      source: 'db',
      storedValue: stored,
      userChangeable: def.userChangeable,
      owner: def.owner,
      migratedFrom: def.migratedFrom,
    };
  }

  /**
   * Convenience read for call sites that only want the value.
   *
   * Deliberately returns just the value: a caller that has to branch on `source` is usually a caller
   * that should be showing it to someone (use `resolve()` for that).
   */
  async get<T extends number | boolean | string>(key: string): Promise<T> {
    const resolved = await this.resolve(key);
    return resolved.value as T;
  }

  /** Every declared runtime setting, with its effective value and where that value came from. */
  async getAll(): Promise<ResolvedSetting[]> {
    return Promise.all(RUNTIME_SETTINGS.map((def) => this.resolve(def.key)));
  }

  /**
   * Seed-on-install: materialise every declared default that has no row.
   *
   * `dryRun: true` reports what it WOULD create and changes nothing. That exists so a repair can be
   * told apart from a regression: run it dry first and the answer is a list, not a mutation.
   *
   * Idempotent, and safe to run at every boot — which is the intended usage.
   */
  async ensureDefaults(
    opts: { dryRun?: boolean; keys?: string[] } = {},
  ): Promise<EnsureReport> {
    // Refuse explicitly when the DB is unreachable. `ensureDeclaredSettings` reaches the same
    // conclusion, but stating it here means the reason is a named cause at the call site rather than
    // something a caller has to infer from an empty report.
    if (!this.prisma.isAvailable) {
      return {
        dryRun: opts.dryRun === true,
        checked: [],
        existing: [],
        created: [],
        wouldCreate: [],
        errors: [
          {
            key: '*',
            reason:
              'database unavailable — nothing was checked and nothing was created',
          },
        ],
      };
    }

    // No logging here: every caller already reports the outcome (onModuleInit at boot, the seeder
    // during install, the controller on demand). Logging in both places would print each seeded key
    // twice in the boot log, which makes a real duplicate harder to spot.
    return ensureDeclaredSettings(asSeederPrisma(this.prisma), opts);
  }

  /**
   * How many `global_setting` keys exist that this registry does not declare.
   *
   * This is the live measure for the #849 inventory: it turns "we think there are ~459 keys" into a
   * number that moves as keys are declared. It reports the count and a sample rather than the full
   * list, so it stays cheap and readable.
   */
  async undeclaredKeys(
    limit = 25,
  ): Promise<{ count: number; sample: string[] }> {
    try {
      if (!this.prisma.isAvailable) return { count: 0, sample: [] };
      const declared = [...SETTINGS_BY_KEY.keys()];
      const [count, rows] = await Promise.all([
        this.prisma.globalSetting.count({
          where: { key: { notIn: declared } },
        }),
        this.prisma.globalSetting.findMany({
          where: { key: { notIn: declared } },
          select: { key: true },
          orderBy: { key: 'asc' },
          take: limit,
        }),
      ]);
      return { count, sample: rows.map((r) => r.key) };
    } catch (err) {
      this.logger.warn(
        `undeclared-key count failed: ${(err as Error).message}`,
      );
      return { count: 0, sample: [] };
    }
  }

  /**
   * Set one declared setting. The ONLY write path for a declared runtime setting.
   *
   * ⚠️ `upsert` is correct HERE and only here. The verb is not the safety property — the CONTEXT is:
   * a write with a value a human or an API caller supplied is a deliberate act, so replacing the row is
   * the intended behaviour. The dangerous verb is an upsert driven by a DECLARED DEFAULT, which is why
   * `ensureDefaults()` uses `create`. Keeping the distinction in the two method bodies is what makes it
   * reviewable: "create = seeding, upsert = someone asked for this".
   *
   * Secrets are refused outright: they belong in `.env`, and a settings endpoint that can write to them
   * would be a route to persisting a credential in the database.
   */
  async set(key: string, raw: unknown): Promise<ResolvedSetting> {
    const def = SETTINGS_BY_KEY.get(key);
    if (!def) {
      throw new Error(
        `setting "${key}" is not declared in settings-registry.ts — declare it before writing it.`,
      );
    }
    if (def.class === 'secret') {
      throw new Error(
        `setting "${key}" is class 'secret' and lives in .env. It cannot be written through the API.`,
      );
    }
    if (def.class === 'per-user') {
      throw new Error(
        `setting "${key}" is per-user and belongs to userpreferences, not the global store.`,
      );
    }

    const parsed = validateSetting(def, raw);
    if (isSettingFailure(parsed)) {
      // Rejected, not coerced. See the validation contract in settings-registry.ts.
      throw new Error(`invalid value for "${key}": ${parsed.reason}`);
    }

    await this.prisma.globalSetting.upsert({
      where: { key },
      update: { value: String(parsed.value) },
      create: { key, value: String(parsed.value) },
    });

    return this.resolve(key);
  }

  private asDefault(def: SettingDefinition, note?: string): ResolvedSetting {
    return {
      key: def.key,
      label: def.label,
      value: def.defaultValue,
      source: 'default',
      ...(note ? { error: note } : {}),
      userChangeable: def.userChangeable,
      owner: def.owner,
      migratedFrom: def.migratedFrom,
    };
  }
}
