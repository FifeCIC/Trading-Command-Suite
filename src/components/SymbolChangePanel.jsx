import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import {
  DAY_MS,
  money,
  pct,
  splitWindows,
  weeklySeries,
  asTradeList,
} from '../core/performance-change';
import ChangeStat from './ChangeStat';

/**
 * SymbolChangePanel — "is this symbol still working?", on the single-symbol page.
 * ================================================================================
 *
 * ── WHY IT IS A SEPARATE COMPONENT ───────────────────────────────────────────────────────────
 * `SymbolPage.jsx` is a large file, and it called SIX endpoints — none of them a history call.
 * Measured 2026-09-28: the page rendered 8 stat tiles and several distributions, all of them
 * snapshots. A reader could see where the symbol is, never whether it is getting better or worse.
 *
 * Keeping the fetch and the window maths in one small component means the host page needs a single
 * import and one element — no restructuring of a file that other work is actively editing.
 *
 * ── ENDPOINT — a verified DB read, not assumed from its name ─────────────────────────────────
 * Owner constraint, 2026-09-28: *"just ensure you use the ones that query the database, not any
 * that actually re-generate data."*
 * `GET /api/trading/trade-history` → `TradeRecorderService.getHistory()` — a read of the `trade`
 * table with symbol/days/limit filters. The `/api/scoring` GETs that recompute are deliberately
 * avoided: a reporting panel must not cause a side effect on a live account.
 *
 * ⚠️ NO PEAK / GIVE-BACK HERE. That needs `marketbar` joined per trade, which no read-only endpoint
 * exposes; fetching bars client-side would mean thousands of rows. It belongs in the API (#1015).
 */

/** Days of history to pull. 4× the window so both periods and the sparkline are fully covered. */
const HISTORY_DAYS = 120;
const WINDOW_DAYS = 7;

export default function SymbolChangePanel({ symbol }) {
  const query = useQuery({
    queryKey: ['symbol-change', symbol],
    queryFn: () =>
      apiGet(`/api/trading/trade-history?symbol=${encodeURIComponent(symbol)}&days=${HISTORY_DAYS}&limit=500`).catch(
        () => null,
      ),
    refetchInterval: 60_000,
    retry: 1,
    enabled: Boolean(symbol),
  });

  const trades = useMemo(() => asTradeList(query.data), [query.data]);

  const change = useMemo(
    () => splitWindows(trades, WINDOW_DAYS * DAY_MS, Date.now()),
    [trades],
  );
  const series = useMemo(() => weeklySeries(trades, 12, Date.now()), [trades]);

  // Nothing measured yet. Rendered as a quiet line, NOT as zeroes — the distinction between "no
  // trades" and "flat performance" is the point of this whole block.
  if (!query.isLoading && trades.length === 0) {
    return (
      <section className="sym-card">
        <h2>Performance Change</h2>
        <p className="sym-muted sym-source-line">
          No closed trades recorded for {symbol} in the last {HISTORY_DAYS} days, so there is no
          change to show. That is a real result, not a failed read.
        </p>
      </section>
    );
  }

  return (
    <section className="sym-card">
      <h2>Performance Change</h2>
      <p className="sym-muted sym-source-line">
        Closed P&amp;L for {symbol}, last {WINDOW_DAYS} days against the {WINDOW_DAYS} days before it.
        A total says how much; this says whether it is still working.
      </p>

      {query.isLoading ? (
        <p className="sym-muted">Loading closed trades…</p>
      ) : (
        <div className="change-stat-row">
          <ChangeStat
            label="Closed P&L"
            current={change.current}
            previous={change.previous}
            series={series}
            format={money}
            hint={`last ${WINDOW_DAYS}d vs prior ${WINDOW_DAYS}d · sparkline is weekly`}
            unavailableReason={
              change.priorCount === 0
                ? `no trades closed in the prior ${WINDOW_DAYS} days — nothing to compare against`
                : 'no trades closed in this window'
            }
          />
          <ChangeStat
            label="Win rate"
            current={change.recentWinRate}
            previous={change.priorWinRate}
            format={pct}
            hint={`last ${WINDOW_DAYS}d vs prior ${WINDOW_DAYS}d`}
            unavailableReason={`fewer than one trade in the prior ${WINDOW_DAYS} days`}
          />
          <ChangeStat
            label="Trades closed"
            current={change.recentCount}
            previous={change.priorCount}
            format={(v) => (v == null ? '—' : String(v))}
            hint={`last ${WINDOW_DAYS}d vs prior ${WINDOW_DAYS}d`}
          />
        </div>
      )}
    </section>
  );
}
