import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { formatTime } from '../core/format-utils';
// ⚠️ Errors come from the notice REGISTRY, never from prose (#826). A hand-written error string
// fails `validate-notices.cjs` at build time — which is how this page was caught, and correctly.
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
// The shared platform stylesheet already defines the card/header/control classes this page uses,
// so there is nothing to re-invent and no chance of referencing a token that does not exist.
import './trading-platforms.css';
import './blocked-signals.css';

/**
 * BlockedSignalsPage — "why didn't it trade?", answered from the database (#974).
 *
 * ── DECISION (2026-09-25, primary) ────────────────────────────────────────────────────────────
 * WHAT:  Shows the funnel's EXIT REASONS — what signalled, and which gate stopped it.
 * WHY:   Until 2026-09-25 this answer existed ONLY as a line in `api-out.log`
 *        (`Queue skip: <protocol> signalled but blocked pre-trade [...]`). Every investigation into
 *        "nothing traded" therefore began with grepping a log file, and the single most useful
 *        number in the app was the one nobody could see.
 * INSTEAD OF: Re-implementing the gate logic in the UI to work out why. The reason is now
 *        PERSISTED by the gate that made the decision (`automation_event.step =
 *        'pre_trade_blocked'` with a machine `cause`), and this page only renders it.
 * REVERSE BY: removing the route + nav leaf; the persisted events stay, so no data is lost.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 36
 * GUARD:     `cause` is asserted in the signals/automation suites; the endpoint is SQL-free.
 *
 * ⚠️ REGISTER ROW 36 IS A DESIGN CONSTRAINT, NOT A COMMENT: **a thin funnel is NOT a fault.** A
 * block is the filter working. This page must never be framed as "where signals die" — its job is
 * to say WHICH rule fired, so a healthy pipeline does not read as a broken one. That is why
 * `EXPECTED` and `INVESTIGATE` are separated below rather than pooled into one alarming total.
 */

/**
 * Plain-English for each machine cause, plus which ones deserve a second look.
 *
 * `tone` is the point of this table:
 *   expected    — the gates doing their job. A high count here is HEALTH, not a problem.
 *   data        — the symbol could not be judged (closed, stale, missing). Neutral.
 *   investigate — the pipeline could not explain itself, or a real defect stopped it.
 *
 * ⚠️ An unknown cause falls through to `uncoded` and is shown as `investigate`. That is deliberate:
 * a cause the UI does not recognise must look like a gap, never like a normal block.
 */
const CAUSE_INFO = {
  BELOW_GATE: { label: 'Signal below the gate', tone: 'expected', detail: 'Scored, but under the threshold the gate requires. The commonest block by far.' },
  DIRECTIVE_CONFLICT: { label: 'Directives disagree', tone: 'expected', detail: 'Two or more directives returned high-severity opposite readings.' },
  HARD_GATE: { label: 'Risk hard gate fired', tone: 'expected', detail: 'A risk rule vetoed the signal outright.' },
  RISK_MULTIPLIER_LOW: { label: 'Risk multiplier critically low', tone: 'expected', detail: 'Below 0.3 — the risk engine has shrunk position appetite to near zero.' },
  DISMISSED: { label: 'Dismissed', tone: 'expected', detail: 'A person dismissed this signal, so it was not queued.' },
  MARKET_UNAVAILABLE: { label: 'Market closed or stale', tone: 'data', detail: 'The symbol had no open, current market at decision time.' },
  STALE_CADENCE: { label: 'Every cadence stale', tone: 'data', detail: 'No current market data at all — not scored rather than scored off old bars (#827).' },
  INCOMPLETE_MTF: { label: 'Incomplete timeframe bundle', tone: 'data', detail: 'A multi-timeframe directive needs more history than was available.' },
  NO_MARKET_DATA: { label: 'No market data', tone: 'data', detail: 'Nothing to score against.' },
  NOT_IN_PROTOCOL: { label: 'Not in any active protocol', tone: 'data', detail: 'The symbol is not covered by a protocol, so no score is produced.' },
  EXECUTION_BLOCKER: { label: 'Execution blocker', tone: 'investigate', detail: 'The signal was viable but could not be turned into an order.' },
  NO_DIRECTION: { label: 'No derivable direction', tone: 'investigate', detail: 'The signal class could not be mapped to a side — a code/data mismatch, not a filter.' },
  NO_SCORE_LINEAGE: { label: 'No score lineage', tone: 'investigate', detail: 'The envelope has no score id, so the decision cannot be traced back.' },
  UNCODED: { label: 'Uncoded', tone: 'investigate', detail: 'Blocked by a path that does not yet assign a cause, or recorded before causes existed.' },
  UNPARSABLE_DETAIL: { label: 'Unreadable detail', tone: 'investigate', detail: 'The stored detail could not be parsed.' },
};

function infoFor(cause) {
  return CAUSE_INFO[cause] || {
    label: cause,
    tone: 'investigate',
    detail: 'Unknown cause code — it is shown as needing attention rather than silently treated as normal.',
  };
}

const WINDOWS = [
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
  { hours: 336, label: '14 days' },
];

export default function BlockedSignalsPage() {
  const [hours, setHours] = useState(24);
  const [tone, setTone] = useState('ALL');

  const blocksQuery = useQuery({
    queryKey: ['pre-trade-blocks', hours],
    queryFn: () => apiGet(`/api/automation/pre-trade-blocks?hours=${hours}`),
    refetchInterval: 60_000,
  });

  const byCause = Array.isArray(blocksQuery.data?.byCause) ? blocksQuery.data.byCause : [];
  const bySymbol = Array.isArray(blocksQuery.data?.bySymbol) ? blocksQuery.data.bySymbol : [];
  const total = Number(blocksQuery.data?.total) || 0;

  // Group the causes by what the reader should DO about them. Pooling all three into one number is
  // how healthy filtering comes to look like an outage.
  const toneTotals = useMemo(() => {
    const acc = { expected: 0, data: 0, investigate: 0 };
    for (const row of byCause) {
      const t = infoFor(row.cause).tone;
      if (acc[t] !== undefined) acc[t] += row.count;
    }
    return acc;
  }, [byCause]);

  const visibleSymbols = useMemo(
    () => (tone === 'ALL' ? bySymbol : bySymbol.filter((r) => infoFor(r.cause).tone === tone)),
    [bySymbol, tone],
  );

  return (
    <div className="trading-platforms-page blocked-signals-page">
      <header className="tp-page-header">
        <h1>Blocked Signals</h1>
        <p>
          What signalled, and which gate stopped it. Every row is a decision the pipeline made and
          recorded — answerable here instead of by grepping a log.
        </p>
        <p className="tp-source-meta">
          Source: automation_event (step=pre_trade_blocked) · window {hours}h · refreshes every 60 seconds
        </p>
      </header>

      {/* ⚠️ This framing is a decision (register row 36), not reassurance. Without it the page reads
          as a fault list and a correctly-filtering pipeline looks broken. */}
      <section className="tp-card bs-framing">
        <h3>Read this first</h3>
        <p className="bs-framing-text">
          <strong>A block is the filter working, not a failure.</strong> A signal that fails
          <em> below the gate</em> or <em>directive conflict</em> was correctly rejected. Those are
          counted as <strong>Expected</strong> below. Only <strong>Investigate</strong> means
          something could not explain itself.
        </p>
      </section>

      <section className="tp-card tp-controls-card">
        <h3>Window</h3>
        <div className="tp-controls-grid il-items-end">
          <label className="tp-control">
            <span>Period</span>
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {WINDOWS.map((w) => (
                <option key={w.hours} value={w.hours}>{w.label}</option>
              ))}
            </select>
          </label>
          <label className="tp-control">
            <span>Show</span>
            <select value={tone} onChange={(e) => setTone(e.target.value)}>
              <option value="ALL">All blocks</option>
              <option value="expected">Expected filtering only</option>
              <option value="data">Data / market only</option>
              <option value="investigate">Investigate only</option>
            </select>
          </label>
        </div>
      </section>

      {blocksQuery.isLoading && <section className="tp-card"><p>Loading…</p></section>}

      {/* An error and an empty result must never render the same (§7, make silence visible). The
          notice carries the distinction in its registered wording, so this cannot drift from every
          other load failure in the app. */}
      {blocksQuery.isError && (
        <section className="tp-card">
          <NoticeBlock
            notice={noticeFromError(blocksQuery.error, 'TCS-SYS-007', {
              operation: 'load blocked signals — this is a FAILED QUERY, not an empty result',
            })}
          />
        </section>
      )}

      {!blocksQuery.isLoading && !blocksQuery.isError && total === 0 && (
        <section className="tp-card">
          <p className="bs-empty">
            No blocks recorded in this window. Either nothing was filtered, or the loop has not
            produced a scored pair since the cause was first stored — this is an empty result, not a
            failure to read one.
          </p>
        </section>
      )}

      {total > 0 && (
        <>
          <section className="tp-card">
            <h3>By what the reader should do about it</h3>
            <div className="bs-tone-grid">
              <button
                type="button"
                className={`bs-tone bs-tone-expected${tone === 'expected' ? ' is-active' : ''}`}
                onClick={() => setTone(tone === 'expected' ? 'ALL' : 'expected')}
              >
                <span className="bs-tone-count">{toneTotals.expected.toLocaleString()}</span>
                <span className="bs-tone-label">Expected</span>
                <span className="bs-tone-note">The gates rejecting weak or conflicting signals</span>
              </button>
              <button
                type="button"
                className={`bs-tone bs-tone-data${tone === 'data' ? ' is-active' : ''}`}
                onClick={() => setTone(tone === 'data' ? 'ALL' : 'data')}
              >
                <span className="bs-tone-count">{toneTotals.data.toLocaleString()}</span>
                <span className="bs-tone-label">Data / market</span>
                <span className="bs-tone-note">Closed, stale or missing — could not be judged</span>
              </button>
              <button
                type="button"
                className={`bs-tone bs-tone-investigate${tone === 'investigate' ? ' is-active' : ''}`}
                onClick={() => setTone(tone === 'investigate' ? 'ALL' : 'investigate')}
              >
                <span className="bs-tone-count">{toneTotals.investigate.toLocaleString()}</span>
                <span className="bs-tone-label">Investigate</span>
                <span className="bs-tone-note">The pipeline could not explain itself</span>
              </button>
            </div>
            <p className="bs-footnote">
              {total.toLocaleString()} block event(s) in this window. One signal can be blocked
              repeatedly, so this counts decisions, not distinct signals.
            </p>
          </section>

          <section className="tp-card">
            <h3>By cause</h3>
            <table className="bs-table">
              <thead>
                <tr>
                  <th>Cause</th>
                  <th className="bs-num">Count</th>
                  <th>What it means</th>
                </tr>
              </thead>
              <tbody>
                {byCause.map((row) => {
                  const info = infoFor(row.cause);
                  return (
                    <tr key={row.cause}>
                      <td>
                        <span className={`bs-pill bs-pill-${info.tone}`}>{info.label}</span>
                        <span className="bs-code">{row.cause}</span>
                      </td>
                      <td className="bs-num">{row.count.toLocaleString()}</td>
                      <td className="bs-detail">{info.detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="tp-card">
            <h3>By symbol{tone === 'ALL' ? '' : ` — ${tone} only`}</h3>
            {visibleSymbols.length === 0 ? (
              <p className="bs-empty">No blocks in this window for the selected filter.</p>
            ) : (
              <table className="bs-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Cause</th>
                    <th className="bs-num">Count</th>
                    <th>Last</th>
                    <th>Latest reason</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSymbols.map((row) => {
                    const info = infoFor(row.cause);
                    return (
                      <tr key={`${row.symbol}|${row.cause}`}>
                        <td className="bs-symbol">{row.symbol}</td>
                        <td><span className={`bs-pill bs-pill-${info.tone}`}>{info.label}</span></td>
                        <td className="bs-num">{row.count.toLocaleString()}</td>
                        <td className="bs-time">{formatTime(row.lastAt)}</td>
                        <td className="bs-reason">{row.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
