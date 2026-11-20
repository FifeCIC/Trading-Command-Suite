/**
 * MoversDepthPanel — ONE session, taken apart: the ladder, the bars, the decisions, the decomposition.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * A result row said "NXXT moved +430% at the cutoff, the strategy won 36% of its trades". Nothing in
 * the output explained the gap: a run keeps one composite per bar and a trade count, and the two were
 * never on the same axis. This panel puts them on one axis and links them, so "which bar, which
 * signal, which decision, which exit" is a place the reader can point at.
 *
 * ── WHAT IS RECORDED AND WHAT IS DERIVED (the honesty rule) ─────────────────────────────────────
 * RECORDED by the run, unchanged: bar instant, price, change against the previous session's close,
 * both scores, the risk multiplier, the signal class, the bar-gate verdict, and every trade's entry,
 * exit, direction, P/L and exit reason.
 * DERIVED on the server (`run-depth.ts`), and labelled: each bar's STATE and the ladder counts.
 * ⚠️ NOT AVAILABLE: the engine does not record WHY a bar with an actionable signal produced no trade.
 * Those rows say so in words. Do not "improve" the wording into a guess.
 *
 * ── THE TWO TABLES ARE ONE TIMELINE ─────────────────────────────────────────────────────────────
 * A row in either table can be pinned; the same instant highlights in both, and the decomposition
 * below follows the pinned bar. That is the "connection" between the two tables — not a colour
 * legend, but two views of one instant.
 */
import { useMemo, useState } from 'react';

const fmtPct = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : `${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(1)}%`);
const fmtMoney = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtPrice = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(2));

/** `2026-11-11T15:35:00.000Z` → `15:35` (UTC — the whole page runs on the UTC cutoff). */
const clock = (iso) => (typeof iso === 'string' && iso.length >= 16 ? iso.slice(11, 16) : '—');

const STATE_LABEL = {
  'entry+exit': 'ENTRY + EXIT',
  entry: 'ENTRY',
  exit: 'EXIT',
  'signal-not-traded': 'SIGNAL · NO TRADE',
  'bar-gate': 'BLOCKED BY BAR',
  'no-data': 'NO READING',
  quiet: 'HOLD',
};

const STATE_TONE = {
  'entry+exit': 'entry',
  entry: 'entry',
  exit: 'exit',
  'signal-not-traded': 'warn',
  'bar-gate': 'gate',
  'no-data': 'none',
  quiet: 'none',
};

/** The decision in words, using ONLY recorded facts. */
function decisionText(bar) {
  if (bar.state === 'entry' || bar.state === 'entry+exit') {
    const e = bar.entries[0];
    const refused = bar.entries.some((x) => !x.kept);
    return `${e.direction} opened at ${fmtPrice(bar.price)}${refused ? ' — refused by the selection' : ''}`;
  }
  if (bar.state === 'exit') {
    const x = bar.exits[0];
    return `${x.exitReason} closed ${x.direction} for ${fmtMoney(x.pnl)}`;
  }
  if (bar.state === 'signal-not-traded') {
    return `${bar.signal} cleared the gates and produced no trade — the engine does not record the per-bar reason`;
  }
  if (bar.state === 'bar-gate') {
    return `score ${bar.score} did not clear the bot's own entry bar`;
  }
  if (bar.state === 'no-data') return 'no directional reading on this bar';
  return `${bar.signal} — not actionable for this leg`;
}

export default function MoversDepthPanel({ symbol, day, detail }) {
  const [pinned, setPinned] = useState(null);

  const bars = detail?.bars ?? [];
  const steps = detail?.steps ?? [];

  const focused = useMemo(
    () => bars.find((b) => b.time === pinned) ?? bars.find((b) => b.state !== 'quiet' && b.state !== 'no-data') ?? bars[0] ?? null,
    [bars, pinned],
  );
  const focusTime = focused?.time ?? null;

  if (!bars.length) {
    return (
      <p className="mvp-note">
        No per-bar detail was returned for {symbol}. The run reported no scored bars on {day}, which is
        different from “nothing happened” — it means the window held no bars this engine could read.
      </p>
    );
  }

  const rowClass = (time) => `mvp-depth-row${time === focusTime ? ' mvp-depth-row--on' : ''}`;

  return (
    <div className="mvp-depth">
      {/* ── 1 · the ladder ─────────────────────────────────────────────────────────────────────── */}
      <section aria-label="Pipeline steps">
        <h3 className="mvp-depth-title">
          {symbol} · {day} — from the day’s list to a closed trade
        </h3>
        <ol className="mvp-ladder">
          {steps.map((s) => {
            const pct = s.of ? Math.round((s.count / Math.max(1, s.of)) * 100) : null;
            return (
              <li key={s.id} className="mvp-ladder-step">
                <span className="mvp-ladder-label">{s.label}</span>
                <span className="mvp-ladder-count">
                  <strong>{s.count}</strong>
                  {s.of != null && <em>of {s.of}</em>}
                </span>
                <span className="mvp-ladder-bar" aria-hidden="true">
                  <span className="mvp-ladder-fill" style={{ width: `${pct == null ? 100 : pct}%` }} />
                </span>
                <span className="mvp-ladder-note">{s.note}</span>
              </li>
            );
          })}
        </ol>
        {detail.runCounters && (
          <p className="mvp-note">
            The run’s own counters for this symbol: <strong>{detail.runCounters.totalSignals ?? '—'}</strong>{' '}
            entry signals · <strong>{detail.runCounters.signalsWithoutTrade ?? '—'}</strong> without a trade ·{' '}
            <strong>{detail.runCounters.tradesRefusedUnaffordable ?? '—'}</strong> refused as unaffordable.
            {detail.runId ? <> Stored run <code>{detail.runId}</code>.</> : null}
          </p>
        )}
      </section>

      {/* ── 2 · the two linked tables ──────────────────────────────────────────────────────────── */}
      <div className="mvp-depth-grid">
        <section aria-label="Bars and scores">
          <h3 className="mvp-depth-title">Bars &amp; scores <span className="mvp-muted">(UTC)</span></h3>
          <div className="mvp-scroll mvp-depth-scroll">
            <table className="mvp-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col" className="mvp-num">Price</th>
                  <th scope="col" className="mvp-num">Chg %</th>
                  <th scope="col" className="mvp-num">Score</th>
                  <th scope="col" className="mvp-num">Opportunity</th>
                  <th scope="col" className="mvp-num">Risk</th>
                  <th scope="col">Signal</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {bars.map((b) => (
                  <tr
                    key={b.time}
                    className={`${rowClass(b.time)}${b.beforeCutoff ? ' mvp-depth-row--pre' : ''}`}
                    onMouseEnter={() => setPinned(b.time)}
                    onFocus={() => setPinned(b.time)}
                    tabIndex={0}
                    onClick={() => setPinned(b.time)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setPinned(b.time);
                      }
                    }}
                  >
                    <td className="mvp-nowrap">
                      {clock(b.time)}
                      {b.beforeCutoff && <span className="mvp-depth-pre" title="before the cutoff — could never trade">pre</span>}
                    </td>
                    <td className="mvp-num">{fmtPrice(b.price)}</td>
                    <td className={`mvp-num ${b.changePct > 0 ? 'mvp-pos' : b.changePct < 0 ? 'mvp-neg' : ''}`}>
                      {fmtPct(b.changePct)}
                    </td>
                    <td className="mvp-num">{Number(b.score).toFixed(1)}</td>
                    <td className="mvp-num">{Number(b.opportunityPct).toFixed(1)}</td>
                    <td className="mvp-num">{Number(b.riskMultiplier).toFixed(2)}</td>
                    <td className="mvp-nowrap">{b.signal}</td>
                    <td className="mvp-nowrap">
                      <span className={`mvp-state mvp-state--${STATE_TONE[b.state] ?? 'none'}`}>{STATE_LABEL[b.state] ?? b.state}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-label="Decisions">
          <h3 className="mvp-depth-title">Decisions <span className="mvp-muted">(one per bar, derived)</span></h3>
          <div className="mvp-scroll mvp-depth-scroll">
            <table className="mvp-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Decision</th>
                  <th scope="col">Why / what</th>
                  <th scope="col" className="mvp-num">P/L</th>
                </tr>
              </thead>
              <tbody>
                {bars.map((b) => {
                  const pnl = b.exits.reduce((a, x) => a + Number(x.pnl ?? 0), 0);
                  return (
                    <tr
                      key={b.time}
                      className={rowClass(b.time)}
                      onMouseEnter={() => setPinned(b.time)}
                      onFocus={() => setPinned(b.time)}
                      tabIndex={0}
                      onClick={() => setPinned(b.time)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setPinned(b.time);
                        }
                      }}
                    >
                      <td className="mvp-nowrap">{clock(b.time)}</td>
                      <td className="mvp-nowrap">
                        <span className={`mvp-state mvp-state--${STATE_TONE[b.state] ?? 'none'}`}>{STATE_LABEL[b.state] ?? b.state}</span>
                      </td>
                      <td>{decisionText(b)}</td>
                      <td className={`mvp-num ${pnl > 0 ? 'mvp-pos' : pnl < 0 ? 'mvp-neg' : ''}`}>
                        {b.exits.length ? fmtMoney(pnl) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* ── 3 · the decomposition of the pinned bar ────────────────────────────────────────────── */}
      <section aria-label="Directive breakdown">
        <h3 className="mvp-depth-title">
          Why {focused ? clock(focused.time) : '—'} scored {focused ? Number(focused.score).toFixed(1) : '—'}
        </h3>

        {!focused?.directives?.length ? (
          <p className="mvp-note">
            This run did not return a directive breakdown. Only a run made with <code>includeBreakdown</code>{' '}
            records one — re-run with the detail switch on.
          </p>
        ) : (
          <>
            {focused.groups && Object.keys(focused.groups).length > 0 && (
              <div className="mvp-group-row">
                {Object.entries(focused.groups).map(([id, pct]) => (
                  <span key={id} className="mvp-group-pill">
                    {id}
                    <em>{Number(pct).toFixed(0)}%</em>
                  </span>
                ))}
              </div>
            )}
            <div className="mvp-scroll mvp-depth-scroll">
              <table className="mvp-table">
                <thead>
                  <tr>
                    <th scope="col">Directive</th>
                    <th scope="col" className="mvp-num">Score</th>
                    <th scope="col" className="mvp-num">Max</th>
                    <th scope="col" className="mvp-num">Share</th>
                    <th scope="col">Class</th>
                    <th scope="col">Counted</th>
                  </tr>
                </thead>
                <tbody>
                  {[...focused.directives]
                    .sort((a, b) => Number(b.score) - Number(a.score))
                    .map((d) => (
                      <tr key={d.directiveId}>
                        <td className="mvp-nowrap">
                          {d.directiveId}
                          {d.reason && <span className="mvp-directive-why">{d.reason}</span>}
                        </td>
                        <td className="mvp-num">{Number(d.score).toFixed(1)}</td>
                        <td className="mvp-num">{Number(d.maxScore).toFixed(1)}</td>
                        <td className="mvp-num">
                          <span className="mvp-share">
                            <span
                              className="mvp-share-fill"
                              style={{ width: `${Math.round((Number(d.score) / Math.max(1, Number(d.maxScore))) * 100)}%` }}
                            />
                          </span>
                        </td>
                        <td className="mvp-nowrap mvp-muted">{d.signalClass}</td>
                        <td className="mvp-nowrap">
                          {d.inSignal == null ? (
                            <span className="mvp-muted">—</span>
                          ) : d.inSignal ? (
                            <span className="mvp-state mvp-state--entry">in signal</span>
                          ) : (
                            <span className="mvp-state">not counted</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="mvp-note">
          A directive that reads neutral contributes 0 and cannot lift the composite, however far the
          price has run. That is the mechanism to inspect first when a large move produces a small score.
        </p>
      </section>
    </div>
  );
}
