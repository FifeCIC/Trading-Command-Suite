/**
 * best-record.js — the view model for the best-record panel, kept out of the component so its states
 * are testable without a browser (#1341).
 *
 * ── THE THREE STATES THAT MUST NOT COLLAPSE INTO ONE ─────────────────────────────────────────────
 * A server that does not send `best`  → `unsupported`  (nothing is claimed)
 * A store with no record yet          → `first-run`    (a claim: nothing has been recorded)
 * A run measured against a record     → `has-record` / `new-record`
 *
 * Rendering any of those as the others is a claim about history the reader cannot check.
 *
 * ── ⚠️ THE BASIS IS PER DAY ─────────────────────────────────────────────────────────────────────
 * A record is decided on net P/L per measured day, so the panel prints the per-day figure first and
 * the raw total beside it — a derived number must never hide the data it came from.
 */

/** The typographic minus, so a negative comparison is not read as a hyphen. */
export const MINUS = '\u2212';

/**
 * Which settings the record holds that the current run does not.
 *
 * ⚠️ A value absent on either side is `unknown`, never `same`. A setting the run does not report
 * cannot be claimed to match one the record does — and "same" is the state that stops a reader
 * looking.
 */
export function settingsDiff(bestConfig, currentFields) {
  if (!Array.isArray(bestConfig)) return [];
  const current = new Map(
    (Array.isArray(currentFields) ? currentFields : []).map((f) => [f?.id, f?.value]),
  );
  return bestConfig
    .filter((f) => f && typeof f.id === 'string')
    .map((f) => {
      const now = current.has(f.id) ? current.get(f.id) : undefined;
      const nowText = now === undefined || now === null ? null : String(now);
      const thenText = f.value === undefined || f.value === null ? null : String(f.value);
      const state = nowText == null || thenText == null
        ? 'unknown'
        : nowText === thenText ? 'same' : 'differs';
      return { id: f.id, best: thenText, now: nowText, state };
    });
}

/**
 * The panel's view model from the successful runs, in execution order.
 *
 * The LAST run is used for the record: the leg's record converges as runs proceed, and the last run
 * holds the freshest read of it. Summing `best` across days would count one record once per day.
 */
export function buildBestView(okRuns) {
  if (!Array.isArray(okRuns) || okRuns.length === 0) return null;
  const last = okRuns[okRuns.length - 1];
  if (!last || last.best === undefined) return { state: 'unsupported' };

  const { best, improved, previous, because } = last.best ?? {};
  const totals = last.totals ?? {};
  const thisRun = {
    perDay: totals.netPnl == null ? null : Number(totals.netPnl),
    netPnl: totals.netPnl == null ? null : Number(totals.netPnl),
    days: Number(totals.daysRanked ?? 1),
    trades: totals.trades ?? null,
    winRate: totals.winRate ?? null,
    profitFactor: best?.profitFactor ?? null,
  };

  return {
    state: best ? (improved ? 'new-record' : 'has-record') : 'first-run',
    because: because ?? null,
    best: best ?? null,
    previous: previous ?? null,
    thisRun,
    settingsDiff: improved && best ? settingsDiff(best.config, last.tradeConfig?.fields) : [],
  };
}

/** `+$12.34` / `−$12.34` / `$0.00` / `—`. Exported so the panel and its test format identically. */
export function moneySigned(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '$0.00';
  return `${v > 0 ? '+' : MINUS}$${Math.abs(v).toFixed(2)}`;
}
