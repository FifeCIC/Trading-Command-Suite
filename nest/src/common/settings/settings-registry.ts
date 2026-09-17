/**
 * settings-registry.ts — THE single declaration of the app's changeable settings.
 *
 * WHY THIS FILE EXISTS (#849)
 * ---------------------------
 * A user changed "Max Positions" to 20 in Settings and 5 was still enforced. The setting had not
 * failed to save — it saved perfectly, into `UserPreferences`, which **no business logic reads**,
 * while the enforced value came from `MT5_MAX_OPEN_POSITIONS` in `nest/.env`. Four stores held
 * overlapping ideas of "a setting":
 *
 *   | Store            | Size          | Seeded? |
 *   |------------------|---------------|---------|
 *   | process.env      | the caps      | n/a     |
 *   | appsetting       | 1 JSON blob   | ✅ yes  |
 *   | global_setting   | 459 keys      | ❌ NO seeder |
 *   | userpreferences  | 52 rows       | ❌ NO seeder |
 *
 * The defect was not that the value was wrong. It was that **there was no single place that knows
 * what settings exist**, so a control could be built against a store nothing reads, and 459 keys with
 * no seeder could sit one reinstall away from total loss.
 *
 * THE RULES THIS FILE ENCODES
 * ---------------------------
 * 1. **One store per CLASS of setting — one read path per value.** Not one store for everything:
 *
 *    | Class     | Store              | Why not the DB |
 *    |-----------|--------------------|----------------|
 *    | `secret`  | `.env` ONLY        | A seed file is committed to git. A broker password or API key in it is a leak. Secrets are therefore DECLARED here (so their existence is known) but never seeded and never written to the DB. |
 *    | `runtime` | `global_setting`   | Seeded on install, editable at runtime, hot-reloadable — no restart. |
 *    | `per-user`| `userpreferences`  | Inherently per-user; it is not a global setting and must not be merged into one. |
 *
 * 2. **The seed is the declared default, and nothing else.** One declaration feeds both the install
 *    path and the runtime fallback. Before this, `settings.service.ts` held `DEFAULTS` *and*
 *    `nest/prisma/seed.ts` held a second copy of the same values — two copies that drift, which is the
 *    defect class these instructions keep re-finding.
 *
 * 3. **Absent is normal; wrong is not.** Nothing writes a setting row until a user changes it, so on a
 *    fresh install EVERY row is absent and the declared default is the effective value. "Absent" and
 *    "unreadable" are therefore different states and the resolver keeps them distinct.
 *
 * ⚠️ WHAT IS DELIBERATELY *NOT* DECLARED YET
 * ------------------------------------------
 * Only the three migrated risk caps are declared in this pass. The other 456 `global_setting` keys
 * belong to the #849 inventory. They are held back for a specific reason: declaring a setting asserts
 * its `defaultValue`, and materialising a wrong default is a **behaviour change, not a tidy-up**.
 * The automation kill switches (`automation.tradingEnabled`, `automation.protocolsEnabled`) are the
 * clearest example — if a reader's current fallback is `false` and this file declared `true`, then
 * seeding would silently ENABLE trading. Every remaining key must have its reader's fallback verified
 * before it is declared here. That is the audit's job, and it is the reason this list is short.
 */

export type SettingClass = 'runtime' | 'secret' | 'per-user';
export type SettingType = 'number' | 'boolean' | 'string';

export interface SettingDefinition {
  /** `global_setting.key` for class 'runtime'; the env var name for class 'secret'. */
  key: string;
  type: SettingType;
  /**
   * The value used when the DB row is absent, and the value written at install time by
   * `ensureDefaults()`. This is the ONLY copy — the seed imports it rather than re-declaring it.
   */
  defaultValue: number | boolean | string;
  class: SettingClass;
  /** Owning module — answers "who is responsible for this value changing?". */
  owner: string;
  label: string;
  description: string;
  /** Whether the value is safe to expose as an editable control in the UI. */
  userChangeable: boolean;
  /** Inclusive bounds, enforced on write for `type: 'number'`. */
  min?: number;
  max?: number;
  /**
   * The `process.env` variable this setting replaced. Kept deliberately: it makes the migration
   * traceable from the code, and it is the checklist an operator greps when removing the env var.
   */
  migratedFrom?: string;
}

/**
 * The settings this file owns.
 *
 * ⚠️ Order is irrelevant; the resolver sorts by key so output is deterministic (the same reason
 * `docs-facts.cjs` sorts — a check that compares rendered output cannot tolerate ordering wobble).
 */
export const SETTINGS: SettingDefinition[] = [
  // ── Trading risk caps ──────────────────────────────────────────────────────
  // Migrated out of `process.env` on 2026-09-17 (#849). The declared defaults are deliberately the
  // values the .env held on that date (MT5_MAX_POSITION_SIZE=1.0, MT5_MAX_OPEN_POSITIONS=5,
  // MT5_MAX_DAILY_LOSS=100), so the enforced numbers are identical across the migration and the
  // change is provably behaviour-neutral. See the handoff for the before/after measurement.
  {
    key: 'risk.maxPositionSize',
    type: 'number',
    defaultValue: 1.0,
    class: 'runtime',
    owner: 'trading',
    label: 'Max position size',
    description:
      'Largest volume permitted in a single order. Checked before every MT5 order in ' +
      'assessGlobalRiskLimits(). This is a hard cap, not a target — it refuses the trade rather than ' +
      'reducing its size.',
    userChangeable: true,
    min: 0.01,
    max: 100,
    migratedFrom: 'MT5_MAX_POSITION_SIZE',
  },
  {
    key: 'risk.maxOpenPositions',
    type: 'number',
    defaultValue: 5,
    class: 'runtime',
    owner: 'trading',
    label: 'Max open positions',
    description:
      'Broker-wide ceiling on concurrently open positions. Because it is broker-wide rather than ' +
      'per-symbol, raising it enlarges exposure on correlated instruments (FX majors, gold) — see the ' +
      'note in position-time-stop.service.ts before increasing it.',
    userChangeable: true,
    min: 1,
    max: 1000,
    migratedFrom: 'MT5_MAX_OPEN_POSITIONS',
  },
  {
    key: 'risk.maxDailyLoss',
    type: 'number',
    defaultValue: 100,
    class: 'runtime',
    owner: 'trading',
    label: 'Max daily loss',
    description:
      'Realised loss across the current trading day that stops further order placement. Evaluated ' +
      'against closed trades only, so open drawdown does not trip it.',
    userChangeable: true,
    min: 0,
    // 0 is meaningful (block every trade) rather than "unlimited", so there is no way to express
    // "no limit" here on purpose: an accidental huge value is a risk decision that should be visible
    // in review, not a typo away.
    max: 100000,
    migratedFrom: 'MT5_MAX_DAILY_LOSS',
  },

  // ── META.Stack layer kill switches (#615) + bot-queue pacing (#714) ─────────
  // Migrated 2026-09-17 (#849). Previously read and written directly on `global_setting` inside
  // automation-loop.service.ts — `restoreLayerFlags()`, `setLayer()` and `setBotQueueConfig()`.
  //
  // 🛑 THESE DEFAULTS ARE LOAD-BEARING, NOT DECORATION.
  //
  // Declaring a setting ASSERTS its default, and `ensureDefaults()` MATERIALISES it on the next boot. A
  // wrong default is therefore a behaviour change, not a tidy-up. Declaring `automation.tradingEnabled:
  // true` would seed a row saying trading is ON, the loader would read it, and the loop would begin
  // placing orders — the single worst outcome available in this codebase.
  //
  // It is `false` because the code says so, in two places, with emphasis:
  //     automation-loop.service.ts  "NEVER auto-trade — user must opt in"
  //     automation-loop.service.ts  "NEVER auto-trade by default"
  // ...and because an earlier version of that service had exactly this bug: it forced
  // `tradingEnabled = true` on every restart, which is why the comment exists at all.
  //
  // ⚠️ HOW EACH DEFAULT WAS VERIFIED, not assumed: the loader leaves the STATE INITIALISER in place when
  // a row is absent, so the initialiser IS the effective default. Each value below was copied from
  // there (automation-loop.service.ts, the state object), which makes the migration provably
  // behaviour-neutral for both the absent-row case and the seeded case.
  {
    key: 'automation.protocolsEnabled',
    type: 'boolean',
    defaultValue: true,
    class: 'runtime',
    owner: 'automation',
    label: 'Protocols layer (kill switch)',
    description:
      'OFF skips scoring entirely — no scoring and no trading. This is the OUTERMOST switch in the mandate ' +
      'hierarchy (Protocols → Trading), so it is the one to reach for when everything must stop producing ' +
      'signals. Restart default: ON.',
    userChangeable: true,
  },
  {
    key: 'automation.tradingEnabled',
    type: 'boolean',
    defaultValue: false,
    class: 'runtime',
    owner: 'automation',
    label: 'Trading layer (kill switch)',
    description:
      'OFF blocks order dispatch while scoring and signals keep being produced. Defaults to OFF: a system ' +
      'that starts trading because a database row was missing is a worse failure than one that needs an ' +
      'operator to opt in. The emergency stop persists this OFF so a restart cannot undo it.',
    userChangeable: true,
  },
  {
    key: 'automation.botQueueEnabled',
    type: 'boolean',
    defaultValue: true,
    class: 'runtime',
    owner: 'automation',
    label: 'Bot queue',
    description:
      'Kill switch for the queue bot path only — the orchestrated strategy queue, not the main loop. ' +
      'Defaults ON, matching the code that treats anything other than an explicit false as enabled.',
    userChangeable: true,
  },
  {
    key: 'automation.botInterTradeDelayMinutes',
    type: 'number',
    defaultValue: 10,
    class: 'runtime',
    owner: 'automation',
    label: 'Bot inter-trade delay (minutes)',
    description:
      'Minimum spacing between queue-bot entries. This is a rate limit, not a scheduling preference — ' +
      'shortening it increases burst exposure on correlated instruments.',
    userChangeable: true,
    min: 0,
    max: 1440,
  },
];

/** Fast lookup. Built once at module load; the registry is static by design. */
export const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDefinition> = new Map(
  SETTINGS.map((s) => [s.key, s]),
);

/** Runtime settings are the `global_setting`-backed ones — the only class the resolver seeds. */
export const RUNTIME_SETTINGS: SettingDefinition[] = SETTINGS.filter(
  (s) => s.class === 'runtime',
).sort((a, b) => a.key.localeCompare(b.key));

/** Declared secrets: listed so their existence is known, never seeded, never stored in the DB. */
export const SECRET_SETTINGS: SettingDefinition[] = SETTINGS.filter(
  (s) => s.class === 'secret',
).sort((a, b) => a.key.localeCompare(b.key));

/**
 * Serialise a declared default into the `global_setting.value` column.
 *
 * ⚠️ That column is `TEXT`, not JSON (see the `GlobalSetting` model in schema.prisma) — every writer
 * in the codebase already stringifies by hand (`value: String(enabled)`), which is exactly the kind of
 * per-call-site convention this module exists to replace. One serialiser, one parser, one place for the
 * format to live.
 */
export function serialiseSetting(def: SettingDefinition): string {
  if (def.type === 'boolean') return def.defaultValue ? 'true' : 'false';
  return String(def.defaultValue);
}

/** Validation outcome for a candidate value. Narrow on purpose: only what the type needs. */
export type SettingValidationFailure = { ok: false; reason: string };
export type SettingValidation =
  | { ok: true; value: number | boolean | string }
  | SettingValidationFailure;

/**
 * Explicit type guard for a validation failure.
 *
 * A predicate rather than relying on inference from `!parsed.ok`: the union narrows in the obvious
 * cases, but a predicate is guaranteed, reads at the call site as the question being asked ("did this
 * FAIL?"), and keeps the failure shape in one place if it ever gains a field.
 */
export function isSettingFailure(
  v: SettingValidation,
): v is SettingValidationFailure {
  return v.ok === false;
}

/**
 * Coerce and validate a value against its declaration.
 *
 * A verifier that cannot read its input must ERROR, never pass — so an unparseable or out-of-range
 * value is returned as a failure rather than being coerced to the default. Silently substituting a
 * default would turn a typo into a risk limit nobody chose.
 */
export function validateSetting(
  def: SettingDefinition,
  raw: unknown,
): SettingValidation {
  if (def.type === 'boolean') {
    // Accept the stored form ('true'/'false'), real booleans, and the numbers a JSON write may leave.
    if (typeof raw === 'boolean') return { ok: true, value: raw };
    if (raw === 'true' || raw === '1' || raw === 1)
      return { ok: true, value: true };
    if (raw === 'false' || raw === '0' || raw === 0)
      return { ok: true, value: false };
    return {
      ok: false,
      reason: `expected a boolean, received ${JSON.stringify(raw)}`,
    };
  }

  if (def.type === 'number') {
    // Coerce only from shapes that can MEAN a number. `String(raw)` would happily turn an object into
    // "[object Object]" and then fail with a confusing message; NaN here routes straight to the
    // rejection below, which reports the original value via JSON.stringify.
    const n =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number(raw.trim())
          : NaN;
    if (!Number.isFinite(n)) {
      return {
        ok: false,
        reason: `expected a number, received ${JSON.stringify(raw)}`,
      };
    }
    if (def.min !== undefined && n < def.min) {
      return { ok: false, reason: `${n} is below the minimum of ${def.min}` };
    }
    if (def.max !== undefined && n > def.max) {
      return { ok: false, reason: `${n} is above the maximum of ${def.max}` };
    }
    return { ok: true, value: n };
  }

  if (typeof raw !== 'string') {
    return {
      ok: false,
      reason: `expected a string, received ${JSON.stringify(raw)}`,
    };
  }
  return { ok: true, value: raw };
}

/** Parse a value read back from `global_setting`. Same contract as validateSetting. */
export function parseStoredSetting(
  def: SettingDefinition,
  stored: string,
): SettingValidation {
  return validateSetting(def, stored);
}
