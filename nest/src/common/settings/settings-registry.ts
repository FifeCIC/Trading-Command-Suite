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
  {
    // ⚠️ Added 2026-09-17 (#865). This cap was HARDCODED as `maxPerSymbol: 0.25` in five places —
    // four of them in `risk.controller.ts` alone. Measured that day it was the single largest entry
    // blocker: 78 refusals, every one reading `Allocation 62.7% exceeds max per symbol 25%`, and
    // **no setting existed to move it**. A risk cap an operator cannot find is a cap that gets
    // worked around rather than reviewed.
    //
    // ⚠️ The value is a FRACTION of portfolio value (0.25 = 25%), unlike the frontend's
    // `riskMaxPerSymbol`, which is a whole-number percent in localStorage. Do not mix them.
    key: 'risk.maxPerSymbol',
    type: 'number',
    defaultValue: 0.25,
    class: 'runtime',
    owner: 'trading',
    label: 'Max per symbol',
    description:
      'Ceiling on TOTAL exposure to one symbol — already-open positions PLUS this order — as a ' +
      'fraction of portfolio value (0.25 = 25%). Refuses the order rather than reducing its size. ' +
      '⚠️ Before #899 (2026-09-19) this measured ONE ORDER: three bots at 20% each put 60% on ' +
      'one instrument while every check passed. ⚠️ Raising this does not by itself admit more ' +
      'trades: the estimate it is compared against is computed in assessGlobalRiskLimits() and ' +
      'has its own defect (#865) — check the decision log after any change here.',
    userChangeable: true,
    min: 0.01,
    // A cap of 1.0 permits the whole portfolio in one instrument, which is a decision an operator
    // may legitimately make on a demo account — so it is reachable, but it is not the default and
    // the description says what it means.
    max: 1.0,
  },
  {
    // ⚠️ Added 2026-09-26 (#991). The £100 per-trade ceiling existed ONLY as prose in #960's body:
    // no config entry, no `global_setting` row, no constant, no guard. `audit-strategy-realism.cjs`
    // could only read it from `REALISM_MAX_RISK ?? 100` — a default invented at the call site, which
    // is the same defect as a threshold hardcoded in a service.
    //
    // WHY THIS MATTERS EVEN THOUGH NOTHING IS BROKEN: measured across 33 active bots, the largest
    // single realised loss anywhere in the book is £31.07 (0 of 33 breach £100). So this is a
    // MISSING CONTROL, not an active fault — and a control with no home cannot be enforced, and a
    // bot cannot be validated against it because there is no source of truth to compare against.
    // `development-status.instructions.md` puts risk limits in the "always treat as production"
    // exception, so this path keeps full care pre-release.
    key: 'risk.maxPerTrade',
    type: 'number',
    defaultValue: 100,
    class: 'runtime',
    owner: 'trading',
    label: 'Max risk per trade',
    description:
      'Ceiling on the risk a SINGLE trade may carry, in account currency — the figure #960 Tier 1 ' +
      'named but nothing enforced. This is the ceiling bots are validated against; it does not ' +
      'resize an order. ⚠️ Not the same as risk.maxDailyLoss (all trades in a day) or ' +
      'risk.maxPerSymbol (exposure to one instrument as a fraction of portfolio value). ' +
      '⚠️ Breaching it today is measured, not prevented: 0 of 33 bots exceed it, so a future breach ' +
      'is only visible if something reads this value.',
    userChangeable: true,
    // 0 is meaningful (risk nothing) rather than "unlimited", so there is no way to express
    // "no limit" — an accidental huge value is a risk decision that should be visible in review.
    min: 0,
    max: 100000,
  },
  {
    // ⚠️ Added 2026-09-19 (#900). Declared since the beginning (`maxPortfolioRisk: 0.15` in four
    // literals) with NO READER ANYWHERE — the register's own words: "A portfolio-level risk cap
    // that does not exist is worse than none: it is assumed to be protecting something." Now
    // wired: the fraction of the portfolio LOST if every open position's stop filled, summed
    // across the whole book and checked before any new order (assessGlobalRiskLimits).
    //
    // Definition (the one the owner asked for): "X% is in red on current positions" →
    // Σ |entry − brokerSL| × volume × contractSize, converted to account currency. NOT the same
    // question as maxDrawdown (peak-to-current on realised+unrealised equity).
    key: 'risk.maxPortfolioRisk',
    type: 'number',
    // 0.15 → 0.20 on 2026-10-13 (owner decision, R47/R57). See `risk-profile-rules.ts` for the
    // measurement: 601 refusals/day under 0.15, driven by one minimum-lot gold position that cannot
    // be sized smaller on a £718 account; 601 → 0 refusals after the raise. Changed here as well as
    // in the database so a reinstall keeps the decision (a DB-only change does not survive).
    // ⚠️ Written as `0.2`, NOT `0.20` — `validate-risk-profile.cjs` compares this literal against the
    // setting's own default as STRINGS and fails the build on `0.20` vs `0.2`. Two spellings of one
    // number is the drift that guard exists to catch, and it caught this.
    defaultValue: 0.2,
    class: 'runtime',
    owner: 'trading',
    label: 'Max portfolio risk',
    description:
      'Ceiling on the TOTAL loss across all open positions if every broker stop filled, as a ' +
      'fraction of portfolio value (0.20 = 20%). Refuses new orders while the book exceeds it. ' +
      '⚠️ Positions WITHOUT a broker stop are priced at full notional (materially larger), so a ' +
      'naked position can trip this on its own — that is deliberate. Wired 2026-09-19 (#900); ' +
      'before that this cap had no reader anywhere and was assumed to be protecting something.',
    userChangeable: true,
    min: 0.01,
    max: 1.0,
  },
  {
    // ⚠️ Added 2026-09-19 (#900). The owner's rule, verbatim: "if … the distant broker stop loss
    // is missing … then it doesn't trade." docs/trading-bot-model.md §6b requires a broker-side
    // protective stop on EVERY position so an app failure never leaves one unprotected — that
    // invariant was asserted at order-building and never verified AFTERWARD. This checks it on
    // every entry, against every open position.
    key: 'risk.requireBrokerStopLoss',
    type: 'boolean',
    defaultValue: true,
    class: 'runtime',
    owner: 'trading',
    label: 'Require broker stop loss',
    description:
      'Refuse a new order while ANY open position has no broker-side stop loss (SL 0). Set false ' +
      'only to deliberately run unprotected positions — a naked position is then priced at full ' +
      'notional in the maxPortfolioRisk check.',
    userChangeable: true,
  },
  {
    // ⚠️ Added 2026-09-17 (#865) — same class as risk.maxPerSymbol: declared live, hardcoded 0.25
    // in five places, unmovable.
    //
    // ⚠️ Read `maxDrawdown`'s caveat in risk-profile-rules.ts before changing it. The peak equity
    // this is measured against is IN-MEMORY and only ever increases, so raising the limit does not
    // fix a bad peak — it only makes the system tolerate one. The real guard is the `null` check in
    // assessGlobalRiskLimits() that refuses to invent an account value (#848).
    key: 'risk.maxDrawdown',
    type: 'number',
    defaultValue: 0.25,
    class: 'runtime',
    owner: 'trading',
    label: 'Max drawdown',
    description:
      'Peak-to-current fall in equity (0.25 = 25%) that stops further order placement. Measured ' +
      'against an in-memory, monotonically increasing high-water mark that resets only on restart.',
    userChangeable: true,
    min: 0.01,
    max: 1.0,
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
  {
    key: 'automation.preOpenAlertMinutes',
    type: 'number',
    defaultValue: 30,
    class: 'runtime',
    owner: 'automation',
    label: 'Pre-open session alert (minutes before)',
    description:
      'Raise ONE collapsing advisory alert this many minutes before the New York session opens ' +
      '(#981). Advisory ONLY — it gates nothing: no pause, no entry block, no close (the owner: ' +
      '"alert of market opening ahead, no automatic effect"). 0 disables the alert. The alert title ' +
      'is day-scoped and carries no minute count, so the collapse key keeps a full window to one row.',
    userChangeable: true,
    min: 0,
    max: 240,
  },
  {
    key: 'trading.maxQuoteAgeSeconds',
    type: 'number',
    defaultValue: 300,
    class: 'runtime',
    owner: 'trading',
    label: 'Max quote age for sizing (seconds)',
    description:
      'An order is REFUSED when the broker\'s own last-tick time is older than this (#1085): a ' +
      'frozen quote must not size a position while a missing one is refused. 0 disables the check ' +
      '(an explicit choice, not a default). ⚠️ The bridge\'s rounded server-offset correction can ' +
      'over-state the age by up to ~7.5 min in its worst case — if false refusals appear on liquid ' +
      'symbols, check the bridge offset-probe logs BEFORE raising this.',
    userChangeable: true,
    min: 0,
    max: 86400,
  },

  // ── Log retention and volume (#1023) ─────────────────────────────────────────
  //
  // ⚠️ THESE SETTINGS DELETE FILES, so the defaults are deliberately CONSERVATIVE. Measured
  // 2026-09-29: `nest/logs/` held 62 files / 21.8 MB with nothing pruning any of it, and the log
  // for 2026-09-24 alone was 5.8 MB — 10-34× its neighbours — because 4,800 identical
  // `bridge[2] GET /symbols FAILED` warnings were written verbatim.
  //
  // ⚠️ A RETENTION POLICY MUST NOT BE ABLE TO DELETE THE EVIDENCE. `retention.config.ts` already
  // carries that lesson for database rows (a retention run destroyed the evidence of the very
  // defect it was being investigated for). Three things follow, and all three are enforced in code
  // rather than promised here:
  //   1. TODAY'S FILE IS NEVER PRUNED, whatever the window says.
  //   2. `logging.pruneEnabled` can be switched off without editing anything.
  //   3. Every prune is available as a DRY RUN, and reports each file by name and size before it
  //      removes anything.
  {
    key: 'logging.retentionDays',
    type: 'number',
    defaultValue: 30,
    class: 'runtime',
    owner: 'system',
    label: 'Log retention (days)',
    description:
      'Log files older than this are removed by the daily prune. 30 days is roughly 10 MB at the ' +
      'measured rate, or ~175 MB if every day were as bad as 2026-09-24. Today\'s file is never ' +
      'removed regardless of this value.',
    userChangeable: true,
    min: 1,
    max: 3650,
  },
  {
    key: 'logging.pruneEnabled',
    type: 'boolean',
    defaultValue: true,
    class: 'runtime',
    owner: 'system',
    label: 'Prune old log files',
    description:
      'OFF stops the daily prune entirely and keeps every log file. Turn it off while investigating ' +
      'something historical — deletion is the one operation here that cannot be undone.',
    userChangeable: true,
  },
  {
    key: 'logging.collapseRepeats',
    type: 'boolean',
    defaultValue: true,
    class: 'runtime',
    owner: 'system',
    label: 'Collapse repeated log lines',
    description:
      'ON writes the first occurrence of an identical message and then suppresses duplicates within ' +
      'the window below, emitting one summary line instead. Measured cause of the 5.8 MB day: 4,800 ' +
      'identical lines. The warning is still recorded — once, plus a count — which is what it is worth. ' +
      'OFF restores byte-for-byte verbatim logging and is the right setting while chasing a specific ' +
      'repeating fault.',
    userChangeable: true,
  },
  {
    key: 'logging.repeatWindowMinutes',
    type: 'number',
    defaultValue: 5,
    class: 'runtime',
    owner: 'system',
    label: 'Repeated-line window (minutes)',
    description:
      'How long an identical message is collapsed for. A very short window keeps most duplicates and ' +
      'buys little; a very long one hides a fault that starts repeating slowly. Five minutes matches ' +
      'the cadence of the bridge polling that produced the measured storm.',
    userChangeable: true,
    min: 1,
    max: 1440,
  },

  // ── Notifications ──────────────────────────────────────────────────────────
  // ⚠️ WHY THESE ARE HERE (2026-10-05). The notification module has had a priority floor and a
  // per-event preference list since #972 — reachable at `GET|PUT /api/notifications/preferences` —
  // but BOTH were plain instance fields (`this.minPriority`, `this.preferences`). Measured that day:
  // `PrismaService` was injected into the service and NEVER CALLED, so every change was accepted and
  // then forgotten on the next API restart. A settings control on top of that is editable, saves, and
  // has no effect — the exact "lie on screen" #849 was created to end.
  //
  // They are declared here rather than given a store of their own because persistence, seeding and a
  // single read path are precisely what this registry provides. A second mechanism would be the
  // duplicated-source defect class this file exists to close.
  {
    key: 'notifications.minPriority',
    type: 'string',
    defaultValue: 'low',
    class: 'runtime',
    owner: 'notifications',
    label: 'Notification floor',
    description:
      'Nothing quieter than this is delivered on ANY channel. `low` (the default) suppresses nothing, ' +
      'deliberately: a control that starts active and silent is indistinguishable from a broken ' +
      'notification system. `critical` is what mutes routine traffic. The `trade-disabled` event is ' +
      'exempt from the floor entirely, because muting it reproduces the outage it exists for.',
    userChangeable: true,
  },
  {
    key: 'notifications.detailLevel',
    type: 'string',
    defaultValue: 'simple',
    class: 'runtime',
    owner: 'notifications',
    label: 'Notification detail',
    description:
      'How much a notification says. `simple` = title and body (what the app has always sent); ' +
      '`detailed` adds instrument and strategy context; `advanced` adds scores and richer styling. ' +
      '`simple` is the default because it is the CURRENT behaviour — a default that changed the ' +
      'output would be a behaviour change wearing a tidy-up\'s clothes.',
    userChangeable: true,
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

// ── Key families ───────────────────────────────────────────────────────────────
//
// A FAMILY is a declaration covering a PATTERN of keys rather than one key.
//
// WHY IT EXISTS: the 2026-09-17 inventory measured 462 `global_setting` keys, and 442 of them are
// `directive:<id>:<field>` config — 101 directives × {directionBias, maxScore, priority, category,
// minScore}. Writing 442 declarations would be absurd, and more importantly it would be WRONG: each
// `maxScore` is a load-bearing scoring weight, so inventing 442 defaults is exactly the class of mistake
// that would have declared `automation.tradingEnabled` as `true`.
//
// 🛑 THE SAFETY PROPERTY, AND IT IS THE WHOLE DESIGN
// --------------------------------------------------
// **A family member has NO default, therefore `ensureDefaults()` can never materialise one.**
// Seeding is driven by `RUNTIME_SETTINGS`, built from `SETTINGS` (individual declarations with defaults).
// Families are a separate list, never iterated for seeding. So adding a family cannot change a single
// value on any install — it can only make an EXISTING key readable through one owner, with validation
// and provenance reporting.
//
// ⚠️ AND SO: `resolve()` REFUSES a family key. A family member with no row has no value to report, and
// returning `null`/`0` for it would be a fabricated reading — the *plausible numbers, no error* defect.
// Read a family member with `resolveFamily()`, which reports whether a row EXISTS and validates it if so,
// and leaves the fallback to the code that owns the behaviour.

export interface SettingFamilyField {
  type: SettingType;
  min?: number;
  max?: number;
  /**
   * Documented, and deliberately NOT enforced. An over-tight validator that rejects a valid value turns
   * a working directive into an unreadable row, and that failure looks like data corruption rather than
   * like a limit — a worse outcome than not validating at all.
   */
  allowed?: string[];
  description: string;
  userChangeable: boolean;
}

export interface SettingFamily {
  id: string;
  label: string;
  owner: string;
  description: string;
  /** Anchored pattern whose captures identify the subject and the field. */
  pattern: RegExp;
  /** 1-based capture group holding the FIELD name. 0 means the key has no field component. */
  fieldGroup: number;
  /** 1-based capture group holding the SUBJECT (directive slug, broker id, …). */
  subjectGroup: number;
  /**
   * Bulk-read prefix, so a caller that needs EVERY member of a family is one indexed query rather than
   * one round-trip per key. `directive-config.service.ts` reads all ~442 directive keys at once, so a
   * per-key accessor would have been 442 queries — which is how a "cleaner" access path becomes a
   * performance problem and then gets bypassed.
   */
  prefix: string;
  fields: Record<string, SettingFamilyField>;
}

/**
 * The declared families.
 *
 * ⚠️ Add a family only when the key SHAPE is genuinely open-ended. A family that matches one key is an
 * individual declaration wearing a pattern — it would hide that key's default from `ensureDefaults()`
 * while pretending to be a setting.
 */
export const SETTING_FAMILIES: SettingFamily[] = [
  {
    id: 'notificationEvent',
    label: 'Per-event notification preferences',
    owner: 'notifications',
    description:
      'Which channels deliver one notification event, whether it is on at all, and how loud it is. ' +
      'Read by notifications.service.ts, which keeps `DEFAULT_PREFERENCES` as its OWN fallback and lets ' +
      'these rows override it. ⚠️ The event LIST is deliberately not declared anywhere in this file: a ' +
      'family is a key SHAPE, so the 11 events live in one place (the service) and cannot drift into a ' +
      'second copy here. ⚠️ `enabled: false` is REFUSED at send time for `mandatory` events (currently ' +
      '`trade-disabled`) — muting that one reproduces the overnight outage it exists for.',
    pattern: /^notifications\.event\.([a-z0-9-]+)\.([A-Za-z]+)$/,
    prefix: 'notifications.event.',
    subjectGroup: 1,
    fieldGroup: 2,
    fields: {
      enabled: {
        type: 'boolean',
        description:
          'Whether this event is delivered at all. Ignored for `mandatory` events, which cannot be muted.',
        userChangeable: true,
      },
      priority: {
        type: 'string',
        // Documented, not enforced — see SettingFamilyField.allowed. An over-tight validator that
        // rejected a valid value would turn a working preference into an unreadable row.
        allowed: ['critical', 'high', 'normal', 'low'],
        description:
          'How loud this event is. Drives the global `notifications.minPriority` floor — an event quieter ' +
          'than the floor is suppressed, which is why a muted event can still arrive.',
        userChangeable: true,
      },
      channels: {
        type: 'string',
        description:
          'Comma-separated delivery channels for this event: email, windows, telegram, discord. ' +
          'Stored as one string because the family field types are scalar; split on read.',
        userChangeable: true,
      },
    },
  },
  {
    id: 'directive',
    label: 'Per-directive configuration',
    owner: 'directives',
    description:
      'Tuning for one directive: category, direction bias, score weights and priority. Read by ' +
      'directive-config.service.ts and the gating pipeline. ⚠️ `maxScore` is a WEIGHT, not a percentage — ' +
      'changing it changes every protocol that uses that directive, so it is the most consequential field.',
    pattern: /^directive:([a-z0-9-]+):([A-Za-z]+)$/,
    prefix: 'directive:',
    subjectGroup: 1,
    fieldGroup: 2,
    fields: {
      category: {
        type: 'string',
        description: 'Grouping label used by the directive explorer.',
        userChangeable: false,
      },
      directionBias: {
        type: 'string',
        allowed: ['LONG_ONLY', 'SHORT_ONLY', 'BOTH', 'NEUTRAL'],
        description:
          'Which direction this directive may justify. A one-sided directive inside a two-sided protocol ' +
          'is a real constraint, not a label.',
        userChangeable: false,
      },
      // Bounds are deliberately WIDE. Observed range is 30-200, but a directive may legitimately be
      // reweighted, and rejecting a valid weight would make the row unreadable.
      maxScore: {
        type: 'number',
        min: 1,
        max: 1000,
        description:
          'Maximum score this directive can contribute. A WEIGHT: it sets the directive’s share of a ' +
          'protocol’s total.',
        userChangeable: true,
      },
      minScore: {
        type: 'number',
        min: 0,
        max: 1000,
        description: 'Floor below which the directive reports nothing.',
        userChangeable: true,
      },
      priority: {
        type: 'number',
        min: 0,
        max: 100,
        description: 'Evaluation ordering hint.',
        userChangeable: true,
      },
    },
  },
  {
    id: 'brokerTrading',
    label: 'Per-broker trading flag',
    owner: 'automation',
    description:
      'The #615 trading kill switch for one broker. ⚠️ FAIL-CLOSED: the reader treats an absent row as ' +
      'DISABLED (see restoreBrokerTradingFlags), which is why this is a family with no default rather ' +
      'than a seeded setting — a seeded `true` would re-enable a broker a human had switched off.',
    pattern: /^automation\.brokerTrading\.([A-Za-z0-9_-]+)$/,
    prefix: 'automation.brokerTrading.',
    subjectGroup: 1,
    fieldGroup: 0,
    fields: {
      __value: {
        type: 'boolean',
        description: 'Whether trading is permitted for this broker.',
        userChangeable: true,
      },
    },
  },
  {
    id: 'protocol',
    label: 'Per-protocol directive override',
    owner: 'scoring',
    description:
      'Overrides one directive\u2019s weights INSIDE one protocol \u2014 the mechanism behind ' +
      '`protocolKey(slug, directiveId, field)` in directive-config.service.ts.\n\n' +
      '\u26a0\ufe0f MEASURED 2026-09-17: this family has **zero rows** in the database. It is declared so the ' +
      'code path that WRITES it has an owner and a validator, not because anything reads it today. ' +
      'That is worth knowing before building on it: an override feature with no data may be unused, or ' +
      'may have been tried and abandoned.\n\n' +
      '🛑 A protocol override silently changes how one protocol scores relative to every other protocol ' +
      'that shares the directive \u2014 so if this is ever surfaced in a UI, the blast radius needs saying ' +
      'out loud on the control.',
    pattern: /^protocol:([a-z0-9-]+:[a-z0-9-]+):([A-Za-z]+)$/,
    prefix: 'protocol:',
    // The subject is the protocol+directive PAIR: an override is meaningless without both.
    subjectGroup: 1,
    fieldGroup: 2,
    fields: {
      maxScore: {
        type: 'number',
        min: 1,
        max: 1000,
        description: 'Overridden maximum score for this directive within this protocol only.',
        userChangeable: true,
      },
      minScore: {
        type: 'number',
        min: 0,
        max: 1000,
        description: 'Overridden floor for this directive within this protocol only.',
        userChangeable: true,
      },
      priority: {
        type: 'number',
        min: 0,
        max: 100,
        description: 'Evaluation ordering hint for this override.',
        userChangeable: true,
      },
      category: {
        type: 'string',
        description: 'Overridden grouping label within this protocol only.',
        userChangeable: false,
      },
      directionBias: {
        type: 'string',
        allowed: ['LONG_ONLY', 'SHORT_ONLY', 'BOTH', 'NEUTRAL'],
        description: 'Overridden direction bias within this protocol only.',
        userChangeable: false,
      },
    },
  },
  {
    /**
     * ── ADDED 2026-10-27 ─────────────────────────────────────────────────────────────────────────
     * WHICH STORED RUN IS THE ACCEPTED "A" (owner direction: *"'A' will also be the data from the
     * backtest that the user indicates as an improvement … so that we can mark the accepted change
     * and then compare the following backtest to that new set of data."*)
     *
     * It was `localStorage` first, and that was a real limitation rather than a choice: a baseline
     * dies with a cache clear, and no other machine or agent can see which run was accepted. It is a
     * DECISION ABOUT EVIDENCE, so it belongs in the database with the runs it points at.
     *
     * ⚠️ THE SUBJECT IS A SCOPE, NOT A RUN: a protocol slug (`vix-spike-v1`), because two protocols
     * score different directives against different symbols and their runs are not comparable. There is
     * exactly ONE baseline per scope — accepting a run REPLACES the previous one, which is the point
     * of "this is the new reference".
     *
     * ⚠️ `clearFamily('backtestBaseline', scope)` WOULD DELETE NOTHING — `clearFamily` derives its
     * prefix with a `:` before the field (`<prefix><subject>:`), which is right for the `protocol`
     * family and wrong for every dot-style one. Use `clear(<full key>)` (added alongside this family)
     * when removing a baseline. Recorded here because the failure is a silent `deleted: 0`.
     */
    id: 'backtestBaseline',
    label: 'Accepted backtest baseline',
    owner: 'backtest',
    description:
      'Which stored run is the ACCEPTED A-baseline for one scope (a protocol slug). Read by the ' +
      'Backtest Lab A/B panels so "compare against what I accepted" survives a browser cache clear ' +
      'and is visible to every machine. ⚠️ Accepting a run REPLACES the scope\'s baseline — there is ' +
      'one reference per scope, not a list. A baseline whose run has been DELETED is a dangling ' +
      'pointer: the UI must say so and offer to clear it rather than silently comparing against ' +
      'nothing.',
    pattern: /^backtest\.baseline\.([a-z0-9-]+)\.(runId|acceptedAt)$/,
    prefix: 'backtest.baseline.',
    subjectGroup: 1,
    fieldGroup: 2,
    fields: {
      runId: {
        type: 'string',
        description:
          'The `backtestrun.id` the reader accepted as A. Not validated against the run table here — ' +
          'the settings store does not know about runs, so a dangling id is a state the READER must ' +
          'handle, and it must be reported rather than treated as "no baseline".',
        userChangeable: true,
      },
      acceptedAt: {
        type: 'string',
        description:
          'ISO instant the baseline was accepted. Kept so a reader can tell an old reference from a ' +
          'fresh one without guessing from the run\'s own createdAt.',
        userChangeable: false,
      },
    },
  },
];

/**
 * Match a key against the declared families.
 *
 * Returns null when nothing matches — which is the signal for "this key has no owner", the number
 * `/api/system/settings/registry` reports as `undeclaredKeysInDb`.
 */
export function matchFamily(
  key: string,
): { family: SettingFamily; subject: string; field: string } | null {
  for (const family of SETTING_FAMILIES) {
    const m = family.pattern.exec(key);
    if (!m) continue;
    const subject = m[family.subjectGroup] ?? '';
    // fieldGroup 0 means the key has no field component; one `__value` field describes it.
    const field =
      family.fieldGroup === 0 ? '__value' : (m[family.fieldGroup] ?? '');
    if (!family.fields[field]) continue;
    return { family, subject, field };
  }
  return null;
}

/** Is this a well-formed key for the given family field? */
export function validateFamilyValue(
  field: SettingFamilyField,
  raw: unknown,
): SettingValidation {
  if (field.type === 'boolean') {
    if (typeof raw === 'boolean') return { ok: true, value: raw };
    if (raw === 'true' || raw === 1 || raw === '1')
      return { ok: true, value: true };
    if (raw === 'false' || raw === 0 || raw === '0')
      return { ok: true, value: false };
    return {
      ok: false,
      reason: `expected a boolean, received ${JSON.stringify(raw)}`,
    };
  }
  if (field.type === 'number') {
    const n =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number(raw.trim())
          : NaN;
    if (!Number.isFinite(n))
      return {
        ok: false,
        reason: `expected a number, received ${JSON.stringify(raw)}`,
      };
    if (field.min !== undefined && n < field.min)
      return { ok: false, reason: `${n} is below the minimum of ${field.min}` };
    if (field.max !== undefined && n > field.max)
      return { ok: false, reason: `${n} is above the maximum of ${field.max}` };
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
