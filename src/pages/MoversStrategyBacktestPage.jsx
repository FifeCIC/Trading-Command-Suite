/**
 * MoversStrategyBacktestPage — `/lab/movers-strategy-backtest` (#1319; reshaped 2026-11-19).
 *
 * FOR ONE STRATEGY THAT CHOOSES ITS INSTRUMENT EACH DAY. Every other backtest page answers "would this
 * protocol have worked on THIS symbol?". This one answers the second question on top of it: "which
 * symbols was it even allowed to trade today?" — so the output is a per-day ranking plus the P/L of
 * only the symbols it picked.
 *
 * ── WHY THIS IS NOT A `subject` ON `/lab/backtest-strategies` ───────────────────────────────────
 * `BacktestPage.jsx` renders one symbol's curve. This result is a candidate list × per day. It reuses
 * the ENGINE (`POST /api/backtest/selection-run` calls `run()` once per selected symbol) and the
 * presentation components — not the page.
 *
 * ── WHAT THE FIRST VERSION GOT WRONG, AND WHAT REPLACED IT ─────────────────────────────────────
 * It offered every protocol in the app as a dropdown and every stored dataset as another, then ranked
 * all ten symbols of `movers-losers-2026-11-10` on all five sessions in that window. The ten symbols
 * are the losers of 11-10, so on the four earlier days the "top 3 movers" were ordinary names moving
 * ±3%, and the candidate list itself had been chosen with knowledge of how 11-10 ended.
 *
 * Now: a LONG/SHORT switch bound to the strategy's own two protocols, day toggles covering only the
 * datasets whose names carry a day, and ONE RUN PER DAY. The backend refuses a dataset whose window
 * does not contain its own answer day, so the page cannot silently rank a warm-up session again.
 *
 * ⚠️ THE CUTOFF IS NOT A SETTING TO CASUALLY RAISE. The ranking reads bars at or before `cutoffUtc`
 * ONLY, and entries before it are dropped. Rank on a day's full move and trade from the open and you
 * score the strategy against the answer key: a beautiful number, and a strategy that cannot exist
 * live. The backend enforces it; the copy on screen explains it so nobody "fixes" it later.
 *
 * ⚠️ THE RESIDUAL BIAS IS SHOWN, NOT BURIED. A dataset's candidate list was built from that day's
 * close-to-close move, so the LIST knows the outcome even though the ranking does not. Every run
 * returns that sentence in `caveats`, and it is rendered with the results. Removing it needs a
 * cutoff-time screen over the whole market (#1321); having more than one day per side needs a
 * repeatable builder (#1322).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import StatCard from '../components/backtest/StatCard.jsx';
// ⚠️ `StatCard` is styled by the shared backtest panel base, which is imported where it is used rather
// than globally — `CurrentStrategyPage.jsx` does the same. Without this the tiles render as bare text
// with no grid, and nothing reports it.
import '../components/backtest/backtest-panel-base.css';
import MoversDepthPanel from '../components/backtest/MoversDepthPanel.jsx';
import NoticeBlock from '../components/NoticeBlock.jsx';
import { noticeFromError } from '../core/notices/from-error.js';
import { useSort, SortableTh } from '../core/use-sort';
import './MoversStrategyBacktestPage.css';

/** The strategy's two legs. Ids, not names — a name is not an identifier. */
const LEGS = [
  { key: 'long', protocolId: 'movers-v1-long', label: 'Long', side: 'winners', blurb: 'rides the day’s top gainers' },
  { key: 'short', protocolId: 'movers-v1-short', label: 'Short', side: 'losers', blurb: 'shorts the day’s top losers' },
];

const TOP_N_OPTIONS = [1, 2, 3, 5];

/** US session opens 09:30 ET; the cutoff is expressed in UTC and labelled with its ET equivalent. */
const CUTOFF_OPTIONS = [
  { utc: '15:00', et: '10:00', label: '30 min in' },
  { utc: '15:30', et: '10:30', label: '1 hour in' },
  { utc: '16:30', et: '11:30', label: '2 hours in' },
];

/**
 * How long to wait between day runs. This is a THROTTLE, not a simulation speed: each day is a real
 * request that finishes when it finishes. "Watch" exists so a reader can follow the ranking appear
 * day by day instead of all at once.
 */
const PACE_OPTIONS = [
  { id: 'fast', label: 'Fast', gapMs: 0 },
  { id: 'normal', label: 'Normal', gapMs: 400 },
  { id: 'watch', label: 'Watch', gapMs: 1500 },
];

const RUN_TIMEOUT_MS = 600_000;

const fmtPct = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : `${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(1)}%`);
const fmtMoney = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** `2026-11-10` → `Mon 10 Nov`. Formatted from the string in UTC so no local timezone can shift it. */
function dayLabel(date) {
  if (!date) return '—';
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function elapsedLabel(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function MoversStrategyBacktestPage() {
  const [legKey, setLegKey] = useState('long');
  const [selected, setSelected] = useState([]);
  // ⚠️ ONE SYMBOL BY DEFAULT. Three picks × five days produced more rows than anyone can read, and the
  // question ("why does the strategy lose on a +430% mover?") is answered by ONE symbol's session.
  const [topN, setTopN] = useState(1);
  const [cutoffUtc, setCutoffUtc] = useState('15:30');
  const [paceId, setPaceId] = useState('normal');
  /** Ask the run for the per-bar timeline. Off costs nothing; on is what the depth panel renders. */
  const [detailOn, setDetailOn] = useState(true);
  const [focusKey, setFocusKey] = useState(null);

  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState(null); // { queue, done, current, startedAt, stopped }
  const [now, setNow] = useState(() => Date.now());
  const stopRef = useRef(false);

  const leg = LEGS.find((l) => l.key === legKey) ?? LEGS[0];
  const pace = PACE_OPTIONS.find((p) => p.id === paceId) ?? PACE_OPTIONS[1];
  const running = Boolean(progress?.current);

  // ⚠️ NO `.catch(() => …)`. Swallowing the error makes a failed request render as "no datasets",
  // which reads as a fact about the data rather than a fact about the connection — and TanStack then
  // stops retrying because the promise RESOLVED.
  const datasetsQuery = useQuery({
    queryKey: ['bt-movers-datasets'],
    queryFn: () => apiGet('/api/backtest/movers-datasets'),
    retry: 2,
  });
  const protocolsQuery = useQuery({
    queryKey: ['scoring-protocols'],
    queryFn: () => apiGet('/api/scoring/protocols'),
    retry: 2,
  });

  // ⚠️ MEMOISED, NOT REBUILT PER RENDER. The `[]` fallback is a NEW array every render, which would
  // make `daysForLeg` new every render, which would re-run the default-selection effect below with a
  // changed dependency — a render loop before the query resolves.
  const datasets = useMemo(
    () => (Array.isArray(datasetsQuery.data?.datasets) ? datasetsQuery.data.datasets : []),
    [datasetsQuery.data],
  );
  const excluded = useMemo(
    () => (Array.isArray(datasetsQuery.data?.excluded) ? datasetsQuery.data.excluded : []),
    [datasetsQuery.data],
  );

  /** The legs this install can actually run, by checking the protocol ids exist and are active. */
  const legAvailability = useMemo(() => {
    const list = Array.isArray(protocolsQuery.data?.protocols) ? protocolsQuery.data.protocols : null;
    const byId = new Map((list ?? []).map((p) => [p.id, p]));
    return LEGS.map((l) => {
      if (!list) return { ...l, available: null, why: 'the protocol list could not be read' };
      const found = byId.get(l.protocolId);
      if (!found) return { ...l, available: false, why: `${l.protocolId} is not registered` };
      if (found.active === false) return { ...l, available: false, why: `${l.protocolId} is inactive` };
      return { ...l, available: true, why: null, name: found.name };
    });
  }, [protocolsQuery.data]);

  const currentLegState = legAvailability.find((l) => l.key === legKey);

  /** Datasets whose own name says they hold this leg's side, newest day last. */
  const daysForLeg = useMemo(
    () => datasets.filter((d) => d.side === leg.side).sort((a, b) => a.answerDate.localeCompare(b.answerDate)),
    [datasets, leg.side],
  );
  const datasetByName = useMemo(() => new Map(datasets.map((d) => [d.name, d])), [datasets]);

  // Keep the selection inside the current leg: switching Long → Short must not leave winners days
  // ticked, because the backend refuses that pairing and the page would then look broken.
  //
  // ⚠️ TRACKED BY LEG, NOT BY "is the selection empty". Deriving the default from emptiness means the
  // effect re-fires after the reader presses **None**, and it means a leg whose lists have not loaded
  // yet is indistinguishable from a leg with no lists. `selectedLeg` records which leg the current
  // ticks belong to, and every return path below hands React the SAME array when nothing changed —
  // a new-but-equal array would re-render forever.
  const [selectedLeg, setSelectedLeg] = useState(null);
  useEffect(() => {
    if (!daysForLeg.length) return;
    if (selectedLeg === leg.side) {
      setSelected((prev) => {
        const kept = prev.filter((name) => daysForLeg.some((d) => d.name === name));
        return kept.length === prev.length ? prev : kept;
      });
      return;
    }
    setSelected(daysForLeg.map((d) => d.name));
    setSelectedLeg(leg.side);
  }, [daysForLeg, leg.side, selectedLeg]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const toggleDay = useCallback((name) => {
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }, []);

  const runQueue = useMemo(
    () => [...selected].sort((a, b) => (datasetByName.get(a)?.answerDate ?? a).localeCompare(datasetByName.get(b)?.answerDate ?? b)),
    [selected, datasetByName],
  );

  const canRun = !running && runQueue.length > 0 && currentLegState?.available !== false;

  async function runAll() {
    stopRef.current = false;
    setResults([]);
    setProgress({ queue: runQueue, done: 0, current: runQueue[0], startedAt: Date.now(), stopped: false });
    setNow(Date.now());

    const collected = [];
    for (let i = 0; i < runQueue.length; i += 1) {
      if (stopRef.current) break;
      const name = runQueue[i];
      setProgress((p) => (p ? { ...p, current: name, done: i } : p));
      try {
        const res = await apiPost(
          '/api/backtest/selection-run',
          { datasetName: name, protocolId: leg.protocolId, topN, cutoffUtc, includeBreakdown: detailOn },
          { timeoutMs: RUN_TIMEOUT_MS },
        );
        collected.push(res);
      } catch (err) {
        // A failed day is REPORTED as a failed day — never dropped, never rendered as zero trades.
        // ⚠️ The notice keeps the server's own wording as `detail` AND gives it a stable code, so the
        // same failure is joinable across the UI, the log and an issue (#824/#826).
        collected.push({
          datasetName: name,
          answerDate: datasetByName.get(name)?.answerDate ?? null,
          notice: noticeFromError(err, 'TCS-SYS-007', {
            operation: `run the ${dayLabel(datasetByName.get(name)?.answerDate)} selection`,
          }),
        });
      }
      setResults([...collected]);
      setProgress((p) => (p ? { ...p, done: i + 1 } : p));
      if (i < runQueue.length - 1 && pace.gapMs) {
        await new Promise((resolve) => setTimeout(resolve, pace.gapMs));
      }
    }
    setProgress((p) => (p ? { ...p, current: null, done: Math.max(p.done, collected.length), stopped: stopRef.current } : p));
  }

  const okRuns = results.filter((r) => !r.notice);
  const failedRuns = results.filter((r) => r.notice);

  const totals = useMemo(() => {
    const trades = okRuns.reduce((a, r) => a + Number(r.totals?.trades ?? 0), 0);
    const wins = okRuns.reduce((a, r) => a + Number(r.totals?.wins ?? 0), 0);
    const netPnl = okRuns.reduce((a, r) => a + Number(r.totals?.netPnl ?? 0), 0);
    const selections = okRuns.reduce((a, r) => a + Number(r.totals?.selections ?? 0), 0);
    return { trades, wins, netPnl, selections, winRate: trades ? (wins / trades) * 100 : null };
  }, [okRuns]);

  const caveats = useMemo(() => [...new Set(okRuns.flatMap((r) => r.caveats ?? []))], [okRuns]);

  /** One row per day, with the ranking it produced. */
  const dayRows = useMemo(
    () =>
      results.map((r) => {
        const day = r.days?.[0] ?? null;
        return {
          id: r.datasetName,
          answerDate: r.answerDate ?? datasetByName.get(r.datasetName)?.answerDate ?? '',
          ranked: day?.ranked ?? [],
          selected: day?.selected ?? [],
          candidates: r.candidates?.length ?? 0,
          trades: r.totals?.trades ?? null,
          winRate: r.totals?.winRate ?? null,
          netPnl: r.totals?.netPnl ?? null,
          excluded: r.totals?.engineTradesOutsideSelection ?? null,
          notice: r.notice ?? null,
        };
      }),
    [results, datasetByName],
  );

  /** Per symbol across every day it was picked on. `wins` is carried by the API, so this is exact. */
  const symbolRows = useMemo(() => {
    const bySymbol = new Map();
    for (const r of okRuns) {
      for (const s of r.perSymbol ?? []) {
        const cur = bySymbol.get(s.symbol) ?? { symbol: s.symbol, days: 0, trades: 0, wins: 0, netPnl: 0 };
        cur.days += 1;
        cur.trades += Number(s.trades ?? 0);
        cur.wins += Number(s.wins ?? 0);
        cur.netPnl += Number(s.netPnl ?? 0);
        bySymbol.set(s.symbol, cur);
      }
    }
    return [...bySymbol.values()].map((s) => ({
      ...s,
      winRate: s.trades ? (s.wins / s.trades) * 100 : null,
    }));
  }, [okRuns]);

  const daySort = useSort(dayRows, 'answerDate', 'desc');
  const symbolSort = useSort(symbolRows, 'netPnl', 'desc');

  /** Every symbol a run returned a timeline for — normally one per day when Top N is 1. */
  const depthEntries = useMemo(
    () =>
      okRuns.flatMap((r) =>
        (r.perSymbol ?? [])
          .filter((s) => s.detail?.bars?.length)
          .map((s) => ({
            key: `${r.datasetName}:${s.symbol}`,
            symbol: s.symbol,
            day: r.answerDate ?? datasetByName.get(r.datasetName)?.answerDate ?? '',
            detail: s.detail,
          })),
      ),
    [okRuns, datasetByName],
  );
  const focusedDepth = depthEntries.find((d) => d.key === focusKey) ?? depthEntries[0] ?? null;

  const selectedSymbols = useMemo(() => {
    const lines = daysForLeg
      .filter((d) => selected.includes(d.name))
      .map((d) => ({ name: d.name, answerDate: d.answerDate, symbols: d.symbols ?? [] }));
    const union = new Set(lines.flatMap((l) => l.symbols));
    return { lines, unionCount: union.size };
  }, [daysForLeg, selected]);

  return (
    <div className="mvp-page">
      {/* ── 1 · the leg ─────────────────────────────────────────────────────────────────────── */}
      <section className="mvp-block" aria-label="Strategy leg">
        <div className="mvp-row">
          <div className="mvp-seg" role="group" aria-label="Strategy leg">
            {legAvailability.map((l) => (
              <button
                key={l.key}
                type="button"
                className={`mvp-seg-btn${l.key === legKey ? ' mvp-seg-btn--on' : ''}`}
                aria-pressed={l.key === legKey}
                disabled={running || l.available === false}
                title={l.why ?? `${l.protocolId} · ${l.blurb}`}
                onClick={() => setLegKey(l.key)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="mvp-leg-note">
            <strong>{leg.label}</strong> — {leg.blurb}. Protocol <code>{leg.protocolId}</code>
            {currentLegState?.name ? ` (${currentLegState.name})` : ''}.
          </p>
        </div>
        {currentLegState?.available === false && (
          <p className="mvp-error" role="alert">
            The {leg.label} leg cannot run: {currentLegState.why}.
          </p>
        )}
        {currentLegState?.available === null && (
          <p className="mvp-note">
            Could not confirm the {leg.label} protocol exists — {currentLegState.why}. The Run button
            stays enabled so the server can answer, but a missing protocol will be reported as an error
            rather than as zero trades.
          </p>
        )}
      </section>

      {/* ── 2 · the days ────────────────────────────────────────────────────────────────────── */}
      <section className="mvp-block" aria-label="Days to test">
        <div className="mvp-block-head">
          <h2>Days</h2>
          <div className="mvp-head-actions">
            <button
              type="button"
              className="mvp-link-btn"
              disabled={running || !daysForLeg.length}
              onClick={() => setSelected(daysForLeg.map((d) => d.name))}
            >
              All
            </button>
            <button type="button" className="mvp-link-btn" disabled={running} onClick={() => setSelected([])}>
              None
            </button>
          </div>
        </div>

        {datasetsQuery.isError && (
          <NoticeBlock
            notice={noticeFromError(datasetsQuery.error, 'TCS-SYS-002', {
              operation: 'load the movers day lists',
            })}
          />
        )}

        {!datasetsQuery.isError && daysForLeg.length === 0 && (
          <p className="mvp-note">
            No stored list is a <strong>{leg.side}</strong> day. A day without a list cannot be tested —
            the list IS that day&apos;s screen.
          </p>
        )}

        <div className="mvp-chips" role="group" aria-label={`${leg.side} days`}>
          {daysForLeg.map((d) => {
            const on = selected.includes(d.name);
            return (
              <button
                key={d.name}
                type="button"
                className={`mvp-chip${on ? ' mvp-chip--on' : ''}`}
                aria-pressed={on}
                disabled={running}
                onClick={() => toggleDay(d.name)}
                title={d.note || d.name}
              >
                <span className="mvp-chip-day">{dayLabel(d.answerDate)}</span>
                <span className="mvp-chip-meta">
                  {d.symbols?.length ?? 0} symbols · {d.timeframe}
                </span>
              </button>
            );
          })}
        </div>

        {daysForLeg.length > 0 && (
          <p className="mvp-note">
            {daysForLeg.length} {leg.side} day{daysForLeg.length === 1 ? '' : 's'} stored.{' '}
            {excluded.length > 0
              ? `${excluded.length} other dataset(s) are not offered here — a day list must be named movers-{winners|losers}-YYYY-MM-DD, or there is no way to know which session it describes.`
              : 'Every stored dataset is a day list.'}
          </p>
        )}

        {selectedSymbols.lines.length > 0 && (
          <details className="mvp-symbols" open={selectedSymbols.lines.length === 1}>
            <summary>
              Which symbols? {selectedSymbols.unionCount} distinct across {selectedSymbols.lines.length} day
              {selectedSymbols.lines.length === 1 ? '' : 's'}
            </summary>
            {selectedSymbols.lines.map((l) => (
              <div key={l.name} className="mvp-symbol-line">
                <span className="mvp-symbol-day">{dayLabel(l.answerDate)}</span>
                <span className="mvp-symbol-list">{l.symbols.join(', ') || '—'}</span>
              </div>
            ))}
            <p className="mvp-note">
              These are the candidates the ranking chooses from on that day. They are not pre-filtered by
              the strategy — the protocol has to reject the ones it does not want.
            </p>
          </details>
        )}
      </section>

      {/* ── 3 · the settings ────────────────────────────────────────────────────────────────── */}
      <section className="mvp-block" aria-label="Run settings">
        <div className="mvp-settings">
          <div className="mvp-field">
            <span className="mvp-field-label">Trade the top</span>
            <div className="mvp-seg" role="group" aria-label="How many symbols per day">
              {TOP_N_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`mvp-seg-btn${n === topN ? ' mvp-seg-btn--on' : ''}`}
                  aria-pressed={n === topN}
                  disabled={running}
                  onClick={() => setTopN(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="mvp-field">
            <span className="mvp-field-label">Rank at (UTC · ET)</span>
            <div className="mvp-seg" role="group" aria-label="Ranking cutoff">
              {CUTOFF_OPTIONS.map((c) => (
                <button
                  key={c.utc}
                  type="button"
                  className={`mvp-seg-btn${c.utc === cutoffUtc ? ' mvp-seg-btn--on' : ''}`}
                  aria-pressed={c.utc === cutoffUtc}
                  disabled={running}
                  title={`${c.label} — ${c.et} ET`}
                  onClick={() => setCutoffUtc(c.utc)}
                >
                  {c.utc}
                  <em>{c.et}</em>
                </button>
              ))}
            </div>
          </div>

          <div className="mvp-field">
            <span className="mvp-field-label">Pace between days</span>
            <div className="mvp-seg" role="group" aria-label="Pace between day runs">
              {PACE_OPTIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`mvp-seg-btn${p.id === paceId ? ' mvp-seg-btn--on' : ''}`}
                  aria-pressed={p.id === paceId}
                  disabled={running}
                  onClick={() => setPaceId(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <label className="mvp-check">
            <input
              type="checkbox"
              checked={detailOn}
              disabled={running}
              onChange={(e) => setDetailOn(e.target.checked)}
            />
            <span>
              Record bar-by-bar detail
              <em>scores · price · move · decision · directive breakdown</em>
            </span>
          </label>
        </div>

        <p className="mvp-rule">
          ⏱ The ranking sees only bars at or before the cutoff, and an entry before it is not counted.
          Ranking on a day&apos;s full move and trading from the open would score the strategy against
          the answer key.
        </p>

        <div className="mvp-run-row">
          <button type="button" className="mvp-run" disabled={!canRun} onClick={runAll}>
            {running
              ? `Running ${dayLabel(progress?.current)}…`
              : `Run ${runQueue.length} day${runQueue.length === 1 ? '' : 's'}`}
          </button>
          {running && (
            <button type="button" className="mvp-stop" onClick={() => { stopRef.current = true; }}>
              Stop after this day
            </button>
          )}
          {!running && runQueue.length === 0 && <span className="mvp-note">Pick at least one day.</span>}
        </div>
      </section>

      {/* ── 4 · progress ────────────────────────────────────────────────────────────────────── */}
      {progress && (
        <section className="mvp-block mvp-block--run" aria-label="Run progress">
          <div className="mvp-progress-head">
            <span className="mvp-progress-count">
              {progress.done} of {progress.queue.length} day{progress.queue.length === 1 ? '' : 's'}
            </span>
            <span className="mvp-progress-clock">
              {elapsedLabel(now - progress.startedAt)}
              {progress.stopped ? ' · stopped' : ''}
            </span>
          </div>

          <div
            className="mvp-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.queue.length}
            aria-valuenow={progress.done}
            aria-label="Days completed"
          >
            {progress.queue.map((name, i) => {
              const failed = results.find((r) => r.datasetName === name)?.notice;
              const cls = failed
                ? 'mvp-seg-fill mvp-seg-fill--bad'
                : i < progress.done
                  ? 'mvp-seg-fill mvp-seg-fill--done'
                  : progress.current === name
                    ? 'mvp-seg-fill mvp-seg-fill--live'
                    : 'mvp-seg-fill';
              return (
                <span key={name} className="mvp-seg-slot" aria-hidden="true">
                  <span className={cls} />
                </span>
              );
            })}
          </div>

          <p className="mvp-progress-status" role="status" aria-live="polite">
            {progress.current
              ? `Running ${dayLabel(progress.current)} — ranking its ${datasetByName.get(progress.current)?.symbols?.length ?? '?'} candidates, then the engine on the symbols it picked.`
              : progress.stopped
                ? 'Stopped. Days already finished are shown below.'
                : 'Finished.'}
          </p>

          <ul className="mvp-log">
            {results.map((r) => (
              <li key={r.datasetName} className={r.notice ? 'mvp-log-line mvp-log-line--bad' : 'mvp-log-line'}>
                <span className="mvp-log-day">{dayLabel(r.answerDate ?? datasetByName.get(r.datasetName)?.answerDate)}</span>
                {r.notice ? (
                  <span>
                    {r.notice.title}
                    {r.notice.detail ? ` — ${r.notice.detail}` : ''}
                  </span>
                ) : (
                  <span>
                    picked <strong>{r.days?.[0]?.selected?.join(', ') || 'nothing'}</strong> —{' '}
                    {r.totals?.trades ?? 0} trade(s), {fmtMoney(r.totals?.netPnl)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 5 · results ─────────────────────────────────────────────────────────────────────── */}
      {results.length > 0 && (
        <>
          <div className="mvp-tallies">
            <StatCard
              value={String(okRuns.length)}
              label="Days measured"
              note={`Out of ${results.length} attempted${failedRuns.length ? `, ${failedRuns.length} failed` : ''}.`}
            />
            <StatCard
              value={String(totals.selections)}
              label="Picks made"
              note={`Top ${topN} of each day's list, chosen at ${cutoffUtc} UTC.`}
            />
            <StatCard
              value={String(totals.trades)}
              label="Trades"
              note="Trades the engine produced on the symbols a day picked, at or after the cutoff."
            />
            <StatCard
              value={totals.winRate == null ? '—' : `${totals.winRate.toFixed(1)}%`}
              label="Win rate"
              note="Across every kept trade. A blank means no trade was produced, not zero wins."
            />
            <StatCard
              value={fmtMoney(totals.netPnl)}
              label="Net P/L"
              note="Sum of the kept trades' P/L, after the engine's own costs."
            />
          </div>

          {failedRuns.length > 0 && (
            <div className="mvp-failures" role="alert">
              <p className="mvp-note">
                {failedRuns.length} day(s) failed and are excluded from the totals above. They are shown
                here rather than as zero-trade days.
              </p>
              {failedRuns.map((r) => (
                <NoticeBlock key={r.datasetName} notice={r.notice} compact />
              ))}
            </div>
          )}

          {caveats.length > 0 && (
            <ul className="mvp-caveats">
              {caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}

          <section className="mvp-block" aria-label="Result by day">
            <h2>Result by day</h2>
            <div className="mvp-scroll">
              <table className="mvp-table">
                <thead>
                  <tr>
                    <SortableTh col="answerDate" label="Day" api={daySort} buttonClassName="th-sort" firstDir="asc" />
                    <th scope="col">Ranked at cutoff</th>
                    <th scope="col">Traded</th>
                    <SortableTh col="candidates" label="Candidates" api={daySort} className="mvp-num" buttonClassName="th-sort" />
                    <SortableTh col="trades" label="Trades" api={daySort} className="mvp-num" buttonClassName="th-sort" />
                    <SortableTh col="winRate" label="Win %" api={daySort} className="mvp-num" buttonClassName="th-sort" />
                    <SortableTh col="netPnl" label="Net P/L" api={daySort} className="mvp-num" buttonClassName="th-sort" />
                    <SortableTh col="excluded" label="Excluded" api={daySort} className="mvp-num" buttonClassName="th-sort" />
                  </tr>
                </thead>
                <tbody>
                  {daySort.sorted.map((d) => (
                    <tr key={d.id} className={d.notice ? 'mvp-row--bad' : ''}>
                      <td className="mvp-nowrap">{dayLabel(d.answerDate)}</td>
                      <td>
                        {d.notice ? (
                          <span className="mvp-muted">{d.notice.title}</span>
                        ) : (
                          <span className="mvp-chips mvp-chips--inline">
                            {d.ranked.map((c) => (
                              <span
                                key={c.symbol}
                                className={`mvp-sym${c.selected ? ' mvp-sym--on' : ''}`}
                                title={c.reason || (c.movePct == null ? 'not measurable' : `rank ${c.rank}`)}
                              >
                                {c.symbol}
                                {c.movePct != null && <em>{fmtPct(c.movePct)}</em>}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="mvp-nowrap">
                        {d.notice ? '—' : d.selected.length ? <strong>{d.selected.join(', ')}</strong> : <span className="mvp-muted">nothing</span>}
                      </td>
                      <td className="mvp-num">{d.notice ? '—' : d.candidates}</td>
                      <td className="mvp-num">{d.notice ? '—' : d.trades}</td>
                      <td className="mvp-num">{d.notice ? '—' : d.winRate == null ? '—' : `${Number(d.winRate).toFixed(1)}%`}</td>
                      <td className={`mvp-num ${d.netPnl > 0 ? 'mvp-pos' : d.netPnl < 0 ? 'mvp-neg' : ''}`}>
                        {d.notice ? '—' : fmtMoney(d.netPnl)}
                      </td>
                      <td className="mvp-num mvp-muted">{d.notice ? '—' : d.excluded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mvp-block" aria-label="Result by symbol">
            <h2>Result by symbol</h2>
            {symbolRows.length === 0 ? (
              <p className="mvp-note">No symbol was traded in any day that finished.</p>
            ) : (
              <div className="mvp-scroll">
                <table className="mvp-table">
                  <thead>
                    <tr>
                      <SortableTh col="symbol" label="Symbol" api={symbolSort} buttonClassName="th-sort" firstDir="asc" />
                      <SortableTh col="days" label="Days picked" api={symbolSort} className="mvp-num" buttonClassName="th-sort" />
                      <SortableTh col="trades" label="Trades" api={symbolSort} className="mvp-num" buttonClassName="th-sort" />
                      <SortableTh col="winRate" label="Win %" api={symbolSort} className="mvp-num" buttonClassName="th-sort" />
                      <SortableTh col="netPnl" label="Net P/L" api={symbolSort} className="mvp-num" buttonClassName="th-sort" />
                    </tr>
                  </thead>
                  <tbody>
                    {symbolSort.sorted.map((s) => (
                      <tr key={s.symbol}>
                        <td><strong>{s.symbol}</strong></td>
                        <td className="mvp-num">{s.days}</td>
                        <td className="mvp-num">{s.trades}</td>
                        <td className="mvp-num">{s.winRate == null ? '—' : `${s.winRate.toFixed(1)}%`}</td>
                        <td className={`mvp-num ${s.netPnl > 0 ? 'mvp-pos' : s.netPnl < 0 ? 'mvp-neg' : ''}`}>
                          {fmtMoney(s.netPnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── 6 · bar-by-bar scrutiny ──────────────────────────────────────────────────────── */}
          <section className="mvp-block" aria-label="Bar by bar">
            <div className="mvp-block-head">
              <h2>Bar by bar</h2>
              {depthEntries.length > 1 && (
                <div className="mvp-chips" role="group" aria-label="Symbol and day to scrutinise">
                  {depthEntries.map((e) => (
                    <button
                      key={e.key}
                      type="button"
                      className={`mvp-chip mvp-chip--tight${e.key === focusedDepth?.key ? ' mvp-chip--on' : ''}`}
                      aria-pressed={e.key === focusedDepth?.key}
                      onClick={() => setFocusKey(e.key)}
                    >
                      <span className="mvp-chip-day">{e.symbol}</span>
                      <span className="mvp-chip-meta">{dayLabel(e.day)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {focusedDepth ? (
              <MoversDepthPanel symbol={focusedDepth.symbol} day={focusedDepth.day} detail={focusedDepth.detail} />
            ) : (
              <p className="mvp-note">
                No per-bar detail was returned. Turn on <strong>Record bar-by-bar detail</strong> above and
                run again — a run without it keeps one composite per bar and no decomposition.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
