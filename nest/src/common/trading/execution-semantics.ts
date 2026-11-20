/**
 * execution-semantics.ts — HOW A STORED RESULT WAS COMPUTED, AS A NUMBER THAT CAN BE COMPARED.
 *
 * ── THE PROBLEM IT SOLVES ───────────────────────────────────────────────────────────────────────
 * The backtester stores every run so a later run can be compared with it. But the ENGINE changes, and
 * when it does, the older row was produced by different rules. Measured 2026-11-20 alone: the same
 * window produced **−1,538.47 with 44 trades** before the bot's own bracket reached the engine and
 * **+767.64 with 29** after — same dataset, same protocol, same bot. A delta between those two runs is
 * not a measurement of anything; it is the engine learning a rule, wearing a result's clothes.
 *
 * So: bump `EXECUTION_SEMANTICS` whenever a change alters what a stored run would compute, and the
 * comparison refuses to show a delta across two versions. "Cannot judge" is a reported state here,
 * never a silent zero.
 *
 * ── WHEN TO BUMP ────────────────────────────────────────────────────────────────────────────────
 *
 *   ✅ bump: an EXIT rule, the ORDER inside a bar, a sizing input, a cost model, a scoring input, a
 *           filter that changes which trades exist (entry bar, time stop, session gate)
 *   ❌ do not bump: a new field on the RESULT, a rename, a JSON shape, a UI change, a bug fix to a
 *           reader — anything that leaves every stored number identical
 *
 * ⚠️ THE TEST IS THE NUMBERS, NOT THE DIFF. Ask: *"would re-running a stored run today produce a
 * different trade list?"* If yes, bump. If the answer is not obvious, bump — a wrongly-kept version
 * shows a delta that is arithmetic rather than behaviour, which is worse than an unnecessary re-run.
 *
 * Part of #1242; consumed by `selection-profile.ts` and recorded on every `backtest_selection` row.
 */

/** Bump on any change that would alter what a stored run computes. The history is `SEMANTICS_LOG`. */
export const EXECUTION_SEMANTICS = 2;

export interface SemanticsChange {
  version: number;
  /** ISO date the change landed. */
  date: string;
  /** What changed, in the terms a reader comparing two runs needs. */
  what: string;
  /** The issue that carries the reasoning. */
  issue: number;
}

/**
 * Every version, oldest first. The LAST entry must be `EXECUTION_SEMANTICS` — asserted by the spec, so
 * a bump without a reason and a reason without a bump both fail.
 */
export const SEMANTICS_LOG: readonly SemanticsChange[] = [
  {
    version: 1,
    date: '2026-11-20',
    what:
      'Baseline: the per-bar exit decision is the shared `position-bar` (stop in force → percentage ' +
      'target → money target → time stop → tighten for the next bar), the position is sized BEFORE the ' +
      'bracket walk, a bot\'s absolute money target is applied, and every trade records its exit in the ' +
      'LIVE close vocabulary as well as the engine\'s own. Runs stored before this version predate all ' +
      'of it.',
    issue: 1242,
  },
  {
    version: 2,
    date: '2026-11-20',
    what:
      'The bot\'s declared session window (`trading_strategy.sessionWindow`) now gates entries: a bar ' +
      'outside it is scored but not traded, using the live predicate `checkSessionWindow()`. Set on ' +
      'every movers bot, so runs of those bots before this version traded the pre-market hour before ' +
      'the US open as though the bot were open.',
    issue: 1242,
  },
];

/** True only when two stored results were computed by the same rules. */
export function sameSemantics(a: number | null | undefined, b: number | null | undefined): boolean {
  // A missing version is NOT "the same" — an unknown is refused, because assuming equality is exactly
  // the guess that puts a number where a refusal belongs.
  if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return false;
  return Number(a) === Number(b);
}

/** The log entries between two versions, for a message that names what changed rather than a bare id. */
export function changesBetween(from: number, to: number): SemanticsChange[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return SEMANTICS_LOG.filter((c) => c.version > lo && c.version <= hi);
}
