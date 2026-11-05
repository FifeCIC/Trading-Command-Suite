/**
 * progression-levels.ts — the progression model, as pure functions.
 *
 * ── DECISION (2026-11-04, primary) ──────────────────────────────────────────────────────────────
 * WHAT:      A **progression level** (1–5) is EARNED from measured activity and gates how many bots
 *            may be ACTIVE at once. XP is DERIVED from counts the app already writes; nothing is
 *            stored, awarded or spendable. Level 1 allows one active bot; level 5 is uncapped.
 * WHY:       The repo is now open source, so people other than the owner will run it. Running many
 *            bots is resource-intensive and several trading safeguards are still outstanding, so a
 *            first-day install should not be able to run a crowd of bots — and a limit that lifts as
 *            the operator demonstrably uses the app is defensible and explainable, where a flat
 *            "one bot" ceiling for everyone is not.
 * INSTEAD OF: A flat cap for every install, or a stored XP counter written on every trading action.
 *            Deriving from existing counts needs no schema change (this repo bans `db push`), no
 *            write path, and it cannot drift from the thing it counts — and an established install
 *            carries its history instead of having a level back-filled.
 * REVERSE BY: Set `progression.botCapEnabled=false` (declared setting, no deploy) to lift the cap
 *            while keeping the level readable; or change `activeBotCap` in `PROGRESSION_LEVELS`.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 148
 * GUARD:     nest/src/modules/progression/progression-levels.spec.ts (both directions, canaried)
 *            nest/src/modules/trading/trading-strategy.bot-cap-gate.spec.ts (real service, canaried)
 *            ⚠️ NOT in `prebuild` — the specs are run on demand, stated rather than implied.
 *
 * ⚠️ THIS IS NOT `src/core/experience-levels.js`. That is a **display preference** the user picks
 * (beginner / experienced / expert) which filters navigation. It is not earned, and it must never
 * be used to make a safety decision. Two things called "level" is exactly the ambiguity that makes
 * a defect unfindable, so the names stay distinct everywhere:
 *
 *   experience level  — chosen, cosmetic, drives nav visibility   (`experience-levels.js`)
 *   progression level — earned, gated, drives the active-bot cap  (this file)
 *
 * WHY XP IS DERIVED RATHER THAN STORED
 * ------------------------------------
 * The alternative — a stored `progression.xp` counter updated on every trading action — needs a new
 * table (this repo bans `db push`, so a schema change is expensive and risky), a write path on each
 * event, and a counter that can drift from the thing it counts. Deriving from counts that already
 * exist means no schema change, no writes, no drift — and **an established install carries its
 * history**, so nobody's level has to be back-filled.
 *
 * The cost of that choice, stated plainly: XP is not a currency. Nothing can be spent, awarded or
 * revoked, and an operator who deletes their history loses the level for it. That is acceptable for
 * a guardrail; it would not be acceptable for a licence — which is why this must never become one.
 *
 * ⚠️ THE MATHS IS DELIBERATELY DULL. No streaks, no multipliers, no badges. The level answers one
 * question — "has this operator actually used the app?" — and every point of cleverness added to a
 * safety gate is a new way for it to be wrong.
 */

export interface ProgressionLevel {
  level: number;
  name: string;
  /** Total XP at which this level is reached. Inclusive: 75 XP IS level 2. */
  xpRequired: number;
  /**
   * How many bots may be ACTIVE at once. `null` = no ceiling.
   *
   * ⚠️ The top level is uncapped ON PURPOSE (#1193). The restriction protects a NEW install while
   * safeguards are outstanding; an operator holding hundreds of trades, well over a hundred
   * backtests and months of use is not the risk it addresses. A top level that still blocked them
   * would be a licence limit wearing a safety label — the one thing this must not become.
   */
  activeBotCap: number | null;
}

export type XpSourceKey = 'closedTrades' | 'backtestRuns' | 'daysActive';

export interface XpSourceDefinition {
  /** Points per unit of the underlying count. */
  weight: number;
  /**
   * The most units that score. A cap exists so no single axis can carry a level on its own:
   * without them, five hundred backtests would out-vote never having placed a trade, and a
   * long-idle install would out-vote a week of real work.
   */
  cap: number;
  label: string;
  /** Where the count comes from — kept beside the number so a reader can check it. */
  source: string;
}

export interface ProgressionCounts {
  closedTrades: number;
  backtestRuns: number;
  daysActive: number;
}

export interface XpBreakdownRow {
  key: XpSourceKey;
  label: string;
  source: string;
  /** The number the database reported. */
  raw: number;
  /** The number that scored — equals `raw` unless the cap bit. */
  counted: number;
  xp: number;
  capped: boolean;
}

export const PROGRESSION_LEVELS: readonly ProgressionLevel[] = [
  { level: 1, name: 'First install', xpRequired: 0, activeBotCap: 1 },
  { level: 2, name: 'Measuring', xpRequired: 75, activeBotCap: 2 },
  { level: 3, name: 'Running the loop', xpRequired: 250, activeBotCap: 3 },
  { level: 4, name: 'Trusted operator', xpRequired: 600, activeBotCap: 5 },
  { level: 5, name: 'Established', xpRequired: 1000, activeBotCap: null },
];

export const XP_SOURCES: Record<XpSourceKey, XpSourceDefinition> = {
  closedTrades: {
    weight: 2,
    cap: 400,
    label: 'Closed trades',
    source: 'trade.status != open',
  },
  backtestRuns: {
    weight: 3,
    cap: 150,
    label: 'Completed backtest runs',
    // A `backtestrun` row is written when a run COMPLETES, so the row count IS the completed count.
    // ⚠️ There is no status column to filter on — do not add `where: { status: … }`, it does not exist.
    source: 'backtestrun row count',
  },
  daysActive: {
    weight: 1,
    cap: 120,
    label: 'Days active',
    source: 'first recorded activity → today',
  },
};

/** A count that is unusable (NaN, negative, missing) is ZERO — never a guess, never a throw. */
function normaliseCount(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** How many units of a source score, after its cap. */
export function countedValue(key: XpSourceKey, raw: unknown): number {
  const count = normaliseCount(raw);
  return Math.min(count, XP_SOURCES[key].cap);
}

/** The XP a single source contributes. */
export function xpForSource(key: XpSourceKey, raw: unknown): number {
  return countedValue(key, raw) * XP_SOURCES[key].weight;
}

/**
 * Every source, with BOTH numbers kept.
 *
 * ⚠️ `raw` and `counted` are both returned on purpose. A surface that showed only the XP would make
 * a capped source invisible — the reader would see a level that stopped moving with no way to learn
 * that their 500th backtest scored nothing. A derived number that hides the data it came from is how
 * "the level is broken" gets believed.
 */
export function xpBreakdown(
  counts: Partial<ProgressionCounts>,
): XpBreakdownRow[] {
  return (Object.keys(XP_SOURCES) as XpSourceKey[]).map((key) => {
    const def = XP_SOURCES[key];
    const raw = normaliseCount(counts[key]);
    const counted = countedValue(key, raw);
    return {
      key,
      label: def.label,
      source: def.source,
      raw,
      counted,
      xp: counted * def.weight,
      capped: raw > counted,
    };
  });
}

export function totalXp(counts: Partial<ProgressionCounts>): number {
  return xpBreakdown(counts).reduce((sum, row) => sum + row.xp, 0);
}

/**
 * The level an XP total has reached. **Inclusive at the threshold**: exactly 75 XP is level 2.
 *
 * Both directions are canaried in the spec, because an off-by-one here silently grants or withholds
 * a bot and produces no error — the failure would look exactly like a working cap.
 */
export function levelForXp(xp: number): ProgressionLevel {
  const value = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  let reached = PROGRESSION_LEVELS[0];
  for (const level of PROGRESSION_LEVELS) {
    if (value >= level.xpRequired) reached = level;
  }
  return reached;
}

/** The next level, or `null` at the top. */
export function nextLevelFor(level: number): ProgressionLevel | null {
  return PROGRESSION_LEVELS.find((l) => l.level === level + 1) ?? null;
}

/**
 * The active-bot ceiling for an XP total. `null` = no ceiling.
 *
 * This is the only function a gate should call. Reading `PROGRESSION_LEVELS` directly at a call site
 * would let the table change without the gate noticing.
 */
export function botCapForXp(xp: number): number | null {
  return levelForXp(xp).activeBotCap;
}

export interface ProgressSummary {
  level: ProgressionLevel;
  xp: number;
  nextLevel: {
    level: number;
    name: string;
    xpRequired: number;
    xpRemaining: number;
    /** The ceiling the NEXT level would allow — shown so the reader knows what they are earning. */
    activeBotCap: number | null;
  } | null;
  /** 0–100, rounded. 100 at the top level. */
  percentToNext: number;
}

export function summarise(counts: Partial<ProgressionCounts>): ProgressSummary {
  const xp = totalXp(counts);
  const level = levelForXp(xp);
  const next = nextLevelFor(level.level);
  if (!next) {
    return { level, xp, nextLevel: null, percentToNext: 100 };
  }
  const span = next.xpRequired - level.xpRequired;
  const done = xp - level.xpRequired;
  return {
    level,
    xp,
    nextLevel: {
      level: next.level,
      name: next.name,
      xpRequired: next.xpRequired,
      xpRemaining: Math.max(0, next.xpRequired - xp),
      activeBotCap: next.activeBotCap,
    },
    percentToNext: span <= 0 ? 100 : Math.round((done / span) * 100),
  };
}

/**
 * Would activating ONE more bot exceed the ceiling?
 *
 * ⚠️ TWO RULES THAT MUST NOT BE COLLAPSED INTO "count > cap":
 *
 *   1. **Only an INCREASE is refused.** Re-saving an already-active bot is not an increase. A rule
 *      written as `activeCount > cap` would refuse to re-save a bot on an install already over its
 *      cap, locking the operator out of editing a running bot.
 *   2. **Grandfathering.** An install ALREADY above the ceiling keeps working: it may deactivate and
 *      edit freely, and it may not add another until it is back under the cap. Retro-refusing —
 *      deactivating bots to enforce a new rule — would be a silent trading action taken by a
 *      documentation change.
 */
export function wouldExceedBotCap(
  activeCount: number,
  cap: number | null,
): boolean {
  if (cap === null) return false;
  const active = Number.isFinite(activeCount) ? Math.max(0, activeCount) : 0;
  return active >= cap;
}
