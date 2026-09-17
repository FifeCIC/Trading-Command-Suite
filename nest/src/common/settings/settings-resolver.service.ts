import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  RUNTIME_SETTINGS,
  SETTINGS_BY_KEY,
  SettingDefinition,
  parseStoredSetting,
  validateSetting,
  isSettingFailure,
  matchFamily,
  validateFamilyValue,
  SETTING_FAMILIES,
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

/**
 * A resolved KEY-FAMILY member.
 *
 * ⚠️ `source: 'absent'` is a THIRD state, and it is not the same as a default. A declared setting with no
 * row falls back to its declared default; a family member has no default, so "absent" means *the reader's
 * own fallback applies* — e.g. a directive code default, or the fail-closed `disabled` for a broker.
 * Collapsing that into a value here would fabricate a reading.
 */
export interface ResolvedFamilySetting {
  key: string;
  family: string;
  subject: string;
  field: string;
  /** Whether a row exists. `false` means the owner's own fallback is in force. */
  present: boolean;
  value?: number | boolean | string;
  source: 'db' | 'absent' | 'invalid';
  storedValue?: string;
  error?: string;
  owner: string;
  userChangeable: boolean;
}

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
      const family = matchFamily(key);
      if (family) {
        throw new Error(
          `"${key}" belongs to the "${family.family.id}" key family, which has NO declared default. ` +
            `Use resolveFamily() — it reports whether a row exists and validates it, and leaves the ` +
            `fallback to the code that owns the behaviour. This method cannot answer, and returning a ` +
            `made-up value here is how a fabricated reading enters the pipeline.`,
        );
      }
      throw new Error(
        `setting "${key}" is not declared in settings-registry.ts and matches no family. ` +
          `Declare it (with a verified default) before reading it, or add a family if its shape is ` +
          `open-ended — an undeclared read is how a setting ends up in a store with no owner.`,
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
   * Read a KEY-FAMILY member: does a row exist, and is it valid?
   *
   * ⚠️ DELIBERATELY DOES NOT SUPPLY A FALLBACK. A family member has no declared default, so when no row
   * exists the honest answer is "absent" — the decision about what that MEANS belongs to the code that
   * owns the behaviour. The alternative (return the reader's current fallback as if it were the value)
   * would hide the difference between "configured" and "defaulted", which is the distinction the
   * registry exists to make.
   */
  async resolveFamily(key: string): Promise<ResolvedFamilySetting> {
    const match = matchFamily(key);
    if (!match) {
      throw new Error(
        `"${key}" matches no declared key family. Families are declared in settings-registry.ts.`,
      );
    }
    const { family, subject, field } = match;
    const fieldDef = family.fields[field];
    const base = {
      key,
      family: family.id,
      subject,
      field,
      owner: family.owner,
      userChangeable: fieldDef.userChangeable,
    };

    let stored: string | null = null;
    try {
      if (this.prisma.isAvailable) {
        const row = await this.prisma.globalSetting.findUnique({
          where: { key },
        });
        stored = row?.value ?? null;
      }
    } catch (err) {
      this.logger.warn(
        `family key "${key}" could not be read: ${(err as Error).message}`,
      );
    }

    if (stored === null) return { ...base, present: false, source: 'absent' };

    const parsed = validateFamilyValue(fieldDef, stored);
    if (isSettingFailure(parsed)) {
      this.logger.error(
        `family key "${key}" holds an unusable value (${JSON.stringify(stored)}): ${parsed.reason}`,
      );
      return {
        ...base,
        present: true,
        source: 'invalid',
        storedValue: stored,
        error: parsed.reason,
      };
    }
    return {
      ...base,
      present: true,
      source: 'db',
      value: parsed.value,
      storedValue: stored,
    };
  }

  /**
   * listFamily() — every STORED member of a family, validated.
   *
   * WHY BULK: `directive-config.service.ts` reads all ~442 directive keys in one query. Routing that
   * through `resolveFamily()` would be 442 round-trips, and an access path that is 442x slower is one
   * that gets bypassed — which is exactly how the raw access this migration removes would come back.
   *
   * ⚠️ THREE OUTCOMES, DELIBERATELY DISTINCT (the rule this module keeps enforcing):
   *   - `members: []`, no error        → there genuinely are no rows
   *   - `members: [...]` with `invalid > 0` → rows exist but some cannot be parsed; each carries `error`
   *   - `error` set                    → the query FAILED. This is not "no rows", and a caller that
   *     treats it as one would silently fall back to code defaults while the table still holds data.
   *
   * ⚠️ An invalid member is RETURNED, not dropped. Dropping it would make an unreadable weight look like
   * an absent one, and the broken row would stay in the table unseen.
   */
  async listFamily(
    familyId: string,
    subject?: string,
  ): Promise<{
    members: ResolvedFamilySetting[];
    invalid: number;
    error?: string;
  }> {
    const family = SETTING_FAMILIES.find((f) => f.id === familyId);
    if (!family) {
      throw new Error(
        `no family "${familyId}" is declared in settings-registry.ts`,
      );
    }

    // The subject is followed by ':' only when a field follows it. Derived from the declaration rather
    // than a separate lookup table, so a new family cannot get this subtly wrong.
    const prefix = subject
      ? family.fieldGroup === 0
        ? `${family.prefix}${subject}`
        : `${family.prefix}${subject}:`
      : family.prefix;

    let rows: Array<{ key: string; value: string }>;
    try {
      if (!this.prisma.isAvailable) {
        return {
          members: [],
          invalid: 0,
          error: 'database unavailable — nothing was read',
        };
      }
      rows = await this.prisma.globalSetting.findMany({
        where: { key: { startsWith: prefix } },
        select: { key: true, value: true },
      });
    } catch (err) {
      this.logger.warn(
        `family "${familyId}" bulk read failed: ${(err as Error).message}`,
      );
      return { members: [], invalid: 0, error: (err as Error).message };
    }

    const members: ResolvedFamilySetting[] = [];
    let invalid = 0;
    for (const row of rows) {
      const match = matchFamily(row.key);
      // A row under the prefix that the pattern does not accept (e.g. an extra segment) is reported
      // rather than skipped: it is a key the family claims by prefix but cannot describe.
      if (!match || match.family.id !== familyId) {
        invalid += 1;
        members.push({
          key: row.key,
          family: familyId,
          subject: subject ?? '',
          field: '',
          present: true,
          source: 'invalid',
          storedValue: row.value,
          error:
            'key sits under the family prefix but does not match its pattern',
          owner: family.owner,
          userChangeable: false,
        });
        continue;
      }
      const parsed = validateFamilyValue(family.fields[match.field], row.value);
      if (isSettingFailure(parsed)) {
        invalid += 1;
        members.push({
          key: row.key,
          family: familyId,
          subject: match.subject,
          field: match.field,
          present: true,
          source: 'invalid',
          storedValue: row.value,
          error: parsed.reason,
          owner: family.owner,
          userChangeable: family.fields[match.field].userChangeable,
        });
        continue;
      }
      members.push({
        key: row.key,
        family: familyId,
        subject: match.subject,
        field: match.field,
        present: true,
        source: 'db',
        value: parsed.value,
        storedValue: row.value,
        owner: family.owner,
        userChangeable: family.fields[match.field].userChangeable,
      });
    }

    if (invalid > 0) {
      this.logger.warn(
        `family "${familyId}" (prefix ${prefix}) has ${invalid} unusable member(s) — they are reported, not skipped`,
      );
    }
    return { members, invalid };
  }

  /**
   * clearFamily() — delete every stored member of a family, optionally narrowed to one subject.
   *
   * WHY IT LIVES HERE: a delete is a write, and the ownership rule applies to writes as much as reads. A
   * caller holding its own `startsWith(prefix)` string is a second place that knows the key shape — and
   * the shape is exactly what drifts when two places know it.
   *
   * 🛑 DESTRUCTIVE, AND GUARDED. Clearing a whole family requires `allowAll: true` explicitly, because
   * `clearFamily('directive')` with a mistyped subject would silently delete every directive override in
   * the system. Having to pass the flag deliberately is the difference between a bulk delete and an
   * accident.
   */
  async clearFamily(
    familyId: string,
    subject?: string,
    opts: { allowAll?: boolean } = {},
  ): Promise<{ keyPattern: string; deleted: number }> {
    const family = SETTING_FAMILIES.find((f) => f.id === familyId);
    if (!family) {
      throw new Error(
        `no family "${familyId}" is declared in settings-registry.ts`,
      );
    }
    if (!subject && !opts.allowAll) {
      throw new Error(
        `clearFamily("${familyId}") without a subject would delete EVERY member of the family. ` +
          `Pass a subject, or { allowAll: true } if that really is what you mean.`,
      );
    }

    // Same derivation as listFamily(), so a bulk delete and a bulk read cannot disagree about which keys
    // belong to a subject.
    const prefix = subject
      ? family.fieldGroup === 0
        ? `${family.prefix}${subject}`
        : `${family.prefix}${subject}:`
      : family.prefix;

    const result = await this.prisma.globalSetting.deleteMany({
      where: { key: { startsWith: prefix } },
    });
    const deleted =
      typeof result === 'number'
        ? result
        : ((result as { count?: number })?.count ?? 0);
    this.logger.warn(
      `cleared ${deleted} member(s) of family "${familyId}" (prefix ${prefix})`,
    );
    return { keyPattern: `${prefix}*`, deleted };
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
  ): Promise<{ count: number; sample: string[]; familyMembers: number }> {
    try {
      if (!this.prisma.isAvailable)
        return { count: 0, sample: [], familyMembers: 0 };
      // Fetch every key and classify in JS rather than building a SQL `notIn` over 100+ declarations and
      // family patterns. The table is small (462 rows measured 2026-09-17), and the classification MUST
      // use the same `matchFamily()` the resolver uses — a second, SQL-shaped approximation of "is this
      // declared?" is exactly the two-copies-of-a-rule problem this module exists to remove.
      const rows = await this.prisma.globalSetting.findMany({
        select: { key: true },
        orderBy: { key: 'asc' },
      });
      const undeclared = rows
        .map((r) => r.key)
        .filter((k) => !SETTINGS_BY_KEY.has(k) && !matchFamily(k));
      const declaredPresent = [...SETTINGS_BY_KEY.keys()].filter((k) =>
        rows.some((r) => r.key === k),
      ).length;
      return {
        count: undeclared.length,
        sample: undeclared.slice(0, limit),
        familyMembers: rows.length - undeclared.length - declaredPresent,
      };
    } catch (err) {
      this.logger.warn(
        `undeclared-key count failed: ${(err as Error).message}`,
      );
      return { count: 0, sample: [], familyMembers: 0 };
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
  async set(
    key: string,
    raw: unknown,
  ): Promise<ResolvedSetting | ResolvedFamilySetting> {
    const def = SETTINGS_BY_KEY.get(key);
    if (!def) {
      const family = matchFamily(key);
      if (!family) {
        throw new Error(
          `setting "${key}" is not declared in settings-registry.ts and matches no family — declare it before writing it.`,
        );
      }
      // A family member may be written: unlike READING, there is no ambiguity about what the caller
      // means. The field definition still supplies validation, so a family is not an escape hatch from it.
      const parsedFamily = validateFamilyValue(
        family.family.fields[family.field],
        raw,
      );
      if (isSettingFailure(parsedFamily)) {
        throw new Error(
          `invalid value for "${key}" (family ${family.family.id}, field ${family.field}): ${parsedFamily.reason}`,
        );
      }
      const familyValue = String(parsedFamily.value);
      await this.prisma.globalSetting.upsert({
        where: { key },
        update: { value: familyValue },
        create: { key, value: familyValue },
      });
      return this.resolveFamily(key);
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
