import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
// ⚠️ Errors come from the notice REGISTRY, never from prose (#826) — a hand-written error string
// fails `validate-notices.cjs` at build time.
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import ChangeStat from '../components/ChangeStat';
// The window maths lives in ONE module, shared with SymbolChangePanel. Two copies would drift,
// and the surfaces would then disagree about the same account with neither obviously wrong.
import { DAY_MS, money, pct, splitWindows, weeklySeries, groupBy, asTradeList } from '../core/performance-change';
import './performance-change.css';

/**
 * PerformanceChangePage — "is it still working?", asked as a CHANGE question.
 * ==========================================================================
 *
 * ── DECISION (2026-09-28) ────────────────────────────────────────────────────────────────────
 * WHAT:  A Development-area page that shows period-over-period CHANGE per symbol and per bot,
 *        rather than cumulative totals.
 * WHY:   A total cannot distinguish a system recovering from a bad week from a system decaying
 *        from a good one. Owner, 2026-09-28: *"We're at the point when we need to see not just
 *        total performance but performance change."* Measured the same day: of ~100 trading pages,
 *        only PerformanceLabPage had a time axis at all, and the symbol page called six endpoints
 *        with no history among them.
 * INSTEAD OF: adding a chart library or a new endpoint. The data is already stored and already
 *        served by two endpoints that only READ — so this is a display problem, and it is solved
 *        here rather than in the API. See the endpoint note below.
 * REVERSE BY: removing the nav leaf and the route; nothing is persisted by this page.
 * GUARD:     `previous === null` renders "no comparison" and can never be drawn as 0 (see
 *            ChangeStat). That is the one behaviour worth guarding, because a zero here would
 *            read as a real measurement.
 *
 * ── ENDPOINTS — both are DB READS, verified, not assumed ─────────────────────────────────────
 * Owner constraint, 2026-09-28: *"just ensure you use the ones that query the database, not any
 * that actually re-generate data."*
 *
 *   GET /api/trading/trade-history      → TradeRecorderService.getHistory() — a `trade` read.
 *   GET /api/trading/portfolio-snapshots → prisma.portfolioSnapshot.findMany() — a stored series.
 *
 * ⚠️ Deliberately NOT used: any GET under `/api/scoring` that recomputes (runs, degradation,
 * accuracy). Several of those are GETs that generate work, and on a live demo account that is a
 * side effect a reporting page must not cause. Nothing on this page writes.
 *
 * ── WHAT IS DELIBERATELY NOT SHOWN ───────────────────────────────────────────────────────────
 * ⚠️ No give-back / peak analysis. That needs `marketbar` joined per trade, which is not exposed by
 * any read-only endpoint here, and doing it client-side would mean fetching thousands of bars. It
 * belongs in the API and is tracked in #1015 / #998.
 */

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 28, label: '28 days' },
];

function EntityTable({ title, note, rows, windowLabel, onInspect }) {
  if (!rows.length) {
    return (
      <section className="pc-section">
        <h3>{title}</h3>
        <p className="pc-empty">
          Nothing traded in the last {windowLabel} or the {windowLabel} before it, so there is no
          change to report.
        </p>
      </section>
    );
  }
  return (
    <section className="pc-section">
      <h3>{title}</h3>
      {note && <p className="pc-note">{note}</p>}
      <div className="pc-table-wrap">
        <table className="pc-table">
          <thead>
            <tr>
              <th>Entity</th>
              <th>Last {windowLabel}</th>
              <th>Prior {windowLabel}</th>
              <th>Change</th>
              <th>Trades</th>
              <th>Win rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className={onInspect ? 'pc-row--clickable' : undefined}
                onClick={onInspect ? () => onInspect(r.key) : undefined}
              >
                <td className="pc-entity">{r.key}</td>
                <td className={r.current != null && r.current < 0 ? 'pc-neg' : undefined}>
                  {money(r.current)}
                </td>
                <td>{r.previous == null ? <span className="pc-unknown">no data</span> : money(r.previous)}</td>
                <td>
                  {r.previous == null || r.current == null ? (
                    // ⚠️ Explicitly not 0. See ChangeStat's header.
                    <span className="pc-unknown">no comparison</span>
                  ) : (
                    <span className={r.current - r.previous >= 0 ? 'pc-pos' : 'pc-neg'}>
                      {money(r.current - r.previous)}
                    </span>
                  )}
                </td>
                <td>
                  {r.recentCount}
                  {r.priorCount !== r.recentCount && (
                    <span className="pc-sub"> / {r.priorCount}</span>
                  )}
                </td>
                <td>
                  {r.recentWinRate == null ? '—' : pct(r.recentWinRate)}
                  {r.priorWinRate != null && r.recentWinRate != null && (
                    <span className="pc-sub"> / {pct(r.priorWinRate)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function PerformanceChangePage() {
  const [windowDays, setWindowDays] = useState(7);

  // `days` must exceed both windows or the prior period is truncated and every comparison is
  // silently against a partial window. 4× the window keeps history for the sparklines too.
  const days = Math.max(windowDays * 4, 56);

  const tradesQuery = useQuery({
    queryKey: ['pc-trades', days],
    queryFn: () => apiGet(`/api/trading/trade-history?days=${days}&limit=1000`).catch(() => null),
    refetchInterval: 60_000,
    retry: 1,
  });

  const snapshotsQuery = useQuery({
    queryKey: ['pc-snapshots'],
    queryFn: () => apiGet('/api/trading/portfolio-snapshots?limit=50').catch(() => null),
    refetchInterval: 120_000,
    retry: 1,
  });

  const trades = useMemo(() => asTradeList(tradesQuery.data), [tradesQuery.data]);

  const nowMs = useMemo(() => Date.now(), []);
  const windowMs = windowDays * DAY_MS;
  const weekLabel = `${windowDays}d`;

  const account = useMemo(() => splitWindows(trades, windowMs, nowMs), [trades, windowMs, nowMs]);
  const accountSeries = useMemo(() => weeklySeries(trades, 10, nowMs), [trades, nowMs]);

  const symbolRows = useMemo(() => {
    const g = groupBy(trades, (t) => (t.symbol || '').toUpperCase() || null);
    return [...g.entries()]
      .map(([key, arr]) => ({ key, ...splitWindows(arr, windowMs, nowMs), series: weeklySeries(arr, 10, nowMs) }))
      // ⚠️ Drop entities with NO trades in either window. Seen live 2026-09-28: symbols whose only
      // trades fell outside both periods rendered as `— no data no comparison 0 —`, which is rows
      // of pure noise competing with the rows that carry a finding. An entity with no activity in
      // the compared periods has nothing to say about CHANGE — it belongs in a totals view, not here.
      .filter((r) => r.recentCount > 0 || r.priorCount > 0)
      .sort((a, b) => Math.abs((b.current ?? 0) - (b.previous ?? 0)) - Math.abs((a.current ?? 0) - (a.previous ?? 0)));
  }, [trades, windowMs, nowMs]);

  const botRows = useMemo(() => {
    const g = groupBy(trades, (t) => t.strategy || null);
    return [...g.entries()]
      .map(([key, arr]) => ({ key, ...splitWindows(arr, windowMs, nowMs), series: weeklySeries(arr, 10, nowMs) }))
      .filter((r) => r.recentCount > 0 || r.priorCount > 0)
      .sort((a, b) => Math.abs((b.current ?? 0) - (b.previous ?? 0)) - Math.abs((a.current ?? 0) - (a.previous ?? 0)));
  }, [trades, windowMs, nowMs]);

  const snapshots = snapshotsQuery.data?.snapshots || [];

  return (
    <div className="pc-page">
      <header className="pc-header">
        <div>
          <h2>Performance Change</h2>
          <p className="pc-note">
            Period over period, from closed trades and stored snapshots. A total says how much —
            this says whether it is still working.
          </p>
        </div>
        <div className="pc-controls" role="group" aria-label="Comparison window">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              className={w.days === windowDays ? 'pc-btn pc-btn--on' : 'pc-btn'}
              aria-pressed={w.days === windowDays}
              onClick={() => setWindowDays(w.days)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </header>

      {/* ⚠️ A failed read must NOT render as an empty table. `null` (the .catch) is the absence of
          information; `[]` is information. They are different states and are shown differently. */}
      {tradesQuery.data === null && (
        <NoticeBlock
          notice={noticeFromError(
            tradesQuery.error || new Error('trade-history unavailable'),
            'TCS-SYS-007',
            { operation: 'load closed trades for the change comparison' },
          )}
        />
      )}

      {tradesQuery.isLoading && <p className="pc-empty">Loading closed trades…</p>}

      {tradesQuery.data !== null && !tradesQuery.isLoading && trades.length === 0 && (
        <p className="pc-empty">
          The history endpoint answered and returned <strong>no closed trades</strong> in the last {days} days.
          That is a real result, not a failure — there is simply nothing to compare yet.
        </p>
      )}

      {trades.length > 0 && (
        <>
          <section className="pc-section">
            <h3>Account — all closed trades</h3>
            <div className="change-stat-row">
              <ChangeStat
                label="Closed P&L"
                current={account.current}
                previous={account.previous}
                series={accountSeries}
                format={money}
                hint={`last ${weekLabel} vs prior ${weekLabel}`}
                unavailableReason={
                  account.priorCount === 0
                    ? `no trades closed in the prior ${weekLabel} — nothing to compare against`
                    : 'no trades in this window'
                }
              />
              <ChangeStat
                label="Win rate"
                current={account.recentWinRate}
                previous={account.priorWinRate}
                format={pct}
                hint={`last ${weekLabel} vs prior ${weekLabel}`}
                unavailableReason={`fewer than one trade in the prior ${weekLabel}`}
              />
              <ChangeStat
                label="Trades closed"
                current={account.recentCount}
                previous={account.priorCount}
                format={(v) => (v == null ? '—' : String(v))}
                hint={`last ${weekLabel} vs prior ${weekLabel}`}
              />
            </div>
          </section>

          <EntityTable
            title="By symbol"
            note="Sorted by the size of the change. “no comparison” means the prior period had no trades — it is not a change of zero."
            rows={symbolRows}
            windowLabel={weekLabel}
          />

          <EntityTable
            title="By bot"
            note="Trades whose stored strategy name matches no bot appear under the raw name they carry."
            rows={botRows}
            windowLabel={weekLabel}
          />
        </>
      )}

      <section className="pc-section">
        <h3>Stored account snapshots</h3>
        {snapshotsQuery.isLoading && <p className="pc-empty">Loading snapshots…</p>}
        {!snapshotsQuery.isLoading && snapshots.length === 0 && (
          <p className="pc-empty">
            No snapshots stored. <strong>This is not the same as an unchanged account</strong> — it means
            nothing has been recorded to compare, so no equity change can be shown here.
          </p>
        )}
        {snapshots.length > 0 && (
          <div className="change-stat-row">
            {snapshots.slice(0, 6).map((s, i) => {
              const prev = snapshots[i + 1];
              return (
                <ChangeStat
                  key={s.id || i}
                  label={s.type || 'snapshot'}
                  current={s.totalPnl ?? null}
                  previous={prev?.totalPnl ?? null}
                  format={money}
                  hint={s.takenAt ? new Date(s.takenAt).toLocaleString() : undefined}
                  unavailableReason={!prev ? 'oldest stored snapshot — no predecessor to compare' : undefined}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
