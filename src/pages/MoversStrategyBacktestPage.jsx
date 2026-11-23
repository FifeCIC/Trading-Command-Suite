/**
 * MoversStrategyBacktestPage — `/lab/movers-strategy-backtest` (#1319; reshaped 2026-11-19/20).
 *
 * ── DECISION (2026-11-20, primary) ──
 * WHAT:       One FORM container holds every input and collapses to a one-line summary when a run
 *             starts; results are separate containers, one per META.Stack stage, and verbose help lives
 *             in `WhyPopover` instead of paragraphs between sections.
 * WHY:        Measured by the reader on 2026-11-20: *"This page is a mess… it doesn't follow design
 *             standards"*, with the specific faults being form controls scattered down the page, a
 *             stage strip that explained rather than showed, a "None" button that hid the one list a
 *             reader wanted, and explanation prose dumped between containers.
 * INSTEAD OF: A stage STRIP above the results. The stages are now the containers themselves, which is
 *             what "clear sections" means; the phase list survives as `src/core/pipeline-phases.js`
 *             because it is the guard and the future cockpit column spec, not a decoration.
 * REVERSE BY: Re-inlining the controls and re-adding the strip; nothing else reads either.
 * REGISTER:  docs/SETTLED-DECISIONS.md rows 234, 235
 * GUARD:     src/core/pipeline-phases.test.js (a phase may not claim a section that renders nowhere)
 *
 * FOR ONE STRATEGY THAT CHOOSES ITS INSTRUMENT EACH DAY. Every other backtest page answers "would this
 * protocol have worked on THIS symbol?". This one answers the second question on top of it: "which
 * symbols was it even allowed to trade today?" — so the output is a per-day ranking plus the P/L of
 * only the symbols it picked.
 *
 * ── WHERE THE NUMBERS COME FROM ────────────────────────────────────────────────────────────────
 * The run resolves the LEG's bot and measures THAT BOT's configuration (`trade-config.ts`). Without it
 * the engine's own literals are used — measured 2026-11-20, that turned a 2.5%/6% bot into a "1%/1%"
 * result, −1,538.47 where the bot's own configuration made +767.64 on the same session.
 *
 * ⚠️ THE CUTOFF IS NOT A SETTING TO CASUALLY RAISE. The ranking reads bars at or before `cutoffUtc`
 * ONLY, and entries before it are dropped. Rank on a day's full move and trade from the open and you
 * score the strategy against the answer key.
 *
 * ⚠️ NO SYMBOL LIST IS SHOWN BEFORE A RUN. Live, nobody knows which names will be featured — the bot
 * reads a feed at the cutoff. Showing today's ten names up front invites the reader to think the
 * strategy chose them; it will show what it PICKED, after the fact, in the results.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import StatCard from '../components/backtest/StatCard.jsx';
// ⚠️ `StatCard` is styled by the shared backtest panel base, imported where it is used rather than
// globally — `CurrentStrategyPage.jsx` does the same. Without it the tiles render as bare text.
import '../components/backtest/backtest-panel-base.css';
import MoversDepthPanel from '../components/backtest/MoversDepthPanel.jsx';
import TradeConfigPanel from '../components/backtest/TradeConfigPanel.jsx';
import LoadingSkeleton from '../components/LoadingSkeleton.jsx';
import LoadingOrbit from '../components/LoadingOrbit.jsx';
// #1328 — the "change vs the previous test" surfaces: the tile deltas, the refusal statement and the
// profile history. The component owns its own scoped stylesheet, like every other backtest panel.
import {
  buildComparisonView,
  SelectionComparisonNotes,
  SelectionDelta,
  SelectionHistory,
} from '../components/backtest/MoversSelectionComparison.jsx';
import NoticeBlock from '../components/NoticeBlock.jsx';
import WhyPopover from '../components/WhyPopover.jsx';
// The canonical form standard (.ff-fieldset, .ff-legend, .ff-seg) — the form uses it instead of a
// second dialect. `.mvp-field-row` is layout-only (content-sized wrapping rows); controls are canonical.
import '../core/forms.css';
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
 * request that finishes when it finishes. "Watch" lets a reader follow the ranking appear day by day.
 */
const PACE_OPTIONS = [
  { id: 'fast', label: 'Fast', gapMs: 0 },
  { id: 'normal', label: 'Normal', gapMs: 400 },
  { id: 'watch', label: 'Watch', gapMs: 1500 },
];

const RUN_TIMEOUT_MS = 600_000;

const fmtPct = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : `${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(1)}%`);
const fmtMoney = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** `2026-11-10` → `Mon 10 Nov`. Formatted in UTC from the string so no local timezone can shift it. */
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

/**
 * `["us"]` → `US`; `us` (an alias the engine still accepts) → `US`. Anything that is not a JSON list
 * is shown as it was stored — an unparsable window is a fact the reader should see, not a crash and
 * never a blank.
 */
function gateWindowLabel(raw) {
  if (raw == null || raw === '') return 'declared';
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed.join(' + ').toUpperCase();
  } catch {
    /* not JSON — the stored text IS the label */
  }
  return String(raw).toUpperCase();
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
  /** The form folds away the moment a run starts, so the results own the screen. */
  const [formOpen, setFormOpen] = useState(true);

  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState(null); // { queue, done, current, startedAt, stopped }
  const [now, setNow] = useState(() => Date.now());
  const stopRef = useRef(false);

  const leg = LEGS.find((l) => l.key === legKey) ?? LEGS[0];
  const pace = PACE_OPTIONS.find((p) => p.id === paceId) ?? PACE_OPTIONS[1];
  const running = Boolean(progress?.current);

  // ⚠️ NO `.catch(() => …)`. Swallowing the error makes a failed request render as "no datasets",
  // which reads as a fact about the data rather than a fact about the connection.
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
  // make `daysForLeg` new every render and re-fire the default-selection effect below.
  const datasets = useMemo(
    () => (Array.isArray(datasetsQuery.data?.datasets) ? datasetsQuery.data.datasets : []),
    [datasetsQuery.data],
  );
  // ⚠️ `datasetsQuery.data.excluded` is intentionally NOT read here. It lists stored datasets whose
  // name carries no day (so they cannot be ranked), but the owner asked for no explanatory text between
  // containers (2026-11-20) — the API still returns it for diagnosis. Do not re-surface it on the page.
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

  /** Datasets whose own name says they hold this leg's side, oldest first. */
  const daysForLeg = useMemo(
    () => datasets.filter((d) => d.side === leg.side).sort((a, b) => a.answerDate.localeCompare(b.answerDate)),
    [datasets, leg.side],
  );
  const datasetByName = useMemo(() => new Map(datasets.map((d) => [d.name, d])), [datasets]);

  // Keep the selection inside the current leg: switching Long → Short must not leave winners days
  // ticked, because the backend refuses that pairing and the page would then look broken.
  //
  // ⚠️ TRACKED BY LEG, NOT BY "is the selection empty". Deriving the default from emptiness means the
  // effect re-fires after the reader clears a day, and a leg whose lists have not loaded yet is
  // indistinguishable from a leg with no lists. Every path hands React the SAME array when nothing
  // changed — a new-but-equal array would re-render forever.
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
    setFormOpen(false); // the form folds away; its values stay visible in the summary line
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
        // ⚠️ The notice keeps the server's own wording as `detail` AND gives it a stable code (#824/#826).
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
    /**
     * ⚠️ THE RUNS ARE RETURNED, not only set into state (2026-11-23). The trade-config panel compares
     * the re-run's profit against the figure the reader was looking at, for the automatic revert — and a
     * value it had to read from state would still be the OLD totals at the moment it asked.
     */
    return collected;
  }

  const okRuns = results.filter((r) => !r.notice);
  const failedRuns = results.filter((r) => r.notice);

  // The cockpit skeleton reads the LAST run from session storage — one tab, no persistence, so a
  // half-built surface cannot become a second source of truth for a run.
  useEffect(() => {
    if (!okRuns.length) return;
    try {
      window.sessionStorage.setItem('tcs:movers-cockpit:last-run', JSON.stringify(okRuns[okRuns.length - 1]));
    } catch {
      /* a full or blocked store is not a reason to break the page */
    }
  }, [okRuns]);

  const totals = useMemo(() => {
    const trades = okRuns.reduce((a, r) => a + Number(r.totals?.trades ?? 0), 0);
    const wins = okRuns.reduce((a, r) => a + Number(r.totals?.wins ?? 0), 0);
    const netPnl = okRuns.reduce((a, r) => a + Number(r.totals?.netPnl ?? 0), 0);
    const selections = okRuns.reduce((a, r) => a + Number(r.totals?.selections ?? 0), 0);
    return { trades, wins, netPnl, selections, winRate: trades ? (wins / trades) * 100 : null };
  }, [okRuns]);

  /**
   * The totals as they stood at the LAST RENDER, readable from a callback without re-binding.
   * The trade-config panel asks for the pre-change profit at the instant it saves; a prop would carry
   * whichever figure happened to be current when the panel last rendered.
   */
  const totalsRef = useRef(null);
  totalsRef.current = totals;

  /**
   * ── #1242 — THE SESSION GATE HAS THREE STATES, AND THEY MUST NOT LOOK ALIKE ────────────────────
   * `sessionGate` is ABSENT when no window is declared (nothing to report). `applied: true` means the
   * window gated entries. `applied: false` means a window WAS declared but this timeframe cannot
   * carry it — a daily bar is stamped at the session's END, so there is no intraday instant to test a
   * clock against, and the run traded UNGATED. Measured 2026-11-20: applying the window there
   * excluded every bar (26 trades → 0), so an empty result would read as "the strategy never fires".
   *
   * ⚠️ THE SENTENCE IS RENDERED ONCE. The server also pushes `because` onto `caveats`, so it is
   * filtered out of that list below; otherwise the same paragraph appears as a statement AND a
   * bullet, which reads as two separate caveats.
   */
  const sessionGateView = useMemo(() => {
    const ranged = okRuns.filter((r) => r.sessionGate);
    if (!ranged.length) return null;
    const ungated = ranged.filter((r) => r.sessionGate.applied === false);
    const applied = ranged.filter((r) => r.sessionGate.applied === true);
    return {
      runCount: okRuns.length,
      ungatedCount: ungated.length,
      appliedCount: applied.length,
      window: ranged[0].sessionGate.window ?? null,
      because: ungated[0]?.sessionGate.because ?? null,
    };
  }, [okRuns]);

  const caveats = useMemo(() => {
    const gateSentences = new Set(
      (sessionGateView ? okRuns.map((r) => r.sessionGate?.because) : []).filter(Boolean),
    );
    return [...new Set(okRuns.flatMap((r) => r.caveats ?? []))].filter((c) => !gateSentences.has(c));
  }, [okRuns, sessionGateView]);

  /**
   * ── #1328 — CHANGE VS THE PREVIOUS TEST ────────────────────────────────────────────────────────
   * The delta on a tile is THIS run minus the previous run of the SAME test. Which pair is "the same
   * test" is the server's decision (`comparison.profileKey`), never the page's: Wednesday-long and
   * Thursday-short are different tests and must not be subtracted.
   *
   * ⚠️ NOTHING IS SHOWN WHEN THE CONTRACT IS ABSENT. A missing `comparison` is not "no change"; it is
   * a server that cannot answer, and a zero there would be a fabricated measurement.
   *
   * ⚠️ THE TILES SUM THE DAYS, SO THE DELTA MUST SUM THE DAYS' PREVIOUS RUNS. If one day has no
   * comparable previous run, no delta is shown at all and the note says how many days blocked it —
   * summing the other four would overstate the change.
   */
  const comparisonView = useMemo(() => buildComparisonView(okRuns, totals), [okRuns, totals]);

  /**
   * ── WHAT THESE DAYS COULD NOT REPRODUCE LIVE (2026-11-23) ──────────────────────────────────────
   * Each day's server response carries `exitDivergence` over the population its tiles describe. A
   * movers run is where the trail matters most — the strategy is tuned toward letting a move run — so
   * the reader needs to know how much of the result would not have happened in the account, where the
   * live guardian only RECORDS the trail decision (#936).
   *
   * ⚠️ REPORT ONLY. Nothing here re-decides an exit or hides a trade: the trail exits are real fills in
   * the simulation and stay in every figure above. `null` when no day diverged — an absent note means
   * "fully reproducible", and a zero-row block would imply a mechanism was checked and found fine.
   */
  const liveGapView = useMemo(() => {
    const rows = okRuns.map((r) => r.exitDivergence).filter(Boolean);
    const trailExits = rows.reduce((a, d) => a + (d.trailExits ?? 0), 0);
    const trades = rows.reduce((a, d) => a + (d.trades ?? 0), 0);
    const trailPnl = rows.reduce((a, d) => a + (d.trailPnl ?? 0), 0);
    const withGap = rows.filter((d) => d.trailExits > 0).length;
    if (!trailExits) return null;
    return { trailExits, trades, trailPnl, withGap, days: rows.length };
  }, [okRuns]);

  /**
   * Config ids → the labels the trade-management table already uses. An id the page cannot label is
   * shown as the id itself, so a change is never rendered blank.
   */
  const configLabelById = useMemo(() => {
    const labels = new Map();
    for (const r of okRuns) {
      for (const field of r.tradeConfig?.fields ?? []) {
        if (field?.id && !labels.has(field.id)) labels.set(field.id, field.label || field.id);
      }
    }
    return labels;
  }, [okRuns]);

  /**
   * #1328 — a run whose group row could not be stored has no history entry, so the NEXT run will
   * report "no previous". That is said here, once, rather than left for the reader to discover as an
   * unexplained first-run state next time.
   */
  const unstoredRuns = okRuns.filter((r) => r.selectionRun?.persisted === false);

  /** The delta names the pair it was measured against — a sign with no subject is not a measurement. */
  const deltaVsLabel = comparisonView?.runCount > 1 ? 'vs each day’s previous test' : 'vs previous test';

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

  const selectedDaysLabel = useMemo(() => {
    const lines = daysForLeg.filter((d) => selected.includes(d.name)).map((d) => dayLabel(d.answerDate));
    if (!lines.length) return 'no day chosen';
    return lines.length <= 3 ? lines.join(' · ') : `${lines.length} days`;
  }, [daysForLeg, selected]);

  return (
    <div className="mvp-page">
      {/* The Cockpit link is page NAVIGATION, not a form input — it lives above the form so it cannot be
          mistaken for a control and cannot run on from the Leg toggle into the Day field (owner report
          2026-11-20: the form head read as one run-on line, "LongShort🧭 CockpitDay?"). */}
      <div className="mvp-page-actions">
        <a className="mvp-cockpit-btn" href="/lab/movers-cockpit">
          🧭 Cockpit
        </a>
      </div>
      {/* ══ THE FORM — one container, every input, folds away when a run starts ═════════════════ */}
      {formOpen && (
      <section className="mvp-form" aria-label="Test settings">
        <div className="mvp-form-head">
            <>
              <div className="ff-field">
                <span className="ff-label">Strategy</span>
                <div className="ff-seg" role="group" aria-label="Strategy leg">
                  {legAvailability.map((l) => (
                    <button
                      key={l.key}
                      type="button"
                      className="ff-seg-btn"
                      aria-pressed={l.key === legKey}
                      disabled={running || l.available === false}
                      title={l.why ?? `${l.protocolId} · ${l.blurb}`}
                      onClick={() => setLegKey(l.key)}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ff-field" id="mvp-sec-selection">
                <span className="ff-label">Trade the top</span>
                <div className="ff-seg" role="group" aria-label="How many symbols per day">
                  {TOP_N_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="ff-seg-btn"
                      aria-pressed={n === topN}
                      disabled={running}
                      onClick={() => setTopN(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ff-field">
                <span className="ff-label">
                  Rank at
                  <WhyPopover title="Why the cutoff matters">
                    The ranking sees only bars up to this moment, and no entry before it counts.
                    Ranking on a day’s full move and then trading from the open would score the
                    strategy against the answer key.
                  </WhyPopover>
                </span>
                <div className="ff-seg" role="group" aria-label="Ranking cutoff">
                  {CUTOFF_OPTIONS.map((c) => (
                    <button
                      key={c.utc}
                      type="button"
                      className="ff-seg-btn"
                      aria-pressed={c.utc === cutoffUtc}
                      disabled={running}
                      title={`${c.label} — ${c.et} ET`}
                      onClick={() => setCutoffUtc(c.utc)}
                    >
                      {c.utc}
                      <span className="mvp-et">{c.et}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="ff-field">
                <span className="ff-label">Pace</span>
                <div className="ff-seg" role="group" aria-label="Pace between day runs">
                  {PACE_OPTIONS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="ff-seg-btn"
                      aria-pressed={p.id === paceId}
                      disabled={running}
                      onClick={() => setPaceId(p.id)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ff-field">
                <span className="ff-label">
                  Detail
                  <WhyPopover title="What bar-by-bar detail adds">
                    The per-bar timeline for each symbol: score, price, move, decision and the breakdown.
                    Off runs faster and stores less.
                  </WhyPopover>
                </span>
                <div className="ff-seg" role="group" aria-label="Bar-by-bar detail">
                  <button
                    type="button"
                    className="ff-seg-btn"
                    aria-pressed={!detailOn}
                    disabled={running}
                    onClick={() => setDetailOn(false)}
                  >
                    Off
                  </button>
                  <button
                    type="button"
                    className="ff-seg-btn"
                    aria-pressed={detailOn}
                    disabled={running}
                    onClick={() => setDetailOn(true)}
                  >
                    On
                  </button>
                </div>
              </div>
              {running && (
                <div className="mvp-form-actions">
                  <button type="button" className="mvp-link-btn" onClick={() => setFormOpen(false)}>
                    Hide settings
                  </button>
                </div>
              )}
            </>
        </div>
        {formOpen && (
          <>
            <div className="ff-field" id="mvp-sec-data">
              {/* No "Day" label (decided 2026-11-20). The table's own Day column header names it, so a
                  label above the table only repeated that. */}
              {datasetsQuery.isError ? (
                <NoticeBlock
                  notice={noticeFromError(datasetsQuery.error, 'TCS-SYS-002', {
                    operation: 'load the movers day lists',
                  })}
                />
              ) : datasetsQuery.isPending ? (
                /**
                 * ── #1330 — THE WAIT IS DRAWN, NOT LEFT BLANK ────────────────────────────────────
                 * Owner, 2026-11-23: the page opened with *"nothing to say [the day table] even
                 * existed"* for 2–3 s, and it read as broken. This field had TWO branches, so an
                 * in-flight query (`daysForLeg` still `[]`) fell through to the "no stored list is a
                 * long day" branch — asserting a fact about the DATA before anything had been read.
                 *
                 * ⚠️ TWO MEASUREMENTS, NOT ONE — kept separate on purpose: the handler answered in
                 * 878–1079 ms over four calls, while the owner saw 2–3 s in the browser (first paint
                 * and a cold dev-server transform are not in the server figure). The defect is real at
                 * either duration, so neither number is used to size this skeleton.
                 *
                 * The skeleton is the SHAPE of the table that is coming (six columns, matching the
                 * row rhythm below), so the panel does not jump when the data lands. `aria-busy`
                 * carries the state for anyone who cannot see a shimmer.
                 */
                <div className="mvp-ds-pending" aria-busy="true">
                  <LoadingSkeleton variant="table" rows={3} cols={6} />
                  <p className="mvp-note">Loading the stored day lists…</p>
                </div>
              ) : daysForLeg.length === 0 ? (
                <p className="mvp-note">
                  No stored list is a <strong>{leg.side}</strong> day — a day without a list cannot be
                  tested, because the list IS that day’s screen.
                </p>
              ) : (
                <>
                  <div className="mvp-scroll">
                    <table className="mvp-table mvp-dataset">
                      <thead>
                        <tr>
                          <th scope="col">Day</th>
                          <th scope="col" className="mvp-num">Symbol 1</th>
                          <th scope="col" className="mvp-num">Symbol 2</th>
                          <th scope="col" className="mvp-num">Symbol 3</th>
                          <th scope="col" className="mvp-num">Symbol 4</th>
                          <th scope="col" className="mvp-num">Symbol 5</th>
                        </tr>
                      </thead>
                      <tbody>
                        {daysForLeg.slice(-5).map((d) => {
                          const on = selected.includes(d.name);
                          const syms = d.symbols ?? [];
                          return (
                            <tr key={d.name} className={on ? 'is-on' : undefined}>
                              <td>
                                <label className="mvp-ds-day" title={d.note || d.name}>
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    disabled={running}
                                    onChange={() => toggleDay(d.name)}
                                  />
                                  <span>{dayLabel(d.answerDate)}</span>
                                </label>
                              </td>
                              {[0, 1, 2, 3, 4].map((i) => {
                                const symbol = syms[i];
                                return (
                                  <td key={i} className="mvp-num mvp-ds-sym">
                                    {symbol ? (
                                      <>
                                        <span className="mvp-ds-ticker">{symbol}</span>
                                        <span className="mvp-ds-pct">{fmtPct(d.symbolMoves?.[symbol])}</span>
                                      </>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {daysForLeg.length > 5 && (
                    <p className="mvp-note">
                      Showing the latest 5 of {daysForLeg.length} stored {leg.side} days.
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="mvp-form-foot">
              <div className="ff-actions">
                {running && (
                  <button
                    type="button"
                    className="ff-btn ff-btn-secondary"
                    onClick={() => { stopRef.current = true; }}
                  >
                    Stop after this day
                  </button>
                )}
                <button type="button" className="ff-btn ff-btn-primary" disabled={!canRun} onClick={runAll}>
                  {running
                    ? `Running ${dayLabel(progress?.current)}…`
                    : `Run ${runQueue.length} day${runQueue.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>

            <div className="mvp-run-notes">
              {!running && runQueue.length === 0 && <span className="mvp-note">Pick a day to run.</span>}
              {currentLegState?.available === false && (
                <span className="mvp-note">The {leg.label} leg cannot run: {currentLegState.why}.</span>
              )}
              {!running && daysForLeg.length > 1 && (
                <span className="mvp-note">
                  Tick several days to compare them — the totals then describe the whole selection.
                </span>
              )}
            </div>
          </>
        )}

        {protocolsQuery.isPending ? (
          /**
           * ── #1330 — "STILL CHECKING" IS NOT "COULD NOT CONFIRM" ──────────────────────────────
           * Before the protocol list arrives, `legAvailability` has nothing to compare, so the
           * `available === null` branch below fired and the page announced that it *could not confirm
           * the protocol exists* — a conclusion drawn from a request that had not finished. Same defect
           * as the blank day table: a wait rendered as a failure. The orbit is the honest effect here —
           * an action in flight, with no layout to draw.
           */
          <p className="mvp-note mvp-leg-checking">
            <LoadingOrbit label={`Checking the ${leg.label} protocol…`} size="sm" />
          </p>
        ) : currentLegState?.available === null && (
          <p className="mvp-note">
            Could not confirm the {leg.label} protocol exists — {currentLegState.why}. Run stays enabled
            so the server can answer, and a missing protocol is reported as an error rather than as zero
            trades.
          </p>
        )}
      </section>
      )}

      {/* The progress panel and the .mvp-progress bar were removed 2026-11-20 (owner): they took a lot
          of space for little information, and there is no speed control yet to make a live progress
          indicator worth watching. Run status and the settings recap now live in the Run summary
          panel below. */}
      {/* ══ RESULTS ═════════════════════════════════════════════════════════════════════════════ */}
      {(results.length > 0 || progress) && (
        <div id="mvp-sec-outcome" className="mvp-outcome">
          <section className="mvp-panel mvp-run-summary" aria-label="Run summary">
            <div className="mvp-run-summary-head">
              <div className="mvp-recap">
                <span className="mvp-recap-leg">{leg.label}</span>
                <span className="mvp-recap-item">{selectedDaysLabel}</span>
                <span className="mvp-recap-item">top {topN}</span>
                <span className="mvp-recap-item">{cutoffUtc} UTC</span>
                <span
                  className={`mvp-recap-status${running ? ' is-live' : progress?.stopped ? ' is-stopped' : ' is-done'}`}
                >
                  {running
                    ? `Running ${dayLabel(progress?.current)}…`
                    : progress?.stopped
                      ? 'Stopped'
                      : 'Finished'}
                  {progress ? ` · ${elapsedLabel(now - progress.startedAt)}` : ''}
                </span>
              </div>
              <button type="button" className="mvp-link-btn" onClick={() => setFormOpen(true)}>
                Change settings
              </button>
            </div>

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
                sub={
                  comparisonView?.delta?.winRate != null ? (
                    <SelectionDelta
                      value={comparisonView.delta.winRate}
                      unit="pp"
                      vsLabel={deltaVsLabel}
                    />
                  ) : undefined
                }
              />
              <StatCard
                value={fmtMoney(totals.netPnl)}
                label="Net P/L"
                note="Sum of the kept trades' P/L, after the engine's own costs."
                sub={
                  comparisonView?.delta?.netPnl != null ? (
                    <SelectionDelta
                      value={comparisonView.delta.netPnl}
                      money
                      vsLabel={deltaVsLabel}
                    />
                  ) : undefined
                }
              />
            </div>

            {/*
              #1242 — the session gate, in the two states that have something to say. Absent stays
              absent: "no window declared" is the normal state of most bots and must not be dressed
              up as a confirmation. `applied` is a quiet statement; `not applied` is a caution whose
              sentence is clamped here and shown whole in the popover (keyboard reachable, unlike a
              `title` attribute).
            */}
            {sessionGateView && (
              sessionGateView.ungatedCount > 0 ? (
                <div className="mvp-gate mvp-gate--ungated" role="status">
                  <span className="mvp-gate-tag">
                    {sessionGateView.ungatedCount === sessionGateView.runCount
                      ? 'Window not applied'
                      : `Window not applied \u00b7 ${sessionGateView.ungatedCount} of ${sessionGateView.runCount} days`}
                  </span>
                  <span className="mvp-gate-text">
                    {sessionGateView.because
                      || 'The window was declared but the run traded ungated, and the server did not say why.'}
                  </span>
                  {sessionGateView.because && (
                    <WhyPopover title="Why the session window was not applied">
                      {sessionGateView.because}
                    </WhyPopover>
                  )}
                </div>
              ) : sessionGateView.appliedCount > 0 ? (
                <p className="mvp-gate mvp-gate--applied">
                  <span className="mvp-gate-tag">Window applied</span>
                  <span className="mvp-gate-text">
                    Session window {gateWindowLabel(sessionGateView.window)} gated entries{' '}
                    {sessionGateView.appliedCount === sessionGateView.runCount
                      ? 'on every day of this run.'
                      : `on ${sessionGateView.appliedCount} of ${sessionGateView.runCount} days.`}
                  </span>
                </p>
              ) : null
            )}

            {comparisonView && (
              <SelectionComparisonNotes view={comparisonView} labelById={configLabelById} />
            )}

            {/* #1328 — said ONCE, whatever the number of runs: an unstored run is invisible to the
                next comparison, and that is the difference between "the feature is broken" and "the
                write failed". */}
            {unstoredRuns.length > 0 && (
              <p className="mvp-note mvp-note--warn">
                {unstoredRuns.length === 1
                  ? 'This run was not stored, so the previous-tests list will not include it and the next run has nothing to compare against.'
                  : `${unstoredRuns.length} of ${okRuns.length} runs were not stored, so the previous-tests list will not include them and the next run has nothing to compare against for those days.`}
                {unstoredRuns[0].selectionRun?.reason
                  ? ` The store said: ${unstoredRuns[0].selectionRun.reason}`
                  : ''}
              </p>
            )}

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

            {liveGapView && (
              <p className="mvp-note mvp-note--warn">
                <strong>
                  {liveGapView.trailExits} of {liveGapView.trades} trade(s) exited on a tightened stop
                </strong>{' '}
                ({liveGapView.withGap === 1 ? '1 day' : `${liveGapView.withGap} of ${liveGapView.days} days`},
                realised{' '}
                {liveGapView.trailPnl.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                ). The live guardian only <em>records</em> the trail decision and moves nothing (#936), so
                those exits would not have happened in the account: a result leaning on the trail is an
                upper bound, not a forecast.
              </p>
            )}

            {caveats.length > 0 && (
              <ul className="mvp-caveats">
                {caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}

            </>
            )}
          </section>

          {results.length > 0 && (
          <>
          {/* #1328 — the stored runs of the SAME test, readable on demand rather than filling the
              results pane. Its own component so the loading/failed/empty/loaded states cannot be
              collapsed into one another here. */}
          {comparisonView?.profileKey && (
            <SelectionHistory
              profileKey={comparisonView.profileKey}
              profileLabel={comparisonView.profileLabel}
              semanticsVersion={comparisonView.semanticsVersion}
              currentRunIds={okRuns.map((r) => r.selectionRun?.id).filter(Boolean)}
            />
          )}
          <section className="mvp-panel" aria-label="Result by day">
            <h2 className="mvp-panel-title">
              Result by day
              <WhyPopover title="How to read this table">
                Each row is one session. “Ranked at cutoff” is every candidate with its move at that
                moment; the highlighted ones are what the ranking picked. “Excluded” counts trades the
                engine produced that the selection did not permit.
              </WhyPopover>
            </h2>
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

          <section className="mvp-panel" aria-label="Result by symbol">
            <h2 className="mvp-panel-title">Result by symbol</h2>
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

          {/* Stored datasets that are NOT offered (their name carries no day) are deliberately not shown
              on the page. Measured 2026-11-20: the count + naming rule read as noise between containers.
              The API still reports them in `datasetsQuery.data.excluded` for anyone diagnosing a missing
              day — do not re-add a paragraph or note here. */}

          {/* ── bar by bar ── */}
          <section className="mvp-panel" aria-label="Bar by bar">
            <div className="mvp-panel-head">
              <h2 className="mvp-panel-title">Bar by bar</h2>
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
                No per-bar detail was returned. Turn on <strong>Bar-by-bar detail</strong> above and run
                again — a run without it keeps one composite per bar and no decomposition.
              </p>
            )}
          </section>

          {/* ── which configuration these numbers describe ── */}
          {/* A change here PATCHes the bot and runs the same queue again (register row 247), so the
              page's own runner is handed in rather than the panel starting a run of its own. */}
          <TradeConfigPanel
            tradeConfig={okRuns[0]?.tradeConfig}
            onRetest={runQueue.length ? runAll : undefined}
            retestBusy={running}
            /**
             * Read AT THE MOMENT of the save, through a getter: `totals` is recomputed as soon as the
             * re-run lands, so a prop captured at render would already be the new figure and the
             * automatic revert would compare the change against itself.
             */
            getBaselineNetPnl={() => totalsRef.current?.netPnl ?? null}
          />
          </>
          )}
        </div>
      )}
    </div>
  );
}
