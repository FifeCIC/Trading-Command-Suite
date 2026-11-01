/**
 * describeRunDifferences() — WHICH SETTINGS CHANGED between runs, so a P&L difference has an
 * explanation rather than an anecdote.
 *
 * ── WHY THIS EXISTS (owner direction, 2026-10-31) ───────────────────────────────────────────────
 * *"this table also doesn't show any differences"* — and it could not. Four runs of the same protocol
 * were listed at +76,617 … +141,219 with identical protocol, symbol, timeframe, trade count, win rate
 * and profit factor, and NOTHING on the page said why the P&L moved. Measured by diffing the rows
 * (`logs/measure-run-config-diff.cjs`): they differed in `slippage`/`spread` by orders of magnitude —
 * one costed a 0.01% spread and another 0.93%, a £64,600 swing on the same trades.
 *
 * A side-by-side metric table answers "which run won". It cannot answer "what did I change", and the
 * second is the question a backtest session is actually made of. So the comparison now carries an
 * explicit diff, computed against the STORED columns rather than inferred from the results.
 *
 * ── THE RULE THAT MATTERS ───────────────────────────────────────────────────────────────────────
 * ⚠️ "NOT RECORDED" IS NOT A VALUE AND MUST NEVER COMPARE EQUAL TO ONE. A null `spread` on a row that
 * predates the cost columns does not mean the run had no spread — it means the number is unknown, and
 * saying "same" would credit an unknown to both sides. Every `null` is surfaced as `unrecorded`.
 *
 * ⚠️ UNITS ARE IN THE IDENTIFIER. `slippage` and `spread` are FRACTIONS of price (0.0093 = 0.93%)
 * while `riskPct` is already a percent (2 = 2%). Formatting a fraction as though it were a percent, or
 * the reverse, is the split-unit defect #980 removed — so `format` names the unit and the label says
 * what it is a percentage OF.
 */

export type DiffGroup = 'scope' | 'sizing' | 'costs' | 'provenance';

export interface RunSettingsRow {
  id: string;
  symbol: string;
  protocolId: string;
  timeframe: string;
  startDate: Date | string;
  endDate: Date | string;
  periodId: string | null;
  newsExclusion: string | null;
  /** #1155 — which sides the run could open: 'long' | 'short' | 'both'. */
  directionMode: string | null;
  /**
   * #1141 — the committed-notional cap the run was measured under (1 = unleveraged), and the mechanism
   * that chose its window. Neither is derivable from the other fields, and both change what the money
   * column means, so they belong in the diff rather than in the reader's memory.
   */
  maxLeverage: number | null;
  windowSource: string | null;
  /**
   * #1170 — the broker step every size in the run was quantised to (`null` = whole units).
   * It decides whether a trade happened AT ALL: on US30 a 0.2-unit step is a fill and a 1-unit floor
   * is zero trades, on the same data.
   */
  unitStep: number | null;
  /** #1143 — the constant unit count for `fixedUnits`; null for every equity-derived model. */
  fixedUnits: number | null;
  positionModel: string | null;
  /** Account currency. */
  accountSize: number | null;
  /** Already a percent (2 = 2%). */
  riskPct: number | null;
  /** Account currency per trade, when the model is fixed-amount. */
  fixedAmount: number | null;
  /** FRACTION of price (0.0004 = 0.04%). */
  slippage: number | null;
  /** FRACTION of price (0.0093 = 0.93%). */
  spread: number | null;
  /** FRACTION of notional. */
  commission: number | null;
  botId: string | null;
  /** Broker lots at run time. */
  botBaseSize: number | null;
  configVersion: number | null;
  iteration: number | null;
}

export interface RunDifferenceRow {
  field: string;
  label: string;
  group: DiffGroup;
  /** One rendered value per run, in the caller's run order. `null` = not recorded. */
  values: Array<string | null>;
  /** True when at least one side recorded nothing — the comparison is then incomplete, not equal. */
  unrecorded: boolean;
}

export interface RunDifferenceSet {
  changed: RunDifferenceRow[];
  same: Array<{ field: string; label: string; group: DiffGroup; value: string; unrecorded: boolean }>;
  changedCount: number;
  sameCount: number;
  /**
   * ⚠️ THE RUN IDS IN THE ORDER `values` IS ALIGNED TO. Without this a consumer has to GUESS which
   * column is A and which is B — and the API sorts runs by `createdAt desc`, not by the order the
   * caller asked for, so the guess is wrong whenever A is the newer run. A positional array with an
   * undocumented order is the same defect as printing an age under a timestamp heading.
   */
  order: string[];
}

const iso = (v: Date | string) => {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : 'not recorded';
};

const asPct = (v: number | null) => (v == null ? null : `${+(Number(v) * 100).toFixed(4)}%`);
const asPctLiteral = (v: number | null) => (v == null ? null : `${+Number(v).toFixed(4)}%`);
const asMoney = (v: number | null) => (v == null ? null : `$${Number(v).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`);
const asText = (v: string | null) => (v == null || v === '' ? null : String(v));
const asNum = (v: number | null) => (v == null ? null : String(v));

/**
 * The declared fields, in the order a reader should meet them: what was measured, how big the
 * positions were, what the fills cost, then where the numbers came from. Sizing and costs lead the
 * answer because they are what most often moved.
 */
const FIELDS: Array<{
  field: keyof RunSettingsRow;
  label: string;
  group: DiffGroup;
  read: (r: RunSettingsRow) => string | null;
}> = [
  { field: 'symbol', label: 'Symbol', group: 'scope', read: (r) => asText(r.symbol) },
  { field: 'timeframe', label: 'Timeframe', group: 'scope', read: (r) => asText(r.timeframe) },
  { field: 'protocolId', label: 'Protocol', group: 'scope', read: (r) => asText(r.protocolId) },
  { field: 'startDate', label: 'Window start', group: 'scope', read: (r) => iso(r.startDate) },
  { field: 'endDate', label: 'Window end', group: 'scope', read: (r) => iso(r.endDate) },
  { field: 'periodId', label: 'Captured period', group: 'scope', read: (r) => asText(r.periodId) },
  { field: 'newsExclusion', label: 'News-day bars', group: 'scope', read: (r) => asText(r.newsExclusion) ?? 'none' },
  // ⚠️ A DIRECTION CHANGE IS A DIFFERENT QUESTION, NOT A DIFFERENT SETTING (#1155). A long run and a
  // short run over the same window are the two halves of the same experiment; listing it in `scope`
  // means a comparison can never report "everything the same" between them.
  { field: 'directionMode', label: 'Sides allowed', group: 'scope', read: (r) => asText(r.directionMode) ?? 'long' },
  // ⚠️ WHICH MECHANISM CHOSE THE WINDOW (#1141/#1132). `startDate`/`endDate` cannot show this: two
  // `days-range` runs made on different days cover different data with identical-looking dates, and a
  // `days-range` run is not reproducible the way a `period:<name>` run is. In `scope` because it decides
  // WHAT was measured, not how big the position was.
  { field: 'windowSource', label: 'Window mechanism', group: 'scope', read: (r) => asText(r.windowSource) },

  { field: 'positionModel', label: 'Position model', group: 'sizing', read: (r) => asText(r.positionModel) },
  { field: 'accountSize', label: 'Account size', group: 'sizing', read: (r) => asMoney(r.accountSize) },
  { field: 'riskPct', label: 'Risk per trade', group: 'sizing', read: (r) => asPctLiteral(r.riskPct) },
  // ⚠️ THE CAP IS PART OF THE SIZING (#1142/#1141): the same account at 1x and 10x commits different
  // notional per trade, so two runs that differ only here describe different money.
  { field: 'maxLeverage', label: 'Notional cap', group: 'sizing', read: (r) => (r.maxLeverage == null ? null : `${r.maxLeverage}×`) },
  // ⚠️ #1170 — THE STEP IS A SIZING SETTING, and the most consequential one for a CFD: 0.1 vs 1 is
  // "0.2 lots were bought" vs "every trade was refused". Rendering it as "whole units" rather than
  // `null` would claim the broker said 1, which it never did.
  { field: 'unitStep', label: 'Size step', group: 'sizing', read: (r) => (r.unitStep == null ? null : `${r.unitStep} units`) },
  { field: 'fixedAmount', label: 'Fixed amount', group: 'sizing', read: (r) => asMoney(r.fixedAmount) },
  // ⚠️ #1143 — THE MODEL THAT COMES FROM THE BOT. `fixedUnits` NULL is not "no size": it is "this model
  // derived its size from equity", which is exactly the 5× difference the issue measured between a live
  // gold bot ($4,015) and its simulation ($20,074). A pair differing only here is not a like-for-like one.
  { field: 'fixedUnits', label: 'Constant size', group: 'sizing', read: (r) => (r.fixedUnits == null ? null : `${r.fixedUnits} units`) },
  { field: 'botBaseSize', label: 'Bot lot size', group: 'sizing', read: (r) => asNum(r.botBaseSize) },

  { field: 'spread', label: 'Spread (of price)', group: 'costs', read: (r) => asPct(r.spread) },
  { field: 'slippage', label: 'Slippage per leg', group: 'costs', read: (r) => asPct(r.slippage) },
  { field: 'commission', label: 'Commission', group: 'costs', read: (r) => asPct(r.commission) },

  { field: 'botId', label: 'Driven by bot', group: 'provenance', read: (r) => (r.botId ? String(r.botId).slice(0, 8) : 'not bot-driven') },
  { field: 'configVersion', label: 'Override version', group: 'provenance', read: (r) => asNum(r.configVersion) },
  { field: 'iteration', label: 'Iteration', group: 'provenance', read: (r) => asNum(r.iteration) },
];

/**
 * The field names this module compares. EXPORTED for the completeness guard
 * (`run-differences-coverage.spec.ts`), which fails when `BacktestRun` gains a stored column that is
 * neither diffed nor declared as deliberately excluded.
 */
export const DIFF_FIELD_NAMES: string[] = FIELDS.map((f) => String(f.field));
// ── DECISION (2026-11-01, primary) ──
// WHAT:      Every scalar column of `BacktestRun` must be DIFFED or explicitly declared EXCLUDED, and
//            the comparison states the run order its positional `values` are aligned to.
// WHY:       `maxLeverage` and `windowSource` were stored on every run from the day they were added
//            and read by nothing, so a 1× run and a 4× run compared as "everything the same" while
//            their P&L differed by 15,924.74 (-15,763.42 vs -31,688.16). Nothing failed. A column
//            that is never diffed is a column that may as well not exist, and a positional array with
//            an unstated order lets a reader print A's settings under B's heading.
// INSTEAD OF: Trusting each new column to be remembered. Forgetting is the default, not the exception.
// REVERSE BY: Deleting `run-differences-coverage.spec.ts` and the `order` field. The consequence is
//            that the next stored setting can go un-diffed again, so record the reason in row 117.
// REGISTER:  docs/SETTLED-DECISIONS.md row 117
// GUARD:     run-differences.spec.ts (per-field detection, canaried both ways) and
//            run-differences-coverage.spec.ts (column-list completeness, canaried both ways)

/**
 * Compare the settings of 2+ runs. Runs must be passed in the order they should be displayed; each
 * row's `values` is aligned to that order.
 */
export function describeRunDifferences(rows: RunSettingsRow[]): RunDifferenceSet {
  const changed: RunDifferenceRow[] = [];
  const same: RunDifferenceSet['same'] = [];

  if (!Array.isArray(rows) || rows.length < 2) {
    // One run has nothing to differ FROM. Returning an empty diff is honest; returning "all same"
    // would claim a comparison that was never made. `order` still reports the row it was given, so a
    // consumer can tell "one run" from "no runs".
    return { changed, same, changedCount: 0, sameCount: 0, order: rows.map((r) => r.id) };
  }

  for (const f of FIELDS) {
    const values = rows.map((r) => f.read(r));
    const unrecorded = values.some((v) => v == null);
    // A null and a null are the same absence; a null and a value are NOT the same setting.
    const distinct = new Set(values.map((v) => (v == null ? '\u0000null' : v)));
    if (distinct.size === 1 && !unrecorded) {
      same.push({ field: String(f.field), label: f.label, group: f.group, value: values[0]!, unrecorded: false });
    } else if (distinct.size === 1 && unrecorded) {
      // Both sides recorded nothing. That is a shared gap, not a shared setting.
      same.push({ field: String(f.field), label: f.label, group: f.group, value: 'not recorded', unrecorded: true });
    } else {
      changed.push({ field: String(f.field), label: f.label, group: f.group, values, unrecorded });
    }
  }

  return { changed, same, changedCount: changed.length, sameCount: same.length, order: rows.map((r) => r.id) };
}
