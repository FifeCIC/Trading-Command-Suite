/**
 * RunComparisonPanels — tabs A, B and the A-vs-B difference (owner direction, 2026-10-27).
 * ==========================================================================================
 *
 * *"A and B should display the same type of information but they're currently very different, one is
 * the first backtest run and B is every other after."* … *"'A' will also be the data from the
 * backtest that the user indicates as an improvement"* … *"Score detail … should probably make
 * differences between the A and B clear so that the user doesn't need to examine every row of data."*
 *
 * ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────
 * A and B are the SAME component rendering the SAME layout from ONE stored run each:
 *
 *     heading · run facts · scoring table · caveats
 *
 * A is the run the reader ACCEPTED (see `backtest-baseline.js`); B is the latest stored run. The
 * only difference is which id each is given, and A's heading says it is accepted.
 *
 * ⚠️ THE LIVE BOT FIGURES ARE NO LONGER PANEL A. They answered a different question (real trades vs
 * a simulation) and made the two tabs incomparable — which is exactly what was reported. They
 * survive as one clearly-labelled reference line, because deleting them would remove the only live
 * evidence on the page.
 */
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../core/api/client.js';
import { useSort, SortableTh } from '../../core/use-sort.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { pickRepeatPair } from '../../core/backtest-totals.js';
import InfoNote from '../InfoNote';
/**
 * ⚠️ meta-stack-status.css IS IMPORTED FOR ITS .mss-stat-* TILES, not for its page (owner direction
 * 2026-10-29: *"there are other pages with stats that display it better … use existing styling as
 * always"*). The Appearance area presents these as the app's stat library, so importing them here is
 * reuse rather than a second stat look.
 */
import '../../pages/meta-stack-status.css';
import TradeTable, { holdLabel } from './TradeTable.jsx';

const money = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(Number(v)).toFixed(2)}`);

/**
 * The BAR, as a reader must see it. `date` alone is `YYYY-MM-DD`, so a 1h run shows 24 identical
 * rows for one day. When the run recorded the instant, show it — the rows are then distinguishable
 * and sortable in true order.
 */
const barLabel = (row) => (row.time ? `${row.date} ${row.time.slice(11, 16)}` : row.date);
const barKey = (row) => row.time ?? row.date;

/** One decimal, or an em dash — never a fabricated 0 for a bar that stored no such score. */
const num1 = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(1));

/** `2026-10-27T20:16:05Z` → `27 Oct 20:16`, so two runs of one window are told apart at a glance. */
const shortStamp = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? '').slice(0, 16);
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * scoringTotals now lives in `src/core/backtest-totals.js` (with `scoreDirectionCounts`) because it is
 * pure arithmetic and needs a unit test — a JSX file cannot be imported by `node --test`, so the
 * numbers that ARE the answer would otherwise ship untested. Imported at the top of this file.
 */

function useRun(runId) {
  return useQuery({
    queryKey: ['bt-run-detail', runId],
    // ⚠️ NOT `.catch(() => null)`. Swallowing the failure made "the run was deleted" and "the API
    // could not answer" both render as `null`, i.e. as the same state — and one of those states is a
    // dangling accepted baseline a reader has to be told about. `error.status === 404` is the one that
    // means GONE; anything else means UNKNOWN.
    queryFn: () => apiGet(`/api/backtest/results/${runId}`),
    enabled: Boolean(runId),
    staleTime: 30_000,
    retry: false,
  });
}

/** The scoring table. Shared, so A and B cannot drift apart in columns or wording. */
/**
 * ⚠️ EXPORTED 2026-10-30 so the RUN step can show a protocol run its own score series. A protocol run
 * places no trades, so its Result step previously showed seven statistic tiles and nothing else —
 * the per-bar reading, which is the entire output of a protocol, was reachable only by first
 * accepting a baseline and opening the A/B panel. One definition now serves both.
 */
export function ScoreTable({ scoreSeries }) {
  // `barAt` is derived so the BAR column sorts by the true instant, not the shared day.
  const rows = (scoreSeries ?? []).map((s) => ({ ...s, barAt: barKey(s) }));
  const sort = useSort(rows, 'barAt', 'desc');
  return (
    <div className="bt-table-wrap">
      <table className="bt-table">
        <caption className="sr-only">Every bar this run scored — both scores</caption>
        <thead>
          <tr>
            <SortableTh col="barAt" label="Bar" api={sort} />
            <SortableTh col="signalPct" label="Signal %" title="Gated DIRECTIONAL score — what BUY / SELL / HOLD is classified from." api={sort} className="bt-num" />
            <SortableTh col="opportunityPct" label="Opportunity %" title="ADDITIVE score — what the Screening area ranks by." api={sort} className="bt-num" />
            <SortableTh col="opportunityScore" label="Opp points" api={sort} className="bt-num" />
            <SortableTh col="riskMultiplier" label="Risk ×" api={sort} className="bt-num" />
            <SortableTh col="signal" label="Signal" api={sort} />
            <SortableTh col="passedBar" label="Passed" api={sort} />
          </tr>
        </thead>
        <tbody>
          {/*
            ⚠️ CAPPED AT 100 ROWS. A full window is ~1,700 scored bars; rendering them all put 12,000
            cells in the DOM for one panel and made the tab feel broken (measured 2026-10-27: 1,728
            rows from a single run). Sorting still governs WHICH hundred you see, and the count below
            the table says how many are hidden rather than pretending the list is complete.
          */}
          {sort.sorted.slice(0, 100).map((s, i) => (
            <tr key={`${s.barAt}-${i}`}>
              <td className="pb-mono">{barLabel(s)}</td>
              <td className="pb-mono bt-num">{s.signalPct ?? s.score}</td>
              <td className="pb-mono bt-num">{s.opportunityPct ?? '—'}</td>
              <td className="pb-mono bt-num">{s.opportunityScore ?? '—'}</td>
              <td className="pb-mono bt-num">{s.riskMultiplier ?? '—'}</td>
              <td>{s.signal}</td>
              <td>{s.passedBar ? 'yes' : 'no — below the bar'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The three scores, totalled — quick reference for "is this run bigger or smaller than the other".
 * Deliberately ONE small table: sum, highest bar, lowest bar per score.
 */
function ScoringTotals({ totals }) {
  // ⚠️ From the API, not recomputed here: `run.totals` is produced by `score-maths.ts`, the same code
  // `POST /api/backtest/repeat-check` uses, so the panel and an agent read identical numbers.
  const t = totals;
  const rows = [
    ['Signal % (directional)', t.signalPct],
    ['Opportunity % (additive)', t.opportunityPct],
    ['Opp points', t.opportunityScore],
  ];
  return (
    <>
      <h4 className="bt-panel-head">Score totals — {t.bars} bar(s)</h4>
      <div className="bt-table-wrap">
        <table className="bt-table bt-facts-table">
          <caption className="sr-only">
            Sum, highest and lowest bar for each of the three per-bar scores
          </caption>
          <thead>
            <tr>
              <th scope="col">Score</th>
              <th scope="col" className="bt-num">Σ total</th>
              <th scope="col" className="bt-num">Highest bar</th>
              <th scope="col" className="bt-num">Lowest bar</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, s]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="pb-mono bt-num">{num1(s.sum)}</td>
                <td className="pb-mono bt-num">{num1(s.max)}</td>
                <td className="pb-mono bt-num">{num1(s.min)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/*
        ⚠️ The unit, said once, where the reader meets the number. `signalPct` is a share of THIS
        protocol's configured capacity, so Σ is capacity-points earned across the window — not a
        percentage and not comparable across two protocols with different ceilings.
      */}
      <InfoNote tone="neutral" label="How to read Σ">
        Σ is the sum across bars: <strong>capacity-points earned in the window</strong>, not an average
        and not out of 100. Two protocols with different configured ceilings are not comparable on this
        row; two runs of the <em>same</em> protocol are.
        {t.signalPct.missing > 0 && ` ${t.signalPct.missing} bar(s) stored no signal value and are excluded from that row.`}
      </InfoNote>
    </>
  );
}

/**
 * ONE run, rendered. `role` is 'A' or 'B' — the only difference is the heading and accept controls.
 *
 * ⚠️ `showTrades` IS WHAT KEEPS THE PROTOCOLS VIEW ABOUT SCORES (owner direction, 2026-10-27:
 * *"This view should not have anything relating to trades"*). A protocol run is `scoresOnly` — it
 * sends `slPct: 0 / tpPct: 0`, so the engine simulates NO fills and the trade cells can only ever
 * read `0` / `—`. Rendering them invited the reader to conclude the protocol "made no trades" as if
 * that were a result. They are simply not this subject's question; on the Strategies page they are.
 */
export function RunPanel({ role, runId, emptyHint, onAccept, onClear, accepted, liveReference, showTrades = true }) {
  const q = useRun(runId);
  const run = q.data;

  if (!runId) {
    return (
      <div className="bt-panel bt-ab-panel">
        <h3 className="bt-panel-head">{role} · {role === 'A' ? 'Accepted baseline' : 'Latest run'}</h3>
        <p className="pb-none">{emptyHint}</p>
      </div>
    );
  }
  if (q.isLoading) {
    return <div className="bt-panel bt-ab-panel"><p className="pb-none">Loading run {String(runId).slice(0, 8)}…</p></div>;
  }
  if (!run) {
    /**
     * ⚠️ A BASELINE CAN OUTLIVE THE RUN IT NAMES. The accepted id lives in the settings store, which
     * knows nothing about runs, so deleting a run leaves a dangling pointer. That is a state to
     * REPORT and make revocable — rendering it as "no baseline" would silently discard a decision the
     * reader made, and rendering "could not be read" alone would leave them stuck with no way out.
     */
    return (
      <div className="bt-panel bt-ab-panel">
        <h3 className="bt-panel-head">
          {role} · {role === 'A' ? 'Accepted baseline' : 'Latest run'} — <code>{String(runId).slice(0, 8)}</code>
        </h3>
        <p className="pb-none">
          {q.error && q.error.status !== 404
            ? `⚠️ Run ${String(runId).slice(0, 8)} could not be READ — that is unknown, not empty.`
            : `⚠️ This ${role === 'A' ? 'accepted baseline run' : 'run'} no longer exists — it was deleted, so there is nothing to compare.`}
        </p>
        {role === 'A' && onClear && (
          <p className="pb-field-note">
            <button type="button" className="bt-panel-btn" onClick={onClear}>
              Clear the accepted baseline
            </button>{' '}
            Accept a different run from <strong>Run B · latest</strong> to set a new reference.
          </p>
        )}
      </div>
    );
  }

  const stats = run.stats ?? {};
  const ex = run.execution ?? {};
  const changed = run.drivenBy?.overridden ?? null;
  const series = run.scoreSeries ?? null;

  return (
    <div className="bt-panel bt-ab-panel">
      {/*
        ⚠️ THE VISIBLE HEADING IS GONE (owner direction, 2026-10-31: *"Remove … as it is duplicate
        info"*). It read "A · 2fd56ab8 · accepted" directly beneath the `.bt-pair-bar` above, which
        already states the role, the run id and the ACCEPTED badge — the last of three statements of the
        same fact in 120 pixels (the removed one is the tab, the previous pass removed the role words).

        Kept as `sr-only` rather than deleted outright: the heading is what names this panel for a screen
        reader, and there is no visual context to read it from. It costs no pixels and removes the
        duplication the owner can see.
      */}
      <h3 className="bt-panel-head sr-only">
        {role} · <code>{String(run.id).slice(0, 8)}</code>
        {accepted ? ' accepted' : ''}
      </h3>

      {/* ⚠️ THE ACCEPT BUTTON IS THE FIRST THING IN THE PANEL (owner direction, 2026-10-29: *"needs to be
          moved to the top … so it is more prominent"*). It sat between the facts table and the trades —
          i.e. below a screen of numbers — so the one ACTION on the panel was the last thing found. It is
          an `.bt-accept-bar` rather than a bare note so it reads as a control, not a footnote. */}
      {(onAccept || (role === 'A' && accepted && onClear)) && (
        <div className="bt-accept-bar">
          {onAccept && (
            <button type="button" className="bt-panel-btn bt-panel-btn--primary" onClick={onAccept}>
              Accept this run as the A baseline
            </button>
          )}
          {role === 'A' && accepted && onClear && (
            <button type="button" className="bt-panel-btn" onClick={onClear}>
              Clear the accepted baseline
            </button>
          )}
          <span className="bt-accept-note">
            {onAccept
              ? <>The accepted run becomes <strong>A</strong>; the next run of this protocol is measured against it. Stored in the database, so it follows you to another browser. <strong>It does not change the strategy’s own settings</strong> — the bot keeps trading exactly what it trades now, and no copy of the strategy is made.</>
              : <>Removes the reference — it does not delete the run itself, and it does not touch the strategy.</>}
          </span>
        </div>
      )}

      {/* ⚠️ ONE FACT PER ROW, WITH A HEADER (owner direction, 2026-10-29: *"needs styling based on a
          similar table in the Appearance area"*). It was a headerless 4-column label/value mash — the
          only table on the page with no `<thead>`, which is what made it look unlike every other table.
          `src/core/tables.css` already gives `.bt-table` the SAME arrangement as `.pl-table` and
          `.mss-table` (57 families, one arrangement), so the difference was STRUCTURE, not styling:
          the Appearance examples all have a header and one entity per row. This is now that shape. */}
      <div className="bt-table-wrap">
        <table className="bt-table">
          <caption className="sr-only">The facts this run recorded</caption>
          <thead>
            <tr>
              <th scope="col">Fact</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Symbol · timeframe</td><td className="bt-fact-value">{run.symbol ?? '—'} · {run.timeframe ?? '—'}</td></tr>
            <tr><td>Protocol</td><td className="bt-fact-value">{run.protocolId ?? '—'}</td></tr>
            <tr><td>Window</td><td className="bt-fact-value">{run.measuredPeriod?.name ?? run.period ?? '—'}</td></tr>
            <tr><td>Scored bars</td><td className="bt-fact-value">{series?.length ?? '—'}</td></tr>
            {showTrades && (
              <>
                <tr><td>Position model</td><td className="bt-fact-value">{ex.positionModel ?? '—'}</td></tr>
                <tr>
                  <td>Spread / slippage</td>
                  <td className="bt-fact-value">
                    {ex.spread == null ? '—' : `${(Number(ex.spread) * 100).toFixed(3)}%`}
                    {' / '}
                    {ex.slippage == null ? '—' : `${(Number(ex.slippage) * 100).toFixed(2)}%`}
                  </td>
                </tr>
                <tr><td>Trades</td><td className="bt-fact-value">{stats.totalTrades ?? 0}</td></tr>
                <tr><td>Average hold</td><td className="bt-fact-value">{holdLabel(run.tradeTotals?.avgHoldMinutes)}</td></tr>
              </>
            )}
            <tr>
              <td>What it changed</td>
              <td className="bt-fact-value">
                {changed === null
                  ? 'not bot-driven — no bot settings to differ from'
                  : changed.length === 0 ? 'nothing (the bot as configured)' : changed.join(', ')}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── WHAT IT TRADED ────────────────────────────────────────────────────────────────────────
          ⚠️ THE HEADING NOW SITS ABOVE THE TILES (owner report, 2026-10-30: *"sits between a table and a
          row of cards as if agentic AI couldn't decide which to put them in"*). It was placed directly
          above the TABLE, which put it below the stat tiles — so one section appeared to be two, with a
          heading in the seam. It heads the whole block now: tiles first (how much), table second (which
          ones).

          ⚠️ AND IT NO LONGER REPEATS THE COUNT. It read "Trades — 1027 closed" directly above a tile
          reading "1027 Closed trades". The tiles answer "how many" with four more numbers beside it; a
          heading that answers it again is the volume this page keeps being asked to shed. */}
      {showTrades && (
        <>
          <h4 className="bt-panel-head">Trades</h4>
          <TradeTable trades={run.trades} totals={run.tradeTotals} timeframe={run.timeframe} />
        </>
      )}

      {/* ⚠️ EVERYTHING SCORE-SHAPED IS COLLAPSED INTO ONE DETAILS BLOCK (owner direction, 2026-10-29).
          The results a run exists to give are the trades; a score-totals table and 2,000 scored bars
          sat ABOVE them and buried the answer under diagnostic numbers. Neither is deleted — the bar
          list is the only place a signal that never became a trade is visible, so it must remain — but
          both now sit one click behind a summary that says what they are for. */}
      {(run.totals || series) && (
        <details className="bt-scores-details">
          <summary className="bt-panel-head">
            Scoring detail{series ? ` · ${series.length.toLocaleString()} bar(s)` : ''}
          </summary>
          {/* ⚠️ "diagnostic: why a bar did or did not trade" WAS INLINE IN THE SUMMARY (owner report,
              2026-10-30). A `<summary>` is a control label; a clause explaining what the disclosure is
              FOR is a sentence about the content, so it lives inside as an `InfoNote` — visible as soon
              as the block opens, out of the way while it is closed. */}
          <InfoNote tone="neutral" label="What this shows">
            Every bar the run scored, and why it did or did not trade: the signal, the gated score, and
            whether the bot&rsquo;s own entry bar let it through. Diagnostic, not a result.
          </InfoNote>
          {run.totals && <ScoringTotals totals={run.totals} />}
          {series ? (
            <>
              {series.length > 100 && (
                <InfoNote
                  tone="neutral"
                  label="Rows shown"
                  meta={`${series.length.toLocaleString()} bars stored · 100 listed`}
                >
                  Sort a column to choose which 100 you see. The totals above cover all of them.
                </InfoNote>
              )}
              <ScoreTable scoreSeries={series} />
            </>
          ) : (
            <InfoNote tone="warning" label="No scores stored">
              This run stored no scores (it was made before 2026-10-26), so its scoring output is
              <strong> not recorded</strong> — which is not the same as &ldquo;no scores&rdquo;. Re-run it
              to capture them.
            </InfoNote>
          )}
        </details>
      )}

      {/* ⚠️ THE SAME `InfoNote` AS THE RESULT STEP'S "What this cannot claim" — same role, same tone,
          same label. This is what makes the two surfaces readable as one system. */}
      {Array.isArray(run.caveats) && run.caveats.length > 0 && (
        <InfoNote tone="warning" label="What this cannot claim">
          <ul>
            {run.caveats.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </InfoNote>
      )}

      {liveReference && (
        <InfoNote tone="neutral" label="Live reference">
          The bot&rsquo;s own record, <strong>not part of the comparison</strong>: {liveReference}
        </InfoNote>
      )}
    </div>
  );
}

/**
/**
 * RepeatCheck — does the SAME A→B change point the same way on MORE windows?
 *
 * Owner direction, 2026-10-27: *"a third would harden it … add 'repeats on N of M windows'"* — then
 * *"Yes do that"*, and then the reason it matters: *"I see huge potential for agentic AI to use it …
 * Agentic AI will be able to make adjustments. Re-test, and keep doing that over and over again for a
 * set period or target a significant level of improvement."*
 *
 * ⚠️ THIS COMPONENT NO LONGER DOES THE ARITHMETIC. It sends run ids to
 * `POST /api/backtest/repeat-check` and renders the answer. The maths lives once, in
 * `nest/src/modules/backtest/score-maths.ts`, so an agent calling the endpoint and a reader looking at
 * this panel cannot get different answers — the drift a second implementation would guarantee.
 *
 * ⚠️ IT WILL NOT GUESS A PAIR INTO EXISTENCE. The reader picks the period and both runs; a window that
 * cannot be measured comes back from the endpoint with a reason and is counted as NOT USABLE, never
 * dropped, and never rendered as a pass.
 */
function RepeatCheck({ protocolId, excludeIds, window1, onMeasured }) {
  /** Every extra window the reader has added. One row by default: two windows is the minimum. */
  const [rows, setRows] = useState([{ key: 1, period: '', aId: null, bId: null }]);
  const nextKey = useRef(2);

  const runsQuery = useQuery({
    queryKey: ['bt-runs', 'repeat', protocolId],
    queryFn: () => apiGet(`/api/backtest/runs?limit=50&protocolId=${encodeURIComponent(protocolId)}`),
    enabled: Boolean(protocolId),
    staleTime: 30_000,
  });
  const runs = runsQuery.data?.runs ?? runsQuery.data ?? [];

  const periods = useMemo(() => {
    const seen = new Map();
    for (const r of runs) {
      if (!r.period) continue;
      seen.set(r.period, (seen.get(r.period) ?? 0) + 1);
    }
    return [...seen.entries()]
      .filter(([p, n]) => n >= 2 && p !== window1.period)
      .map(([p, n]) => ({ period: p, runs: n }));
  }, [runs, window1.period]);

  const setRow = (key, patch) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const choosePeriod = (key, period) => {
    const picked = pickRepeatPair(runs, period, excludeIds);
    /**
     * ⚠️ `basis` TRAVELS WITH THE PAIR (#1144). 'experiment' means the API recorded these two as
     * iterations of the same loop, so the change between them is the change under test. 'created-order'
     * means nothing recorded it and the pair is an INFERENCE from timestamps — the panel says so,
     * because a guessed pair must not read like a recorded one.
     */
    setRow(key, {
      period,
      aId: picked.pair?.aId ?? null,
      bId: picked.pair?.bId ?? null,
      basis: picked.pair?.basis ?? null,
      fromIteration: picked.pair?.fromIteration ?? null,
      toIteration: picked.pair?.toIteration ?? null,
    });
  };

  /**
   * The full list sent to the endpoint: the tab's own pair first, then every configured row.
   *
   * ⚠️ THE ENDPOINT TAKES `{ windows: [...] }`, NOT A BARE ARRAY. It was verified with curl in that
   * shape and the client was sending the array itself, so every request returned 400 and both the
   * diff table and the verdict rendered their "cannot judge" placeholders — which look exactly like
   * missing data. A payload shape the server rejects is not a result; it is a silent no-op.
   *
   * ⚠️ AND IT SENDS WINDOW 1 ALONE. The diff table above reads window 1's totals from this answer, so
   * waiting for a SECOND window to exist before posting left that table showing `—` as though nothing
   * had been measured. One window is a valid request whose verdict is `cannot-judge` ("a repeat needs
   * at least two windows") — which is the truth, not a refusal.
   */
  const payload = useMemo(() => {
    const windows = [{ aId: window1.aId, bId: window1.bId, label: window1.period ?? 'this window' }];
    for (const r of rows) {
      if (r.aId && r.bId) windows.push({ aId: r.aId, bId: r.bId, label: r.period });
    }
    return { windows };
  }, [window1.aId, window1.bId, window1.period, rows]);
  const sent = window1.aId && window1.bId ? JSON.stringify(payload) : null;

  const check = useQuery({
    queryKey: ['bt-repeat-check', sent],
    queryFn: () => apiPost('/api/backtest/repeat-check', payload),
    enabled: Boolean(sent),
    staleTime: 30_000,
    retry: false,
  });

  // The diff table above reads window 1's direction counts from the same answer, so the panel and the
  // table cannot disagree about the same bars. A failure is passed up too, so the table can say the
  // rows are placeholders instead of leaving them to read as zeros.
  useEffect(() => {
    if (check.data) onMeasured?.(check.data, null);
    else if (check.isError) onMeasured?.(null, check.error);
  }, [check.data, check.isError, check.error, onMeasured]);

  const verdict = check.data?.verdict;
  const badge = {
    repeated: '🟢 REPEATED',
    'did-not-repeat': '🔴 DID NOT REPEAT',
    'no-change': '⚪ NO CHANGE',
    'cannot-judge': '⚪ CANNOT JUDGE',
  }[verdict ?? 'cannot-judge'];

  /**
   * ⚠️ THE VERDICT IS AN OUTCOME, SO IT IS AN `InfoNote` WITH A TONE (owner direction, 2026-10-30).
   * It was a `p.bt-panel-note` carrying its own emoji — the same statement in a fifth style, on the one
   * line of the panel that a reader actually needs to be stopped by. The tone map is the app's own
   * badminton: repeated = success, did not repeat = critical, anything the API could not judge = warning
   * (⚠️ NOT neutral: "cannot judge" is a gap, and a neutral box reads as "nothing to report").
   */
  const verdictNote = {
    repeated: { label: 'Does it hold? — repeated', tone: 'success' },
    'did-not-repeat': { label: 'Does it hold? — did not repeat', tone: 'critical' },
    'no-change': { label: 'Does it hold? — no change', tone: 'neutral' },
    'cannot-judge': { label: 'Does it hold? — cannot judge', tone: 'warning' },
  }[verdict ?? 'cannot-judge'];

  return (
    <>
      <h4 className="bt-panel-head">Does it hold on other windows?</h4>
      <InfoNote tone="neutral" label="How this works">
        One window cannot separate an improvement from luck. Add windows and the API measures the same
        A→B change on each: the verdict counts how many windows agree, and the A side must have been
        scored at the same capacity on every window (the B side likewise) or the comparison is{' '}
        <strong>refused rather than averaged</strong>.
      </InfoNote>

      {periods.length === 0 ? (
        <p className="pb-none">
          This protocol has no other stored window with two runs in it. Run the pair again over a
          different period first — until then there is nothing to repeat on, which is not the same as
          &ldquo;it held&rdquo;.
        </p>
      ) : (
        <>
          {rows.map((row) => {
            /**
             * ⚠️ THE A/B LISTS OFFER ONLY RUNS THAT CAN BE LINED UP BAR BY BAR. A run stored before the
             * score series recorded `time` has scores but cannot be joined per bar, so offering it let
             * the reader pick a pair the endpoint would then refuse — with the reason shown, but after
             * the fact. Both counts are kept so the warning can say WHY a window has nothing to offer,
             * rather than looking like the period is empty.
             */
            const onPeriodAll = row.period
              ? runs.filter((r) => r.period === row.period && !excludeIds.includes(r.id))
              : [];
            const onPeriod = onPeriodAll.filter((r) => r.hasScores !== false && r.hasInstants !== false);
            return (
              <p className="bt-panel-note" key={row.key}>
                <label>
                  Window{' '}
                  <select className="ff-select" value={row.period} onChange={(e) => choosePeriod(row.key, e.target.value)}>
                    <option value="">choose a stored period…</option>
                    {periods.map((p) => (
                      <option key={p.period} value={p.period}>
                        {p.period} ({p.runs} run(s))
                      </option>
                    ))}
                  </select>
                </label>{' '}
                {row.period && onPeriod.length < 2 && (
                  <span>
                    ⚠️ that window has {onPeriodAll.length} run(s) but only {onPeriod.length} can be
                    lined up bar by bar — a run needs stored scores <em>and</em> a per-bar instant.
                  </span>
                )}
                {row.period && onPeriod.length >= 2 && (
                  <>
                    <label>
                      A{' '}
                      <select className="ff-select" value={row.aId ?? ''} onChange={(e) => setRow(row.key, { aId: e.target.value })}>
                        {onPeriod.map((r) => (
                          <option key={r.id} value={r.id}>{r.id.slice(0, 8)} · {shortStamp(r.createdAt)}</option>
                        ))}
                      </select>
                    </label>{' '}
                    <label>
                      B{' '}
                      <select className="ff-select" value={row.bId ?? ''} onChange={(e) => setRow(row.key, { bId: e.target.value })}>
                        {onPeriod.map((r) => (
                          <option key={r.id} value={r.id}>{r.id.slice(0, 8)} · {shortStamp(r.createdAt)}</option>
                        ))}
                      </select>
                    </label>{' '}
                  </>
                )}
                {rows.length > 1 && (
                  <button
                    type="button"
                    className="bt-panel-btn bt-panel-btn-sm"
                    onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                  >
                    Remove
                  </button>
                )}
                {row.aId && row.bId && (
                  <span className="pb-field-note">
                    {' '}
                    {row.basis === 'experiment'
                      ? `🟢 recorded loop — iteration ${row.fromIteration} → ${row.toIteration}`
                      : '⚠️ inferred pair — no experiment recorded these two as consecutive attempts, so the change between them may not be the change you meant'}
                  </span>
                )}
              </p>
            );
          })}
          <p className="bt-panel-note">
            <button
              type="button"
              className="bt-panel-btn bt-panel-btn-sm"
              onClick={() => {
                const key = nextKey.current;
                nextKey.current += 1;
                setRows((prev) => [...prev, { key, period: '', aId: null, bId: null }]);
              }}
            >
              ＋ Add another window
            </button>{' '}
            — three or more windows make the verdict harder to satisfy, which is the point.
          </p>
        </>
      )}

      {check.isError && (
        <p className="pb-none">
          ⚠️ The repeat check could not be read ({check.error?.status ?? 'no status'}) — that is unknown,
          not &ldquo;it did not repeat&rdquo;.
        </p>
      )}

      {check.data?.windows?.length > 0 && (
        <>
          <div className="bt-table-wrap">
            <table className="bt-table bt-facts-table">
              <caption className="sr-only">The same change measured on each window</caption>
              <thead>
                <tr>
                  <th scope="col">Window</th>
                  <th scope="col">Run A → B</th>
                  <th scope="col" className="bt-num">Bars</th>
                  <th scope="col" className="bt-num">Δ Σ signal %</th>
                  <th scope="col" className="bt-num">Capacity A / B</th>
                </tr>
              </thead>
              <tbody>
                {check.data.windows.map((w) => (
                  <tr key={`${w.aId}-${w.bId}`}>
                    <td>{w.label}</td>
                    <td className="pb-mono">
                      {w.blocked
                        ? <span title={w.reason}>— {w.reason ?? w.blocked}</span>
                        : `${String(w.aId).slice(0, 8)} → ${String(w.bId).slice(0, 8)}`}
                    </td>
                    <td className="pb-mono bt-num">{w.blocked ? '—' : w.bars}</td>
                    <td className="pb-mono bt-num">
                      {w.blocked ? '—' : `${w.deltaSignalSum > 0 ? '+' : ''}${num1(w.deltaSignalSum)}`}
                    </td>
                    <td className="pb-mono bt-num">
                      {w.blocked ? '—' : `${num1(w.capacityA)} / ${num1(w.capacityB)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <InfoNote
            tone={check.isLoading ? 'neutral' : verdictNote.tone}
            label={check.isLoading ? 'Checking' : verdictNote.label}
            role="status"
          >
            {check.isLoading ? (
              'Comparing the chosen windows…'
            ) : (
              <>
                <strong>{badge}</strong>
                {check.data.counted
                  ? ` — ${check.data.counted.usable} of ${check.data.counted.total} window(s) usable`
                  : ''}
                {check.data.counted?.blocked ? `, ${check.data.counted.blocked} cannot be compared` : ''}
                {check.data.counted?.partial
                  ? `, ${check.data.counted.partial} measured on partly different bars`
                  : ''}
                {check.data.reason ? ` · ${check.data.reason}` : ''}
              </>
            )}
          </InfoNote>
        </>
      )}
    </>
  );
}

/**
 * A vs B — the DIFFERENCE, summarised (owner direction: *"so that the user doesn't need to examine
 * every row of data"*).
 *
 * ⚠️ IT JOINS ON THE BAR INSTANT, and reports the unmatched counts. Two runs over different windows
 * share only the bars both scored; silently comparing the overlap as if it were the whole picture
 * would be the "plausible number, no error" defect this page keeps fixing.
 *
 * ⚠️ IT REFUSES THREE PAIRS RATHER THAN APPROXIMATING THEM: a different protocol, a run with no
 * stored scores, and a run stored before the series recorded the bar instant. Each of those would
 * otherwise render a number that reads as a difference.
 */
export function RunDiffPanel({ aId, bId, showTrades = true }) {
  const a = useRun(aId);
  const b = useRun(bId);
  /** Window 1's totals + direction counts, as measured by the API (see window1Delta below). */
  const [window1Delta, setWindow1Delta] = useState(null);
  /**
   * Why `window1Delta` is missing, when the API refused or failed. Kept SEPARATE from the delta so a
   * failed read renders differently from "not measured yet" — printed side by side they are the same
   * row of dashes, and dashes read as zero.
   */
  const [window1Err, setWindow1Err] = useState(null);

  if (!aId || !bId) {
    return (
      <InfoNote tone="neutral" label="Nothing to compare yet">
        A difference needs two runs. Accept a run as the <strong>A</strong> baseline, then a later run
        becomes <strong>B</strong> — the summary appears here.
      </InfoNote>
    );
  }
  if (a.isLoading || b.isLoading) return <InfoNote tone="neutral" label="Measuring">Comparing the two runs…</InfoNote>;
  if (a.error || b.error) {
    return (
      <InfoNote tone="critical" label="A run could not be read">
        One of these runs could not be read
        {a.error?.status === 404 || b.error?.status === 404 ? ' — it was deleted' : ''}. A failed read
        is not &ldquo;no change&rdquo;; nothing is being compared.
      </InfoNote>
    );
  }

  const sa = a.data?.scoreSeries;
  const sb = b.data?.scoreSeries;
  /**
   * ⚠️ A DIFFERENT PROTOCOL IS NOT A DIFFERENCE. Two protocols score different directives against
   * different symbols, so subtracting one from the other produces numbers that look like a result
   * and mean nothing. This is a guard on the PAYLOADS, not on the request that fetched them — the
   * page filters B by protocol, but a filter cannot prove what came back.
   */
  const protoA = a.data?.protocolId;
  const protoB = b.data?.protocolId;
  if (protoA && protoB && protoA !== protoB) {
    return (
      <InfoNote tone="warning" label="Not comparable — different protocols">
        <strong>{protoA}</strong> vs <strong>{protoB}</strong>.
        {' '}A protocol scores its own directives against its own symbol, so subtracting one from the
        other would produce numbers with no meaning. Accept a baseline from this protocol, then compare
        against it.
      </InfoNote>
    );
  }
  if (!sa || !sb) {
    return (
      <InfoNote tone="warning" label="Not comparable — no scores stored">
        One of these runs has <strong>no stored scores</strong>, so no difference can be computed. That
        is missing data, not &ldquo;no change&rdquo; — re-run the older side to capture its scores.
      </InfoNote>
    );
  }

  // ⚠️ KEY ON `time` (the bar instant), NOT `date`. An intraday run has many bars per date, so a
  // date-keyed join made a run compared with ITSELF report 954 of 1,722 bars as changed.
  const keyOf = (s) => s.time ?? s.date;
  /**
   * Runs stored BEFORE the score series recorded the instant cannot be differenced per bar.
   * A fallback to `date` would not fail — it would collapse every intraday bar of a day onto one
   * row and report the survivors as "changed" (measured 2026-10-27: two IDENTICAL 1h runs showed
   * 21 signal changes by date and 0 by instant). Refusing is the only honest answer, so the panel
   * says why instead of printing a fabricated difference.
   */
  const instantMissing = sa.some((s) => !s.time) || sb.some((s) => !s.time);
  const mapB = new Map(sb.map((s) => [keyOf(s), s]));
  const shared = [];
  for (const s of sa) {
    const o = mapB.get(keyOf(s));
    if (o) shared.push({ bar: keyOf(s), a: s, b: o });
  }
  /**
   * ⚠️ `onlyA`/`onlyB` ARE NOT COMPUTED HERE ANY MORE. The endpoint returns them (`onlyA`, `onlyB`,
   * `barsA`, `barsB`) from the same series join, so the panel prints its numbers instead of a second
   * implementation's. The local `shared` join below exists ONLY to render the movers table from bars
   * the client already holds — it is presentation, not arithmetic.
   */

  const dSignalPct = shared.map((r) => Number(r.b.signalPct ?? r.b.score) - Number(r.a.signalPct ?? r.a.score));
  const dOppPct = shared.map((r) => Number(r.b.opportunityPct ?? 0) - Number(r.a.opportunityPct ?? 0));
  const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const signalChanged = shared.filter((r) => r.a.signal !== r.b.signal).length;
  const passedChanged = shared.filter((r) => Boolean(r.a.passedBar) !== Boolean(r.b.passedBar)).length;

  /**
   * ⚠️ THE TOTALS AND THE UP/DOWN COUNTS COME FROM THE API (2026-10-27). `window1Delta` is the same
   * payload `POST /api/backtest/repeat-check` returns for this window — computed by `score-maths.ts`,
   * which the repeat check below also calls. Recomputing them here would be the second implementation
   * that drifts (and this page has already paid for one date-vs-instant divergence).
   *
   * The per-bar `shared` join below is NOT part of that: it exists to RENDER the movers table from bars
   * the client already holds.
   */
  const movers = [...shared]
    .map((r) => ({ ...r, d: Number(r.b.signalPct ?? r.b.score) - Number(r.a.signalPct ?? r.a.score) }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    .slice(0, 10);

  /**
   * The only place on this panel where a DIFFERENCE is an IMPROVEMENT.
   *
   * ⚠️ Uses the same two classes the result tiles use for their border (`is-better` / `is-worse`), so
   * "B beat A" reads identically here and on the Result step. Deliberately NOT applied to the score
   * Δ cells: this panel's own note states that a higher score is not a verdict, and colouring it green
   * would contradict the sentence printed directly beneath it.
   *
   * ⚠️ `null` on either side is "cannot say", never a zero difference — a run with no P&L recorded has
   * not lost nothing, it has recorded nothing.
   */
  const pnlVerdict = (() => {
    const pa = a.data?.stats?.totalPnl;
    const pb = b.data?.stats?.totalPnl;
    if (pa == null || pb == null) return { cls: '', label: null };
    const d = Number(pb) - Number(pa);
    if (Math.abs(d) < 1e-9) return { cls: '', label: 'no change' };
    return d > 0
      ? { cls: 'bt-delta--better', label: 'better' }
      : { cls: 'bt-delta--worse', label: 'worse' };
  })();

  return (
    <div className="bt-panel bt-ab-panel">
      <h3 className="bt-panel-head">
        A → B difference — <code>{String(aId).slice(0, 8)}</code> vs <code>{String(bId).slice(0, 8)}</code>
      </h3>

      {instantMissing ? (
        <InfoNote tone="warning" label="Not comparable — no bar instants">
          At least one of these runs was stored before the score series recorded the <em>instant</em> of
          each bar, so every intraday bar of one day shares a single date and a per-bar join would report{' '}
          <strong>invented changes</strong>. Re-run the older side to capture its instants — a missing
          comparison is not &ldquo;no change&rdquo;.
        </InfoNote>
      ) : shared.length === 0 ? (
        <InfoNote
          tone="warning"
          label="Not comparable — no shared bars"
          meta={`${sa.length.toLocaleString()} bars in A · ${sb.length.toLocaleString()} bars in B`}
        >
          The two runs scored <strong>no bar in common</strong>, so there is nothing to difference. They
          describe different windows — a data mismatch, not a null result.
        </InfoNote>
      ) : (
        <>
          <div className="bt-table-wrap">
            <table className="bt-table bt-facts-table">
              <caption className="sr-only">Summary of the difference between run A and run B</caption>
              <thead>
                <tr>
                  <th scope="col">Score</th>
                  <th scope="col" className="bt-num">A total</th>
                  <th scope="col" className="bt-num">B total</th>
                  <th scope="col" className="bt-num">Δ total</th>
                  <th scope="col" className="bt-num">Improved</th>
                  <th scope="col" className="bt-num">Worsened</th>
                  <th scope="col" className="bt-num">Unchanged</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Signal %', window1Delta?.scores?.signal],
                  ['Opportunity %', window1Delta?.scores?.opportunity],
                  ['Opp points', window1Delta?.scores?.points],
                ].map(([label, s]) => {
                  const av = s?.sumA;
                  const bv = s?.sumB;
                  const delta = s?.delta;
                  return (
                    <tr key={label}>
                      <td>{label}</td>
                      <td className="pb-mono bt-num">{num1(av)}</td>
                      <td className="pb-mono bt-num">{num1(bv)}</td>
                      <td className={`pb-mono bt-num ${delta > 0 ? 'bt-delta-up' : delta < 0 ? 'bt-delta-down' : ''}`}>
                        {delta > 0 ? '+' : ''}{num1(delta)}
                      </td>
                      <td className="pb-mono bt-num">{s ? s.direction.up : '…'}</td>
                      <td className="pb-mono bt-num">{s ? s.direction.down : '…'}</td>
                      <td className="pb-mono bt-num">{s ? s.direction.same : '…'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {window1Err ? (
            <InfoNote tone="critical" label="The comparison could not be measured">
              The API answered {window1Err?.status ?? 'with no status'}
              {window1Err?.message ? ` — ${window1Err.message}` : ''}. The rows above are placeholders,
              not zeros, and <strong>nothing has been said about this change</strong>.
            </InfoNote>
          ) : (
            !window1Delta && (
              <InfoNote tone="neutral" label="Measuring">
                Comparing the two runs on the bars they share… the totals fill in as soon as the API
                answers, and are left blank rather than guessed.
              </InfoNote>
            )
          )}

          <div className="bt-table-wrap">
            <table className="bt-table bt-facts-table">
              <caption className="sr-only">Summary of the difference between run A and run B</caption>
              <tbody>
                <tr>
                  <td>Bars compared</td>
                  <td>{window1Delta?.bars ?? '…'}</td>
                  <td>Only in A / only in B</td>
                  <td>
                    {window1Delta
                      ? `${window1Delta.onlyA ?? 0} / ${window1Delta.onlyB ?? 0} of ${window1Delta.barsA ?? '?'} / ${window1Delta.barsB ?? '?'}`
                      : '…'}
                  </td>
                </tr>
                <tr><td>Signal changed</td><td>{signalChanged} bar(s)</td><td>Entry-bar verdict changed</td><td>{passedChanged} bar(s)</td></tr>
                <tr><td>Mean Δ signal %</td><td>{mean(dSignalPct).toFixed(2)}</td><td>Mean Δ opportunity %</td><td>{mean(dOppPct).toFixed(2)}</td></tr>
                {showTrades && (
                  <tr>
                    <td>Trades A → B</td>
                    <td>{a.data?.stats?.totalTrades ?? 0} → {b.data?.stats?.totalTrades ?? 0}</td>
                    <td>Total P&amp;L A → B</td>
                    {/* ⚠️ THE ONE CELL HERE WHERE "BETTER" IS TRUE AND MEASURABLE (owner direction,
                        2026-10-30: *"Using the same styling principles for highlighting positive or
                        negative change in the comparison process"*). More money is better; more trades
                        is not — so the treatment is applied here and nowhere near the score Δ cells,
                        where a higher score is explicitly NOT a verdict and a green number would argue
                        with the sentence right below it. */}
                    <td className={`pb-mono ${pnlVerdict.cls}`}>
                      {money(a.data?.stats?.totalPnl)} → {money(b.data?.stats?.totalPnl)}
                      {pnlVerdict.label && <> <span className="bt-delta-tag">{pnlVerdict.label}</span></>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/*
            ⚠️ THE HONEST LIMIT OF THIS PANEL, stated where the verdict is read. The owner asked whether
            a change is a good long-term change or "just lucky for the dataset being tested" — this
            panel CANNOT answer that, and a bigger number in one window is not evidence of edge. What
            it does answer: how much moved, in which direction, on how many bars. Persistence across a
            SECOND window is the missing measurement, and nothing here substitutes for it.
          */}
          <InfoNote tone="warning" label="What this comparison cannot claim">
            <strong>One window cannot separate an improvement from luck.</strong> These counts say how
            much moved and which way; they do not say it will hold. The evidence that a change is real
            is that it repeats on a window you did not tune it on — re-run the same A/B pair over a
            different period, and treat a win on a single window as unproven. Counts treat a{' '}
            <em>higher</em> score as better for all three, so read them as &ldquo;moved up&rdquo; /{' '}
            &ldquo;moved down&rdquo; rather than as a verdict on the protocol.
          </InfoNote>

          {movers.every((m) => m.d === 0) ? (
            <InfoNote tone="neutral" label="No bar moved">
              No bar&rsquo;s signal score changed between these two runs, so the ten-biggest-movers list
              would be ten rows of zero and is not shown. If a setting changed and nothing moved, that
              setting does not reach the score path — the entry-bar verdict is a separate row above.
            </InfoNote>
          ) : (
            <>
              <h4 className="bt-panel-head">Biggest movers (top 10 by |Δ signal %|)</h4>
          <div className="bt-table-wrap">
            <table className="bt-table">
              <caption className="sr-only">The ten bars whose signal score moved most</caption>
              <thead>
                <tr>
                  <th scope="col">Bar</th>
                  <th scope="col" className="bt-num">A signal %</th>
                  <th scope="col" className="bt-num">B signal %</th>
                  <th scope="col" className="bt-num">Δ</th>
                  <th scope="col">A signal</th>
                  <th scope="col">B signal</th>
                </tr>
              </thead>
              <tbody>
                {movers.map((m) => (
                  <tr key={m.bar}>
                    <td className="pb-mono">{barLabel(m.a ?? m.b)}</td>
                    <td className="pb-mono bt-num">{m.a.signalPct ?? m.a.score}</td>
                    <td className="pb-mono bt-num">{m.b.signalPct ?? m.b.score}</td>
                    <td className="pb-mono bt-num">{m.d > 0 ? '+' : ''}{m.d.toFixed(1)}</td>
                    <td>{m.a.signal}</td>
                    <td>{m.b.signal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pb-field-note">
            ⚠️ Bars only in one run are <strong>not</strong> compared — a different window cannot be
            differenced. If the counts above are large, re-run both sides on the same stored period.
          </p>
            </>
          )}

          {/*
            ⚠️ THE REPEAT CHECK SITS OUTSIDE THE "did anything move?" BRANCH (measured 2026-10-27). It
            used to be rendered inside the else-branch, so on a pair where no bar's signal score moved
            the whole section disappeared — including the API measurement that fills the totals table
            ABOVE it, which then showed `—` forever. "Nothing moved" is the case where the verdict
            matters most (a setting that never reaches the score path looks exactly like this), so the
            section must not be the thing that gets hidden.
          */}
          <RepeatCheck
            protocolId={protoA}
            excludeIds={[aId, bId]}
            window1={{
              period: a.data?.measuredPeriod?.name ?? a.data?.period ?? null,
              aId,
              bId,
            }}
            onMeasured={(d, err) => {
              setWindow1Delta(d?.windows?.[0] ?? null);
              setWindow1Err(err ?? null);
            }}
          />
        </>
      )}
    </div>
  );
}
