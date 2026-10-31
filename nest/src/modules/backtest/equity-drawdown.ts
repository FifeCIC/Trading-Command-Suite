/**
 * computeEquityPath() — STEP 6b of the backtest reporting pipeline.
 *
 * BEFORE: `BacktestService.run()` closes bracket trades and stores them as `backtesttrade` rows.
 * HERE:   those trades are replayed in REALISATION order into a cumulative P&L path, and the worst
 *         peak-to-trough fall on that path is measured.
 * AFTER:  `GET /api/backtest/equity/:runId` serves the path and its summary; `EquityCurveChart`
 *         draws them, and the Result step's drawdown tile reads the same summary.
 *
 * ── WHY THIS IS A PURE FUNCTION (2026-10-30) ────────────────────────────────────────────────────
 * It was inline in `getEquityCurve()`, where three arithmetic defects survived because nothing could
 * exercise them without a database. Extracted so `equity-drawdown.spec.ts` can canary BOTH
 * directions — a losing path must report a fall, a winning path must report none — and so the
 * measured regression (8,867.70%) is a test rather than a comment.
 *
 * ── THE THREE DEFECTS IT REPLACES, ALL MEASURED ON RUN `7f00cfb8` ───────────────────────────────
 * (VIX 5m, 1,027 trades, `accountSize` 10,000, P&L −155,977.32 — `node logs/measure-drawdown.cjs`)
 *
 *  1. THE DENOMINATOR WAS THE PEAK *CUMULATIVE P&L*.
 *     `(peak − cumulative) / peak` divides a currency fall by the best running P&L, which was
 *     £1,809.62 — a fluke of one early winning trade — so a £161,068 fall was served as 8,867.70%.
 *     A percentage of a transient high is not a drawdown anyone can read: it grows without bound as
 *     the losses grow, which is the opposite of what a drawdown should do.
 *
 *  2. `peak > 0` MADE A MONOTONIC LOSER REPORT EXACTLY ZERO.
 *     A run that never goes positive leaves `peak` at 0, the guard short-circuits to 0, and the
 *     panel printed "−0.00%" over a run that lost the whole account (the owner reported it from
 *     screen). The currency amount is now always computed; only the PERCENTAGE can be absent.
 *
 *  3. THE PATH WAS IN THE WRONG ORDER.
 *     Trades arrived ordered by `entryDate` but were stamped with `exitDate`. Ordered by entry,
 *     117 of 1,027 points were out of chronological order, so `peakEquity` and the drawdown
 *     peak/trough were computed on a zig-zag. A trade is realised when it EXITS.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────────────────────────
 *   maxDrawdownAmount  currency. ALWAYS computable — it needs no denominator.
 *   maxDrawdownPct     percent of `accountSize`. NULL when the run recorded no capital, never 0,
 *                      because 0 is the claim "this run never fell".
 *   every point        `drawdownAmount` is always present; `drawdownPct` may be null.
 */

// ── DECISION (2026-10-30, primary) ──
// WHAT:      Drawdown is reported as a CURRENCY amount (always) and a PERCENTAGE OF ACCOUNT CAPITAL
//            (only when the run recorded `accountSize`). The percentage is `null`, never 0, when the
//            capital is unknown.
// WHY:       The old form divided the fall by the PEAK CUMULATIVE P&L, which is a fluke of one early
//            winning trade: run `7f00cfb8` served 8,867.70% for a £161,068 fall because its peak P&L
//            was £1,809.62. A percentage of a transient high grows without bound as losses grow, so
//            the worse the run, the less readable the number — the exact inverse of what it is for.
//            Capital is the only denominator a reader can interpret, and `null` distinguishes "cannot
//            judge" from "did not fall", which a 0 cannot.
// INSTEAD OF: Keeping a percentage-only contract and clamping it, or substituting a default 10,000
//            account for runs that recorded none (the fabrication #1141 removed from the cost columns).
// REVERSE BY: Restoring `(peak - cumulative) / peak` in both the summary and the per-point expression,
//            and re-accepting that a monotonic loser reports 0.
// REGISTER:  docs/SETTLED-DECISIONS.md row 102
// GUARD:     nest/src/modules/backtest/equity-drawdown.spec.ts — canaried in FIVE directions
//            (peak>0 guard, summary denominator, point denominator, missing sort, zero capital) plus
//            an unmodified control run; every mutation was observed to fail before this shipped.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n) => Math.round(n * 100) / 100;

const toMs = (v) => (v instanceof Date ? v.getTime() : Date.parse(String(v)));

export interface EquityPoint {
  time: string;
  equity: number;
  drawdownAmount: number;
  drawdownPct: number | null;
}

export interface EquitySummary {
  totalTrades: number;
  totalPnl: number;
  finalEquity: number;
  maxDrawdownAmount: number;
  maxDrawdownPct: number | null;
  maxDrawdownPctBasis: 'capital' | 'unavailable';
  accountSize: number | null;
  maxDrawdownStart: string | null;
  maxDrawdownEnd: string | null;
  peakEquity: number;
  peakDate: string | null;
  troughEquity: number;
}

export function computeEquityPath(
  trades: Array<{ pnl: number | string; exitDate: Date | string }>,
  opts: { runStart: Date | string; accountSize: number | null | undefined; totalPnl?: number },
): { equity: EquityPoint[]; summary: EquitySummary } {
  // Realisation order. A stable sort keeps same-instant trades in their stored order rather than
  // shuffling them, so the path is reproducible.
  const ordered = [...(trades ?? [])].sort((a, b) => toMs(a.exitDate) - toMs(b.exitDate));

  // A capital figure of 0 (or less) is NOT a denominator — it would make every percentage infinite.
  // Treated as absent, which is the honest reading: nothing usable was recorded.
  const accountSize =
    opts.accountSize != null && Number(opts.accountSize) > 0 ? Number(opts.accountSize) : null;

  const startIso = new Date(opts.runStart).toISOString();
  const equity: EquityPoint[] = [{ time: startIso, equity: 0, drawdownAmount: 0, drawdownPct: 0 }];

  let cumulative = 0;
  // The high-water mark of REALISED P&L, starting at the flat line. Starting at 0 is also what makes
  // defect 2 impossible: a first-trade loss has peak 0 and a real, non-zero fall.
  let peak = 0;
  let peakDate: string | null = null;
  let peakAt = startIso;
  let maxDrawdownAmount = 0;
  let maxDrawdownStart: string | null = null;
  let maxDrawdownEnd: string | null = null;
  let troughEquity = 0;

  for (const trade of ordered) {
    const at = new Date(trade.exitDate as any).toISOString();
    cumulative += num(trade.pnl);

    if (cumulative > peak) {
      peak = cumulative;
      peakDate = at;
      peakAt = at;
    }

    const drawdownAmount = peak - cumulative;
    if (drawdownAmount > maxDrawdownAmount) {
      maxDrawdownAmount = drawdownAmount;
      maxDrawdownStart = peakAt;
      maxDrawdownEnd = at;
      troughEquity = cumulative;
    }

    equity.push({
      time: at,
      equity: round2(cumulative),
      drawdownAmount: round2(drawdownAmount),
      drawdownPct: accountSize == null ? null : round2((drawdownAmount / accountSize) * 100),
    });
  }

  return {
    equity,
    summary: {
      totalTrades: ordered.length,
      // The stored total when given (it is the figure the run recorded), otherwise the path's own
      // sum — which must agree, and `equity-drawdown.spec.ts` asserts that it does.
      totalPnl: opts.totalPnl != null ? num(opts.totalPnl) : round2(cumulative),
      finalEquity: equity[equity.length - 1].equity,
      maxDrawdownAmount: round2(maxDrawdownAmount),
      maxDrawdownPct: accountSize == null ? null : round2((maxDrawdownAmount / accountSize) * 100),
      maxDrawdownPctBasis: accountSize == null ? 'unavailable' : 'capital',
      accountSize,
      maxDrawdownStart,
      maxDrawdownEnd,
      peakEquity: round2(peak),
      peakDate,
      troughEquity: round2(troughEquity),
    },
  };
}
