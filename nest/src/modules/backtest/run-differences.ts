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

  { field: 'positionModel', label: 'Position model', group: 'sizing', read: (r) => asText(r.positionModel) },
  { field: 'accountSize', label: 'Account size', group: 'sizing', read: (r) => asMoney(r.accountSize) },
  { field: 'riskPct', label: 'Risk per trade', group: 'sizing', read: (r) => asPctLiteral(r.riskPct) },
  { field: 'fixedAmount', label: 'Fixed amount', group: 'sizing', read: (r) => asMoney(r.fixedAmount) },
  { field: 'botBaseSize', label: 'Bot lot size', group: 'sizing', read: (r) => asNum(r.botBaseSize) },

  { field: 'spread', label: 'Spread (of price)', group: 'costs', read: (r) => asPct(r.spread) },
  { field: 'slippage', label: 'Slippage per leg', group: 'costs', read: (r) => asPct(r.slippage) },
  { field: 'commission', label: 'Commission', group: 'costs', read: (r) => asPct(r.commission) },

  { field: 'botId', label: 'Driven by bot', group: 'provenance', read: (r) => (r.botId ? String(r.botId).slice(0, 8) : 'not bot-driven') },
  { field: 'configVersion', label: 'Override version', group: 'provenance', read: (r) => asNum(r.configVersion) },
  { field: 'iteration', label: 'Iteration', group: 'provenance', read: (r) => asNum(r.iteration) },
];

/**
 * Compare the settings of 2+ runs. Runs must be passed in the order they should be displayed; each
 * row's `values` is aligned to that order.
 */
export function describeRunDifferences(rows: RunSettingsRow[]): RunDifferenceSet {
  const changed: RunDifferenceRow[] = [];
  const same: RunDifferenceSet['same'] = [];

  if (!Array.isArray(rows) || rows.length < 2) {
    // One run has nothing to differ FROM. Returning an empty diff is honest; returning "all same"
    // would claim a comparison that was never made.
    return { changed, same, changedCount: 0, sameCount: 0 };
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

  return { changed, same, changedCount: changed.length, sameCount: same.length };
}
