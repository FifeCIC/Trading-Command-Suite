/**
 * MoversTreatmentPage — "today's winners and losers, and what TCS actually did about each" (#1281).
 * ================================================================================================
 *
 * Owner, 2026-11-15: *"Make the UI visible and inactive with reason for now. I would like to see a
 * list of all the winners and losers and how TCS is treating them in terms of scoring, trading,
 * monitoring and decisions made."*
 *
 * ── THE POINT OF THIS PAGE ──
 * The app could already answer each question separately — `/api/market-data/top-movers` has the
 * moves, `/lab/hot-stock-picks` has ranked scores, `/development/blocked-signals` has the refusals.
 * Nobody could see them SIDE BY SIDE for one symbol, and that is the question that matters: a stock
 * moved 40% and the app did nothing — was that a decision, a gap, or a bug?
 *
 * ── ⚠️ SIX STATES, NEVER COLLAPSED INTO TWO ──
 * traded · queued · refused · scored · unscored · no-data
 *
 * "Unscored" and "no-data" in particular must never render the same. A symbol with no bars is
 * CANNOT JUDGE; a symbol with bars and no score is a COVERAGE GAP. Rendering them as one empty cell
 * is the "plausible output, no error" failure this repo keeps re-paying for.
 *
 * ── ⚠️ THE STRATEGY PANEL IS INACTIVE ON PURPOSE, AND SAYS WHY ──
 * The parabolic-momentum strategy that motivated this page has no protocol yet. Its tab is shown
 * greyed with the reason rather than hidden, because a capability that silently vanishes is worse
 * than one that is visibly not ready — see `docs/SETTLED-DECISIONS.md` row 181 and #1277.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import MarketMoversPanel from '../components/MarketMoversPanel';
import './MoversTreatmentPage.css';

const fmtPct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
const fmtNum = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString() : '—');

const TREATMENT_META = {
  traded: { icon: '✅', label: 'Traded', cls: 'mt-t-traded' },
  queued: { icon: '📤', label: 'Queued', cls: 'mt-t-queued' },
  refused: { icon: '🛑', label: 'Refused', cls: 'mt-t-refused' },
  scored: { icon: '📊', label: 'Scored, no subscriber', cls: 'mt-t-scored' },
  unscored: { icon: '🚧', label: 'Not scored', cls: 'mt-t-unscored' },
  'no-data': { icon: '⚠️', label: 'No bars — cannot judge', cls: 'mt-t-nodata' },
};

function Row({ r }) {
  const m = TREATMENT_META[r.treatment] ?? TREATMENT_META['no-data'];
  return (
    <tr className={m.cls}>
      <td className="mt-sym">
        <strong>{r.ticker}</strong>
        <span className="mt-type">{r.type}</span>
      </td>
      <td className={`mt-move ${r.changePct >= 0 ? 'mt-up' : 'mt-down'}`}>{fmtPct(r.changePct)}</td>
      <td className="mt-num">{r.lastPrice == null ? '—' : r.lastPrice.toFixed(4)}</td>
      <td className="mt-num" title="last bar volume ÷ the window's own average">
        {r.volumeRatio == null ? <span className="mt-dim">no vol</span> : `${r.volumeRatio.toFixed(2)}×`}
        {r.volumeSpike === true && <span title="volume spike"> ⚡</span>}
      </td>
      <td>
        {r.score ? (
          <span title={`${r.score.protocolId} · ${r.score.signal ?? 'no signal'}`}>
            {fmtNum(r.score.compositePct)}% <span className="mt-dim">{r.score.signal ?? '—'}</span>
          </span>
        ) : (
          // ⚠️ "no score" is not zero. Saying 0 would claim the symbol scored badly.
          <span className="mt-dim">no score</span>
        )}
      </td>
      <td className="mt-num">
        {r.monitored.assignedProtocols > 0 ? r.monitored.assignedProtocols : <span className="mt-warn">0</span>}
      </td>
      <td className="mt-num">{r.trading.openPositions || '—'}</td>
      <td className="mt-num">{r.trading.queued || '—'}</td>
      <td className="mt-num">{r.trading.tradesToday || '—'}</td>
      <td>
        {r.decision ? (
          <span title={r.decision.reason ?? ''}>
            <strong>{r.decision.decision}</strong>
            <span className="mt-dim"> {fmtTime(r.decision.at)}</span>
          </span>
        ) : (
          <span className="mt-dim">—</span>
        )}
      </td>
      <td>
        <span className="mt-badge">{m.icon} {m.label}</span>
        {r.hotCandidateFor?.length > 0 && (
          <span
            className="mt-hot"
            title={`hot-stock candidate for: ${r.hotCandidateFor.map((h) => `${h.bot} (${h.detectionMode ?? 'no mode'})`).join(', ')}`}
          >
            {' '}🔥
          </span>
        )}
      </td>
    </tr>
  );
}

function Side({ title, rows, empty }) {
  return (
    <section className="mt-side">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-note">{empty}</p>
      ) : (
        <div className="mt-scroll">
          <table className="mt-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Move</th>
                <th>Last</th>
                <th title="last bar volume ÷ window average">Vol</th>
                <th>Score</th>
                <th title="protocols assigned to this symbol">Assigned</th>
                <th>Open</th>
                <th>Queue</th>
                <th>Today</th>
                <th>Last decision</th>
                <th>Treatment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <Row key={`${r.direction}-${r.ticker}`} r={r} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function MoversTreatmentPage() {
  const [timeframe, setTimeframe] = useState('5m');
  const [bars, setBars] = useState(6);
  /**
   * ⚠️ TWO TABS, AND THE SPLIT IS THE FEATURE — not presentation.
   * Owner, 2026-11-16: *"those are two separate purposes/features."*
   *   registered — "what is TCS doing with the symbols WE hold?"
   *   market     — "what is moving anywhere, that we are NOT looking at?"
   * One table would hide the one fact that matters: a symbol can be the biggest mover in the market
   * and appear nowhere in our universe.
   */
  const [tab, setTab] = useState('registered');

  const q = useQuery({
    queryKey: ['movers-treatment', timeframe, bars],
    queryFn: () => apiGet(`/api/scoring/movers-treatment?timeframe=${timeframe}&bars=${bars}&limit=10`).catch(() => null),
    staleTime: 30_000,
  });

  const d = q.data;

  return (
    <div className="mt-page">
      <header className="mt-header">
        <h2>Movers &amp; Treatment</h2>
        <p className="mt-sub">
          Two different questions about movers. One is bounded by what we hold; the other is not.
        </p>
      </header>

      <div className="mt-tabs" role="tablist" aria-label="Movers views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'registered'}
          className={tab === 'registered' ? 'mt-tab mt-tab--on' : 'mt-tab'}
          onClick={() => setTab('registered')}
        >
          Our registered symbols
          <span className="mt-tab-hint">what TCS is doing with the symbols we already hold</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'market'}
          className={tab === 'market' ? 'mt-tab mt-tab--on' : 'mt-tab'}
          onClick={() => setTab('market')}
        >
          Market-wide
          <span className="mt-tab-hint">winners and losers anywhere — the discovery side</span>
        </button>
      </div>

      {tab === 'market' && <MarketMoversPanel />}

      {tab === 'registered' && (
        <>

      {/* ── The strategy this page was built for, shown INACTIVE WITH ITS REASON ── */}
      <section className="mt-strategy mt-strategy--inactive">
        <div className="mt-strategy-head">
          <span className="mt-strategy-tag">INACTIVE</span>
          <h3>Parabolic momentum — winners &amp; losers</h3>
        </div>
        <p>
          Not available yet: the strategy has <strong>no protocol</strong> to score with, so there is
          nothing to switch on. The observation below is live regardless — it is the general question
          of what the app is doing with a big mover, not a feature of the strategy.
        </p>
        <p className="mt-strategy-why">
          When the strategy exists it will appear as a tab here, gated on its protocol being active.
          The data this page reads is already its input: a mover list, the score each symbol reached,
          whether anything is subscribed, and the last recorded decision.
        </p>
      </section>

      <div className="mt-controls">
        <label>
          Window
          <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
            <option value="1m">1 minute</option>
            <option value="5m">5 minutes</option>
            <option value="15m">15 minutes</option>
            <option value="1h">1 hour</option>
            <option value="1d">1 day</option>
          </select>
        </label>
        <label>
          Compare against
          <select value={bars} onChange={(e) => setBars(Number(e.target.value))}>
            {[2, 3, 6, 12, 24].map((b) => <option key={b} value={b}>{b} bars back</option>)}
          </select>
        </label>
        <button type="button" onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? 'Measuring…' : 'Re-measure'}
        </button>
        {d && <span className="mt-stamp">measured {fmtTime(d.generatedAt)} · {d.measured} of {d.universe} symbols comparable</span>}
      </div>

      {/* ⚠️ THREE OUTCOMES: loading · FAILED (unknown) · data. A failed query is never an empty list. */}
      {q.isLoading && <p className="mt-note">Measuring the window…</p>}
      {!q.isLoading && !d && (
        <p className="mt-note mt-note--warn">
          ⚠️ The measurement failed, so nothing below is known — this is <strong>not</strong> &quot;no movers&quot;.
          The endpoint or the database is unreachable.
        </p>
      )}

      {d && d.measured === 0 && (
        <p className="mt-note mt-note--warn">
          ⚠️ Nothing could be ranked. <strong>{d.note}</strong>
        </p>
      )}

      {d && (
        <>
          <div className="mt-tallies">
            {Object.entries(d.counts).map(([k, n]) => {
              const meta = TREATMENT_META[k === 'noData' ? 'no-data' : k];
              return (
                <div key={k} className={`mt-tally ${meta?.cls ?? ''}`}>
                  <span className="mt-tally-n">{n}</span>
                  <span className="mt-tally-l">{meta?.icon} {meta?.label ?? k}</span>
                </div>
              );
            })}
          </div>

          {d.hotStockBots === 0 && (
            <p className="mt-note">
              🔌 <strong>0 active bots have hot-stock detection enabled.</strong> Two of the four{' '}
              <code>hotStock*</code> settings now have a reader — <code>hotStockEnabled</code> and{' '}
              <code>hotStockDetectionMode</code> (this page is that reader) — so the 🔥 column will stay
              empty until a bot switches detection on. <code>hotStockAllocation</code> and{' '}
              <code>hotStockMaxHoldHours</code> are still <strong>unread</strong>: nothing sizes or
              time-stops a discovered symbol yet, and this page does not pretend otherwise.
            </p>
          )}

          <Side
            title={`🏆 Top winners — ${d.window.timeframe}, ${d.window.bars} bars`}
            rows={d.winners}
            empty="No symbol rose in this window, or none had two comparable bars."
          />
          <Side
            title={`🕳️ Top losers`}
            rows={d.losers}
            empty="No symbol fell in this window, or none had two comparable bars."
          />

          <section className="mt-verdicts">
            <h3>Read as sentences</h3>
            <ul>
              {[...d.winners, ...d.losers].map((r) => (
                <li key={`v-${r.direction}-${r.ticker}`}>{r.verdict}</li>
              ))}
            </ul>
          </section>
        </>
      )}
        </>
      )}
    </div>
  );
}
