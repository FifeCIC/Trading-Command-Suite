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
 * traded · queued · refused · scored · unscored · no-data — the definitions live in ONE place,
 * `classifyTreatment()` in `movers-treatment.service.ts`, and the detail text on each tally card is
 * quoted from there rather than rewritten. Two copies of a definition drift and only one gets the
 * next fix.
 *
 * "Unscored" and "no-data" in particular must never render the same. A symbol with no bars is
 * CANNOT JUDGE; a symbol with bars and no score is a COVERAGE GAP. Rendering them as one empty cell
 * is the "plausible output, no error" failure this repo keeps re-paying for.
 *
 * ── ⚠️ THE STRATEGY IS A STATUS, NOT A PANEL ──
 * Owner, 2026-11-18: *"which basically constitutes a status (do not need all the text displayed until
 * the user hovers over the status)."* It was three paragraphs of explanation above the data. It is now
 * one `StatusCard` whose justification is on demand. The reason it is INACTIVE is still stated — a
 * capability that silently vanishes is worse than one that is visibly not ready (#1277) — it is just
 * no longer the loudest thing on the page.
 *
 * ── ⚠️ NO VISIBLE PAGE TITLE ──
 * Owner, 2026-11-18: *"Remove Element: <h2> Movers & Treatment"* — the nav and the breadcrumb already
 * say where you are, so a third copy is chrome. `<h1 className="sr-only">` keeps the accessibility
 * requirement (*"Every page MUST have exactly one <h1>"*) satisfied without drawing it; the
 * explanation that used to sit under the title moved behind the ℹ.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { hotStockReadiness } from '../core/hot-stock-readiness';
import MarketMoversPanel from '../components/MarketMoversPanel';
import PageInfoPopover from '../components/PageInfoPopover';
import StatusCard from '../components/StatusCard';
import './MoversTreatmentPage.css';

const fmtPct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
const fmtNum = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString() : '—');

/**
 * ⚠️ `detail` IS THE SENTENCE THAT DOES NOT NEED TO BE ON SCREEN — the definition of each state,
 * quoted from `movers-treatment.service.ts` so this table cannot drift from the classifier.
 */
const TREATMENT_META = {
  traded: {
    icon: '✅',
    label: 'Traded',
    cls: 'mt-t-traded',
    detail: 'An order exists — an open position, or a trade closed today. This is not a claim it was profitable.',
  },
  queued: {
    icon: '📤',
    label: 'Queued',
    cls: 'mt-t-queued',
    detail: 'In strategy_signal_queue and not yet executed. It passed scoring and gating; no bot has dispatched it.',
  },
  refused: {
    icon: '🛑',
    label: 'Refused',
    cls: 'mt-t-refused',
    detail: 'The loop decided against it and said why — the reason is in the Last decision column, not inferred here.',
  },
  scored: {
    icon: '📊',
    label: 'Scored, no subscriber',
    cls: 'mt-t-scored',
    detail: 'Scored, but nothing is subscribed to the protocol that scored it. A signal nobody can act on is a configuration gap, not a market fact.',
  },
  unscored: {
    icon: '🚧',
    label: 'Not scored',
    cls: 'mt-t-unscored',
    detail: 'Monitored — it has bars — but no score landed in this window. That is a COVERAGE GAP upstream of gating: not "no move", and not a refusal.',
  },
  'no-data': {
    icon: '⚠️',
    label: 'No bars — cannot judge',
    cls: 'mt-t-nodata',
    detail: 'No bars, so nothing can be judged about this symbol. CANNOT JUDGE is a different answer from "nothing happened", and the two must never share a cell.',
  },
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

/**
 * ⚠️ `hotStockReadiness()` MOVED TO `src/core/hot-stock-readiness.js` (2026-11-18) — it is a pure
 * function with a decision worth testing, and this repo has no React test harness, so a helper living
 * in a page file can only be checked by eye. `<StatusCard>` consumes its result; the tests are
 * `src/core/hot-stock-readiness.test.js`.
 */

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

  /**
   * ⚠️ A SECOND QUERY, for a fact about the SETTINGS rather than about the movers. It is fetched here
   * because the readiness cards below are the only consumer; if a second surface needs it, that is the
   * moment to promote it to a shared module, not now.
   */
  const rulesQ = useQuery({
    queryKey: ['bot-rules'],
    queryFn: () => apiGet('/api/trading/strategies/bot-rules').catch(() => null),
    staleTime: 5 * 60_000,
  });
  const hot = hotStockReadiness(rulesQ.data);

  return (
    <div className="mt-page">
      {/* One h1 for assistive tech; the nav and breadcrumb carry it visually. See the docblock. */}
      <h1 className="sr-only">Movers &amp; Treatment</h1>

      <div className="mt-head">
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
        {/* The explanation that used to be a paragraph under the title. On demand, beside the tabs. */}
        <PageInfoPopover label="About this page">
          Two different questions about movers. <strong>Our registered symbols</strong> is bounded by
          what we hold — what TCS is doing with it. <strong>Market-wide</strong> is not bounded at all —
          it is the discovery side, and a symbol can be the biggest mover in the market and appear
          nowhere in our universe.
          <br />
          <br />
          Every tally below is a STATUS: the number is the answer and the detail behind it is on demand.
          Hover a card, focus it, or click to pin it open.
        </PageInfoPopover>
      </div>

      {tab === 'market' && <MarketMoversPanel />}

      {tab === 'registered' && (
        <>

      {/* ── The strategy this page was built for, as a STATUS with its reason on demand ── */}
      <div className="mt-status-row">
        <StatusCard
          icon="🚧"
          value="INACTIVE"
          label="Parabolic momentum — winners & losers"
          tone="warn"
          detail={
            <>
              <strong>Not available yet:</strong> the strategy has no protocol to score with, so there
              is nothing to switch on. When it exists it will appear as a tab here, gated on its
              protocol being active.
              <br />
              <br />
              The observation on this page is live regardless — it is the general question of what the
              app is doing with a big mover, not a feature of the strategy. The data it reads is already
              the strategy&apos;s input: a mover list, the score each symbol reached, whether anything is
              subscribed, and the last recorded decision.
            </>
          }
        />
      </div>

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
          <div className="mt-status-row">
            {Object.entries(d.counts).map(([k, n]) => {
              const meta = TREATMENT_META[k === 'noData' ? 'no-data' : k];
              // ⚠️ `bad` TONE ONLY WHEN THERE IS SOMETHING TO BE BAD ABOUT. A red border on
              // "0 No bars — cannot judge" reads as a fault, when zero is the good outcome.
              const tone = k === 'noData' && n > 0 ? 'bad' : 'neutral';
              return (
                <StatusCard
                  key={k}
                  value={n}
                  icon={meta?.icon}
                  label={meta?.label ?? k}
                  tone={tone}
                  detail={meta?.detail}
                />
              );
            })}

            {/* ── Hot-stock readiness: DERIVED, and honest when it cannot be derived ── */}
            <StatusCard
              value={d.hotStockBots}
              label="bots detecting"
              icon="🔥"
              detail={
                <>
                  Active bots with <code>hotStockEnabled</code> switched on. This page is the reader for
                  that flag and for <code>hotStockDetectionMode</code> — so the 🔥 column in the tables
                  below stays empty until a bot turns detection on. That is an unused capability, not a
                  fault.
                </>
              }
            />
            {hot ? (
              <StatusCard
                value={`${hot.read.length}/${hot.all.length}`}
                label="hotStock* settings with a reader"
                tone={hot.read.length === hot.all.length ? 'ok' : 'warn'}
                detail={
                  <>
                    Read from <code>GET /api/trading/strategies/bot-rules</code>, where{' '}
                    <code>enforcement: &apos;none&apos;</code> is the canonical statement that a column
                    has no reader. <strong>Read:</strong>{' '}
                    {hot.read.map((r) => r.field).join(', ') || 'none'}. <strong>No reader:</strong>{' '}
                    {hot.all.filter((r) => r.enforcement === 'none').map((r) => r.field).join(', ') ||
                      'none'}
                    . A setting with no reader sizes nothing and time-stops nothing, so this page does
                    not pretend a discovered symbol is being managed.
                  </>
                }
              />
            ) : (
              <StatusCard
                value="—"
                label="hotStock* settings with a reader"
                tone="warn"
                detail={
                  <>
                    The bot-rules endpoint could not be read, so how many of these settings have a
                    reader is <strong>UNKNOWN</strong> — which is not the same as &quot;none of them
                    do&quot;. Nothing here claims either.
                  </>
                }
              />
            )}
          </div>

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

          {/* ⚠️ The same sentences are ALREADY in the Treatment column. Kept because reading the whole
              picture at once is useful — collapsed by default because a ten-line block of prose above
              the fold is exactly the clutter this page was trimmed for. */}
          <details className="mt-verdicts">
            <summary>Read as sentences ({d.winners.length + d.losers.length})</summary>
            <ul>
              {[...d.winners, ...d.losers].map((r) => (
                <li key={`v-${r.direction}-${r.ticker}`}>{r.verdict}</li>
              ))}
            </ul>
          </details>
        </>
      )}
        </>
      )}
    </div>
  );
}
