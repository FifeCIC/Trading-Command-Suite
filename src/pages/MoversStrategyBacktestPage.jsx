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
import MoversDepthPanel, { ExecutionsTable } from '../components/backtest/MoversDepthPanel.jsx';
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
// #1341 — the best ever recorded for this test, and the settings that produced it.
import BestRecordPanel from '../components/backtest/BestRecordPanel.jsx';
// #1340 — what the run already records and this page does not show, with the live values.
import UnusedDataPanel from '../components/backtest/UnusedDataPanel.jsx';
// #1342 — the accordion a step is rendered in, from the shared library, plus this strategy's step list.
import StepAccordion, { StepMeta } from '../components/StepAccordion.jsx';
import { MOVERS_PAGE_ID, MOVERS_STEP } from '../features/movers-strategy/steps.js';
import { groupCaveats, caveatDetail } from '../features/movers-strategy/caveats.js';
import { summariseFillGaps, fillGapChips } from '../features/movers-strategy/fill-gap.js';
// 2026-11-27 — WHY THE RUN COUNTED FEWER TRADES THAN THE ENGINE PRODUCED. The two drop codes mean
// opposite things and neither was named on the page.
import { summariseExclusions } from '../features/movers-strategy/selection-exclusions.js';
import { buildPriceReference } from '../features/movers-strategy/price-reference.js';
import QualifierStrip from '../components/QualifierStrip.jsx';
import ResultByDayStep from '../features/movers-strategy/ResultByDayStep.jsx';
import ResultBySymbolStep from '../features/movers-strategy/ResultBySymbolStep.jsx';
import ScoringFunnelStep from '../features/movers-strategy/ScoringFunnelStep.jsx';
import DirectiveRecordStep from '../features/movers-strategy/DirectiveRecordStep.jsx';
// #1335 — what this run cannot reproduce of the live account, read from the build-gated register.
import ParityStep from '../features/movers-strategy/ParityStep.jsx';
import { dayLabel } from '../features/movers-strategy/format.js';
import { formatPct, formatAmount } from '../core/format-utils.js';
// The margin annotation between two steps: what the step above does not yet show, from data we already have.
import StepAuditNote from '../components/StepAuditNote.jsx';
import NoticeBlock from '../components/NoticeBlock.jsx';
import WhyPopover from '../components/WhyPopover.jsx';
// The canonical form standard (.ff-fieldset, .ff-legend, .ff-seg) — the form uses it instead of a
// second dialect. `.mvp-field-row` is layout-only (content-sized wrapping rows); controls are canonical.
import '../core/forms.css';
import { noticeFromError } from '../core/notices/from-error.js';
import { useSort } from '../core/use-sort';
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

// #1342 — the display formatters live with the strategy now, so the page and its extracted steps use
// ONE copy. See `format.js` for why they are not `src/core/format-utils.js`.

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
  // #1342 — a monotonic counter that OPENS the settings step from the summary's 'Change settings'
  // button. A boolean could not: it is already true, so pressing the button would do nothing.
  const [settingsSignal, setSettingsSignal] = useState(0);

  const [results, setResults] = useState([]);
  /**
   * ── PRE-RUN COVERAGE (audit note 'a', owner 2026-11-25) ─────────────────────────────────────────
   * `dryRun` asks the RUN's own admission checks — publisher, the 100-bar floor, the cutoff basis —
   * without spending the engine on a day. Keyed by the settings that decide the answer, so a check
   * made under different settings is visibly stale instead of quietly reused.
   *
   * ⚠️ NO SELECTED NAMES. The payload carries a COUNT; the page deliberately never shows which names
   * the ranking picked before a run (nobody knows them live — the bot reads a feed at the cutoff).
   */
  const [coverage, setCoverage] = useState(null); // { key, byName, checkedAt }
  const [checking, setChecking] = useState(false);
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

  /** The settings a coverage check was made under. A mismatch is STALE, never "close enough". */
  const coverageKey = `${leg.key}|${topN}|${cutoffUtc}`;
  const coverageForSettings = coverage && coverage.key === coverageKey ? coverage : null;

  async function checkCoverage() {
    if (!runQueue.length || checking) return;
    setChecking(true);
    const key = coverageKey;
    const byName = {};
    for (const name of runQueue) {
      const answerDate = datasetByName.get(name)?.answerDate ?? null;
      try {
        byName[name] = await apiPost('/api/backtest/selection-run', {
          datasetName: name,
          protocolId: leg.protocolId,
          topN,
          cutoffUtc,
          dryRun: true,
        });
      } catch (err) {
        /**
         * ⚠️ A SERVER REFUSAL AND AN UNANSWERED REQUEST ARE DIFFERENT FACTS (#1352, 2026-11-26).
         * `apiPost` sets `err.status` only when a response arrived. Without this distinction a dropped
         * connection rendered as "refused" in the coverage column — the server being absent reported as
         * the server having judged the day, which is the silent-failure shape this page exists to avoid.
         * Measured while verifying: a concurrent rebuild killed the API and all five days read
         * "refused", none of which had been checked at all.
         */
        byName[name] = {
          preview: true,
          datasetName: name,
          answerDate,
          outcome: err && typeof err.status === 'number' ? 'refused' : 'unanswered',
          notice: noticeFromError(err, 'TCS-SYS-007', {
            operation: `preview the ${dayLabel(answerDate)} selection`,
          }),
        };
      }
    }
    setCoverage({ key, byName, checkedAt: Date.now() });
    setChecking(false);
  }

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

  /**
   * ── THE CAVEATS AS TABLE ROWS, GROUPED BY CODE (2026-11-26) ─────────────────────────────────────
   *
   * ⚠️ GROUPED BY `code`, because the sentences are per-day and differ only in their figures — five
   * days of "measured on <date>" is one qualification, not five. `days` counts the runs carrying it and
   * `texts` keeps the distinct wording, so a differing sentence is shown as an EXAMPLE (`e.g.`) rather
   * than presented as the only one.
   *
   * ⚠️ A SESSION-GATE SENTENCE IS FILTERED OUT of either list. The page renders that sentence once, in
   * its own block; the server also pushes it onto `caveats`, and without this filter one fact appears
   * as a statement and again as a table row.
   */
  const caveatTable = useMemo(() => {
    const gateSentences = (sessionGateView ? okRuns.map((r) => r.sessionGate?.because) : []).filter(Boolean);
    return groupCaveats(okRuns, gateSentences);
  }, [okRuns, sessionGateView]);

  /** The header figure must equal the rows the reader can now open — not a separate derivation. */
  const caveatCount = caveatTable.length;

  /**
   * ── THE STOP-FILL ASSUMPTION (owner's audit note 'd', 2026-11-26) ─────────────────────────────
   * The engine books every stop exit AT THE LEVEL; a broker fills at the market. `fillGap` measures how
   * often the exit bar had already traded past that level, and by how much — it was returned on every
   * run and rendered on none of them.
   *
   * ⚠️ The aggregation rules live in `fill-gap.js` and are tested there: counts sum, percentiles are a
   * RANGE across days, and a day with `measured: 0` is "not recorded" rather than "no gap".
   */
  const fillGapView = useMemo(() => summariseFillGaps(okRuns), [okRuns]);

  /**
   * The bot's own stop distance, for judging how MATERIAL a stop overshoot is. Taken from the last run
   * that declares one; `null` when none does, and the chip then reports `info` with the reason rather
   * than inventing a severity.
   */
  const stopDistancePct = useMemo(() => {
    for (let i = okRuns.length - 1; i >= 0; i -= 1) {
      const field = (okRuns[i]?.tradeConfig?.fields ?? []).find((f) => f.id === 'slPct');
      const n = Number(field?.value);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }, [okRuns]);

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
        /**
         * ⚠️ DERIVED FROM `perSymbol`, NOT READ FROM `totals` (2026-11-27). The day table used to show
         * `totals.engineTradesOutsideSelection` — a bare number with nothing saying what it was. The
         * split now comes from one place and the total is its sum, so the cell and its explanation
         * cannot describe different runs. Measured on `movers-winners-2026-11-11`: the 34 was 25 + 9,
         * and the two halves mean opposite things.
         */
        const exclusions = summariseExclusions(r.perSymbol);
        return {
          id: r.datasetName,
          answerDate: r.answerDate ?? datasetByName.get(r.datasetName)?.answerDate ?? '',
          ranked: day?.ranked ?? [],
          selected: day?.selected ?? [],
          candidates: r.candidates?.length ?? 0,
          trades: r.totals?.trades ?? null,
          winRate: r.totals?.winRate ?? null,
          netPnl: r.totals?.netPnl ?? null,
          exclusions,
          excluded: exclusions ? exclusions.total : null,
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
        /**
         * ⚠️ `errors` IS CARRIED, NOT DROPPED (2026-11-26). A symbol whose engine call threw arrives
         * with `error` set and every figure at 0; discarding that made it identical to a symbol that was
         * picked and simply made nothing — and the new P/L bar would have drawn it as break-even.
         */
        const cur = bySymbol.get(s.symbol) ?? { symbol: s.symbol, days: 0, trades: 0, wins: 0, netPnl: 0, errors: 0 };
        cur.days += 1;
        cur.trades += Number(s.trades ?? 0);
        cur.wins += Number(s.wins ?? 0);
        cur.netPnl += Number(s.netPnl ?? 0);
        if (s.error) cur.errors += 1;
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

  /**
   * Note o — the price a `slPct` / `tpPct` percentage is a percentage OF. Read from this run's own
   * trades (`depthEntries` covers every day, not just the focused one) and reduced by
   * `buildPriceReference()` to the most-traded symbol's median entry. Never a blend across symbols:
   * 5% of EURUSD and 5% of BTC do not average into anything.
   *
   * ⚠️ Declared AFTER `depthEntries` — it reads it, and a `const` read before its own declaration is a
   * TDZ ReferenceError that takes the whole page to a blank fallback with no error in the UI.
   */
  const priceRef = useMemo(
    () => buildPriceReference(
      depthEntries.flatMap((e) => (e.detail?.trades ?? []).map((t) => ({ ...t, symbol: t.symbol || e.symbol }))),
    ),
    [depthEntries],
  );
  /**
   * The scoring funnel's headline, computed ONCE from the same per-bar states the funnel table counts.
   * ⚠️ Step 6's header must not re-derive these: two implementations of one count is how a tile and a
   * table end up disagreeing, which is the shape this repo keeps paying for.
   */
  const funnelSummary = useMemo(() => {
    let scored = 0;
    let entered = 0;
    for (const e of depthEntries) {
      const bars = e.detail?.bars ?? [];
      scored += bars.length;
      entered += bars.filter((b) => b.state === 'entry' || b.state === 'entry+exit').length;
    }
    return { scored, entered };
  }, [depthEntries]);

  /** #1345 — the engine's own verdict on whether the run could close a trade at all. */
  const runViability = okRuns[okRuns.length - 1]?.viability ?? null;

  /** The directive ids this protocol actually scored, from the run's own bars (never from a name list). */
  const protocolDirectives = useMemo(() => {
    const ids = new Set();
    for (const e of depthEntries) {
      for (const b of e.detail?.bars ?? []) {
        for (const d of b.directives ?? []) if (d?.directiveId) ids.add(d.directiveId);
      }
    }
    return [...ids];
  }, [depthEntries]);

  /**
   * ── THE DAY AS A WHOLE (owner, 2026-11-23) ──────────────────────────────────────────────────────
   * The executions table showed one symbol at a time and did not name it, so a reader concluded the day
   * had produced trades in a single instrument. The merged view concatenates every selected symbol's
   * trades and keeps the symbol on each row, so the day can be read without clicking through the chips.
   * ⚠️ Bars and the ladder stay per symbol — a merged price axis across instruments would be meaningless.
   */
  const isAllSymbols = typeof focusKey === 'string' && focusKey.startsWith('all:');
  const allSymbolsDay = isAllSymbols ? focusKey.slice(4) : null;
  const dayEntries = useMemo(
    () => depthEntries.filter((e) => e.day === allSymbolsDay),
    [depthEntries, allSymbolsDay],
  );
  const mergedTrades = useMemo(
    () => dayEntries.flatMap((e) => (e.detail?.trades ?? []).map((t) => ({ ...t, symbol: t.symbol || e.symbol }))),
    [dayEntries],
  );
  const daySymbols = useMemo(() => [...new Set(dayEntries.map((e) => e.symbol))], [dayEntries]);

  const selectedDaysLabel = useMemo(() => {
    const lines = daysForLeg.filter((d) => selected.includes(d.name)).map((d) => dayLabel(d.answerDate));
    if (!lines.length) return 'no day chosen';
    return lines.length <= 3 ? lines.join(' · ') : `${lines.length} days`;
  }, [daysForLeg, selected]);

  return (
    <div className="mvp-page">
      {/* ══ STEP 1 — THE FORM ═════════════════════════════════════════════════════════════════ */}
      {formOpen && (
      <StepAccordion
        pageId={MOVERS_PAGE_ID}
        {...MOVERS_STEP['mvp-step-settings']}
        openSignal={settingsSignal}
        meta={(
          <>
            <StepMeta value={leg.label} label="leg" />
            <StepMeta value={`top ${topN}`} label="per day" />
            <StepMeta value={cutoffUtc} label="UTC screen" />
            {coverageForSettings && (
              <StepMeta
                value={`${runQueue.filter((n) => coverageForSettings.byName[n]?.status === 'ready').length}/${runQueue.length}`}
                label="ready"
              />
            )}
          </>
        )}
      >
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
                 * Owner, 2026-11-23: the page opened by saying there was nothing to report for the day table even
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
                                        <span className="mvp-ds-pct">{formatPct(d.symbolMoves?.[symbol])}</span>
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

            {/* ── PRE-RUN COVERAGE — the run's own admission tests, asked before a run is spent ────
                From `dryRun`, so `refused` here is the SAME refusal the Run button would hit. The two
                counts are deliberately different bases: `Usable` is candidates the ranking can see
                AND the engine can run; `Rank basis` is the thinnest bar count the ranking rests on. */}
            {coverage && coverage.key !== coverageKey && (
              <p className="mvp-note mvp-note--warn">
                Settings changed since the coverage check — check again for this configuration.
              </p>
            )}
            {coverageForSettings && (
              <div className="ff-field" id="mvp-sec-coverage">
                <div className="mvp-scroll">
                  <table className="mvp-table">
                    <thead>
                      <tr>
                        <th scope="col">Day</th>
                        <th scope="col" className="mvp-num">Candidates</th>
                        <th scope="col" className="mvp-num">Usable</th>
                        <th scope="col" className="mvp-num">Picked</th>
                        <th scope="col" className="mvp-num">Rank basis</th>
                        <th scope="col" className="mvp-num">Bar-scores</th>
                        <th scope="col">Coverage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runQueue.map((name) => {
                        const p = coverageForSettings.byName[name];
                        if (!p) return null;
                        if (p.notice) {
                          return (
                            <tr key={name} className="mvp-row--bad">
                              <td>{dayLabel(p.answerDate)}</td>
                              <td className="mvp-num">—</td>
                              <td className="mvp-num">—</td>
                              <td className="mvp-num">—</td>
                              <td className="mvp-num">—</td>
                              <td className="mvp-num">—</td>
                              <td className="mvp-warn">
                                {p.outcome === 'unanswered' ? 'not checked' : 'refused'}
                              </td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={name} className={p.status === 'ready' ? undefined : 'mvp-row--bad'}>
                            <td>{dayLabel(p.answerDate)}</td>
                            <td className="mvp-num">{p.candidates}</td>
                            <td className="mvp-num">{p.usable}</td>
                            <td className="mvp-num">{p.selected} of {p.topN}</td>
                            <td className="mvp-num">
                              {p.rankBasisBars == null
                                ? '—'
                                : `${p.rankBasisBars} bar${p.rankBasisBars === 1 ? '' : 's'}`}
                            </td>
                            <td className="mvp-num">{p.cost?.scoreEvaluations?.toLocaleString() ?? '—'}</td>
                            <td>
                              {p.status === 'ready' ? 'ready' : p.status === 'blocked' ? 'blocked' : 'thin'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {runQueue.map((name) => {
                  const p = coverageForSettings.byName[name];
                  if (!p) return null;
                  if (p.notice) {
                    return <NoticeBlock key={`${name}-notice`} notice={p.notice} />;
                  }
                  if (!p.notes?.length) return null;
                  return (
                    <ul key={`${name}-notes`} className="mvp-coverage-notes">
                      {p.notes.map((line) => (
                        <li key={line} className="mvp-note">
                          <strong>{dayLabel(p.answerDate)}</strong> — {line}
                        </li>
                      ))}
                    </ul>
                  );
                })}
                {/* ── THE QUEUE TOTAL — the number the audit note asked for: days × picks ────────
                    Work is a COUNT (exact, summed from each day's picks). The time is a BAND over a
                    measured rate and says so, because six timed runs spanned 12–30 ms per bar scored
                    and a single figure would claim precision this does not have. */}
                {(() => {
                  const answered = runQueue.map((n) => coverageForSettings.byName[n]).filter((p) => p && !p.notice);
                  // A BLOCKED day is answered but cannot produce a result, so counting it as work would
                  // understate the queue: it is called out separately rather than summed as zero.
                  const producible = answered.filter((p) => p.status !== 'blocked');
                  const blockedDays = answered.length - producible.length;
                  const refusedDays = runQueue.filter((n) => coverageForSettings.byName[n]?.outcome === 'refused').length;
                  const unansweredDays = runQueue.filter((n) => coverageForSettings.byName[n]?.outcome === 'unanswered').length;
                  const scores = producible.reduce((a, p) => a + Number(p.cost?.scoreEvaluations ?? 0), 0);
                  const low = producible.reduce((a, p) => a + Number(p.cost?.estimatedSeconds?.low ?? 0), 0);
                  const high = producible.reduce((a, p) => a + Number(p.cost?.estimatedSeconds?.high ?? 0), 0);
                  const basis = producible.find((p) => p.cost?.basis)?.cost?.basis ?? null;
                  const skipped = [
                    blockedDays ? `${blockedDays} blocked` : null,
                    refusedDays ? `${refusedDays} refused` : null,
                    unansweredDays ? `${unansweredDays} not checked` : null,
                  ].filter(Boolean);
                  if (!producible.length) {
                    return (
                      <p className="mvp-cost-total mvp-note--warn">
                        No day can produce a result{skipped.length ? ` (${skipped.join(', ')})` : ''} — there
                        is no cost to report, which is not the same as a cheap run.
                      </p>
                    );
                  }
                  return (
                    <p className="mvp-cost-total">
                      <strong>{producible.length} day{producible.length === 1 ? '' : 's'}</strong>
                      {' · '}
                      <strong>{scores.toLocaleString()}</strong> bar-scores
                      {skipped.length > 0 && <> ({skipped.join(', ')}, not counted)</>}
                      {' · '}
                      <span className="mvp-muted">≈ {low.toFixed(1)}–{high.toFixed(1)} s</span>
                      {basis && <span className="mvp-muted"> — {basis}</span>}
                    </p>
                  );
                })()}
              </div>
            )}

            <div className="mvp-form-foot">
              <div className="ff-actions">
                <button
                  type="button"
                  className="ff-btn ff-btn-secondary"
                  disabled={!runQueue.length || running || checking}
                  onClick={checkCoverage}
                >
                  {checking
                    ? 'Checking coverage…'
                    : `Check ${runQueue.length} day${runQueue.length === 1 ? '' : 's'}`}
                </button>
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

      {/*
        ── PREVIOUS TESTS MOVE INTO STEP 1 (owner, 2026-11-23) ──────────────────────────────────────
        The stored runs of the SAME test belong beside the settings that define it: a reader about to
        run a fresh test wants to see what this configuration has already produced, and it was two
        accordions away from the form. Step 1 stays open by default so a fresh run is always one click.
      */}
      {okRuns.length > 0 && comparisonView?.profileKey && (
        // `mvp-sec-persistence` — the anchor the `db` phase in `src/core/pipeline-phases.js` names.
        // ⚠️ The claim was TRUE but unanchored, so `pipeline-phases.test.js` reported the phase as
        // rendering nowhere (red on HEAD, unrelated to the cost work beside it). The stored-run list IS
        // the persistence surface, so it carries the id; it renders only once a run exists, and with no
        // run there is nothing to reopen.
        <div id="mvp-sec-persistence">
          <SelectionHistory
            profileKey={comparisonView.profileKey}
            profileLabel={comparisonView.profileLabel}
            semanticsVersion={comparisonView.semanticsVersion}
            currentRunIds={okRuns.map((r) => r.selectionRun?.id).filter(Boolean)}
          />
        </div>
      )}
      </StepAccordion>
      )}

      <StepAuditNote afterStep={MOVERS_STEP['mvp-step-settings'].step} ideas={MOVERS_STEP['mvp-step-settings'].audit} />

      {/* The progress panel and the .mvp-progress bar were removed 2026-11-20 (owner): they took a lot
          of space for little information, and there is no speed control yet to make a live progress
          indicator worth watching. Run status and the settings recap now live in the Run summary
          panel below. */}
      {/* ══ RESULTS ═════════════════════════════════════════════════════════════════════════════ */}
      {(results.length > 0 || progress) && (
        <div id="mvp-sec-outcome" className="mvp-outcome">
          <StepAccordion
            pageId={MOVERS_PAGE_ID}
            {...MOVERS_STEP['mvp-step-summary']}
            meta={(
              <>
                <StepMeta
                  value={totals.netPnl == null ? '—' : formatAmount(totals.netPnl)}
                  label="net P/L"
                  tone={totals.netPnl > 0 ? 'pos' : totals.netPnl < 0 ? 'neg' : ''}
                />
                <StepMeta value={totals.trades ?? 0} label="trades" />
                <StepMeta value={totals.winRate == null ? '—' : `${totals.winRate.toFixed(1)}%`} label="win rate" />
                {caveatCount > 0 && <StepMeta value={caveatCount} label="caveats" />}
              </>
            )}
          >
          {/* ⚠️ NO INNER `.mvp-panel` (owner, 2026-11-23): the accordion body carries the tint, so a
              panel here would be a coloured box inside a coloured box. The recap line and the totals
              grid are content, not chrome, so they stay. */}
          <div className="mvp-run-summary">
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
              <button
                type="button"
                className="mvp-link-btn"
                onClick={() => {
                  setFormOpen(true);
                  // The settings step may be folded; a button that reveals nothing reads as broken.
                  setSettingsSignal((n) => n + 1);
                }}
              >
                Change settings
              </button>
            </div>

            {results.length > 0 && (
            <>
            {/**
              * ── #1345 — THIS SITS ABOVE THE TOTALS ON PURPOSE ─────────────────────────────────────
              * A warning eight accordions down cannot protect a headline number. When every trade in the
              * run was still open when the data ended, the four tiles below are marks of open positions —
              * and the only honest place to say so is between the reader and the number.
              *
              * ⚠️ `mark-only` IS THE ENGINE'S OWN VERDICT, computed from the run's own exit reasons and
              * the dataset's MEASURED span. It is not a page heuristic: `backtest-viability.ts` decides it
              * and `backtest-viability.spec.ts` canaries both directions, including that an unmeasurable
              * span is "cannot judge" rather than a claim.
              */}
            {runViability?.verdict === 'mark-only' && (
              <p className="mvp-note mvp-note--warn mvp-viability">
                <strong>These totals are not a result.</strong> {runViability.why}
              </p>
            )}
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
                value={formatAmount(totals.netPnl)}
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

            {/* ⚠️ THE BEST-RECORD PANEL IS NOT RENDERED HERE (removed 2026-11-26). It was mounted in
                BOTH step 2 and step 3, so the same table appeared twice on one page. Step 3 is titled
                "Best recorded result" and its `meta` reads from `best`, so that is its home; this copy
                was the stray. Caught while adding the attempt trend, which would have doubled as well. */}

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

            {/**
              * ── THE STOP-FILL FACTS, AS CHIPS (owner, 2026-11-26) ─────────────────────────────────
              * This block used to be four paragraphs of prose — "17 of 17 stop exit(s) … median
              * 0.61–9.65%, p90 … The engine fills every stop at the level … 3 of 5 day(s) recorded no
              * stop exit". The owner: *"If I'm doing many tests I can't afford the time of reading
              * those … the numbers don't stand out."*
              *
              * It is now ONE row: a state, a subject and ONE figure per chip, with the sentence and the
              * explanation on hover/click/keyboard. The severity is DERIVED — worst overshoot against
              * the bot's own stop distance (`fillGapChips`) — because a chip is believed faster than a
              * paragraph, and a colour chosen by feel would be worse than the prose it replaced.
              *
              * ⚠️ `muted` means NOT MEASURED and never borrows `ok`. Nothing here is charged to the P&L.
              */}
            {fillGapView.runs > 0 && (
              <QualifierStrip items={fillGapChips(fillGapView, { stopPct: stopDistancePct })} />
            )}

            {/**
              * ── THE CAVEATS, AS A TABLE (owner, 2026-11-26) ────────────────────────────────────────
              * The prose list was removed on 2026-11-23 because eleven sentences between the figures and
              * the tables read as a wall, and the one caveat that changed an interpretation was invisible
              * inside the other ten. But removing it left step 2's header printing a COUNT — "4 caveats" —
              * with the sentences nowhere on the page: a number the reader could never resolve.
              *
              * The table fixes both halves. `Qualifies` is the column that matters: it names the figure
              * the caveat changes, so a reader who doubts a tile can find its qualifier without reading
              * ten sentences.
              *
              * ⚠️ GROUPED BY `code`, NOT BY SENTENCE. Five days produce five variants of "measured on one
              * session", so a row per sentence would rebuild the wall. `Days` says how many runs carry it,
              * and a differing detail is prefixed `e.g.` — an example, never presented as the whole.
              */}
            {caveatTable.length > 0 && (
              <div className="mvp-caveats">
                <div className="mvp-scroll">
                  <table className="mvp-table">
                    <thead>
                      <tr>
                        <th scope="col">Caveat</th>
                        <th scope="col">Qualifies</th>
                        <th scope="col" className="mvp-num">Days</th>
                        <th scope="col">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {caveatTable.map((c) => (
                        <tr key={c.code}>
                          <td className="mvp-nowrap">{c.label}</td>
                          <td className="mvp-nowrap">{c.qualifies}</td>
                          <td className="mvp-num">{c.days} of {okRuns.length}</td>
                          <td className="mvp-caveat-text">{caveatDetail(c)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* ⚠️ The explanation of `e.g.` belongs HERE, once, not repeated inside every row.
                    It used to be a parenthetical appended to each detail — the same twelve words four
                    times, which cost a wrapped line per row to say nothing row-specific. The owner's
                    complaint about this page was text volume, and this is text that scales with the
                    table rather than with the information. */}
                {caveatTable.some((c) => c.texts.length > 1) && (
                  <p className="mvp-note">
                    <code>e.g.</code> marks a row whose days each state their own figures — the example
                    stands for <em>Days</em> runs, it is not a five-day total.
                  </p>
                )}
              </div>
            )}

            </>
            )}
          </div>
          </StepAccordion>

          <StepAuditNote afterStep={MOVERS_STEP['mvp-step-summary'].step} ideas={MOVERS_STEP['mvp-step-summary'].audit} />

          {results.length > 0 && (
          <>
          <StepAccordion
            pageId={MOVERS_PAGE_ID}
            {...MOVERS_STEP['mvp-step-best']}
            meta={(
              <>
                <StepMeta
                  value={okRuns[okRuns.length - 1]?.best?.best?.perDay == null
                    ? '—'
                    : formatAmount(okRuns[okRuns.length - 1].best.best.perDay)}
                  label="best per day"
                />
                <StepMeta
                  value={okRuns[okRuns.length - 1]?.best?.improved ? 'new' : 'not beaten'}
                  label="this run"
                  tone={okRuns[okRuns.length - 1]?.best?.improved ? 'pos' : ''}
                />
              </>
            )}
          >
            <BestRecordPanel
              okRuns={okRuns}
              profileKey={comparisonView?.profileKey ?? null}
              profileLabel={comparisonView?.profileLabel ?? null}
              semanticsVersion={comparisonView?.semanticsVersion ?? null}
              runCount={okRuns.length}
            />
          </StepAccordion>

          <StepAuditNote afterStep={MOVERS_STEP['mvp-step-best'].step} ideas={MOVERS_STEP['mvp-step-best'].audit} />

          <StepAccordion
            pageId={MOVERS_PAGE_ID}
            {...MOVERS_STEP['mvp-step-day']}
            meta={(
              <StepMeta
                value={`${dayRows.filter((d) => !d.notice).length}/${dayRows.length}`}
                label="days measured"
              />
            )}
          >
            <ResultByDayStep sort={daySort} />
          </StepAccordion>

          <StepAuditNote afterStep={MOVERS_STEP['mvp-step-day'].step} ideas={MOVERS_STEP['mvp-step-day'].audit} />

          <StepAccordion
            pageId={MOVERS_PAGE_ID}
            {...MOVERS_STEP['mvp-step-symbol']}
            meta={(
              <>
                <StepMeta value={symbolRows.length} label="symbols" />
                <StepMeta value={symbolRows.reduce((a, s) => a + Number(s.trades || 0), 0)} label="trades" />
              </>
            )}
          >
            <ResultBySymbolStep sort={symbolSort} />
          </StepAccordion>

          <StepAuditNote afterStep={MOVERS_STEP['mvp-step-symbol'].step} ideas={MOVERS_STEP['mvp-step-symbol'].audit} />


          {/*
            #1344 — the scoring step. Every bucket is a count of the ENGINE's own per-bar verdict
            (`bar.state`), so this table cannot disagree with the Decisions table further down: both read
            one vocabulary. The speed rating is `speed-momentum`'s own score, uninvented.
          */}
          <StepAccordion
            pageId={MOVERS_PAGE_ID}
            {...MOVERS_STEP['mvp-step-funnel']}
            meta={(
              <>
                <StepMeta value={funnelSummary.scored} label="bars scored" />
                <StepMeta value={funnelSummary.entered} label="traded" />
                <StepMeta
                  value={funnelSummary.scored > 0
                    ? `${((funnelSummary.entered / funnelSummary.scored) * 100).toFixed(1)}%`
                    : '—'}
                  label="of bars"
                />
              </>
            )}
          >
            <ScoringFunnelStep entries={depthEntries} />
          </StepAccordion>

          <StepAuditNote afterStep={MOVERS_STEP['mvp-step-funnel'].step} ideas={MOVERS_STEP['mvp-step-funnel'].audit} />


          {/*
            #1344 — the protocol step: what each directive has actually scored and predicted. The figures
            are measured across EVERY strategy (the endpoint has no protocol filter), which the step says
            above its table — these are not this run's evidence.
          */}
          <StepAccordion
            pageId={MOVERS_PAGE_ID}
            {...MOVERS_STEP['mvp-step-directives']}
            meta={(
              <StepMeta value={protocolDirectives.length || '—'} label="directives in protocol" />
            )}
          >
            <DirectiveRecordStep entries={depthEntries} />
          </StepAccordion>

          <StepAuditNote afterStep={MOVERS_STEP['mvp-step-directives'].step} ideas={MOVERS_STEP['mvp-step-directives'].audit} />


          {/* Stored datasets that are NOT offered (their name carries no day) are deliberately not shown
              on the page. Measured 2026-11-20: the count + naming rule read as noise between containers.
              The API still reports them in `datasetsQuery.data.excluded` for anyone diagnosing a missing
              day — do not re-add a paragraph or note here. */}

          {/* ── step 6 · bar by bar ── */}
          <StepAccordion
            pageId={MOVERS_PAGE_ID}
            {...MOVERS_STEP['mvp-step-parity']}
          >
            <ParityStep runs={okRuns} />
          </StepAccordion>

          <StepAuditNote afterStep={MOVERS_STEP['mvp-step-parity'].step} ideas={MOVERS_STEP['mvp-step-parity'].audit} />

          <StepAccordion
            pageId={MOVERS_PAGE_ID}
            {...MOVERS_STEP['mvp-step-bars']}
            meta={(
              <>
                {/**
                  * ⚠️ THESE WERE 0 / 0 WHENEVER A SYMBOL CHIP WAS PICKED (found 2026-11-26). `daySymbols`
                  * and `mergedTrades` are built from the "All symbols" day view only, so focusing one
                  * instrument — the normal way to open this step — reported no symbols and no executions
                  * above a panel holding 54 bars and 63 trades. A header that contradicts its own body is
                  * worse than no header: it reads as "this step has nothing in it".
                  */}
                <StepMeta
                  value={isAllSymbols ? daySymbols.length : 1}
                  label={isAllSymbols && daySymbols.length !== 1 ? 'symbols' : 'symbol'}
                />
                <StepMeta
                  value={isAllSymbols ? mergedTrades.length : (focusedDepth?.detail?.trades?.length ?? 0)}
                  label="executions"
                />
              </>
            )}
          >
          {/* ⚠️ NO INNER `.mvp-panel` (owner, 2026-11-23). The accordion body IS the tinted surface
              now; a panel inside it was a coloured box within a coloured box. The head/heading stay —
              the chips below them are controls, not chrome. */}
          <div className="mvp-panel-head">
            <h2 className="mvp-panel-title">Bar by bar</h2>
              {depthEntries.length > 1 && (
                <div className="mvp-chips" role="group" aria-label="Symbol and day to scrutinise">
                  {/*
                    * ⚠️ "All symbols" COMES FIRST, PER DAY (owner, 2026-11-23): the table showed
                    * executions that all looked like one instrument and did not say which. A merged view
                    * answers "what happened on this day across the names it picked" without making the
                    * reader click every chip and add up in their head.
                    */}
                  {[...new Set(depthEntries.map((e) => e.day))].map((day) => (
                    <button
                      key={`all:${day}`}
                      type="button"
                      className={`mvp-chip mvp-chip--tight${`all:${day}` === focusKey ? ' mvp-chip--on' : ''}`}
                      aria-pressed={`all:${day}` === focusKey}
                      onClick={() => setFocusKey(`all:${day}`)}
                    >
                      <span className="mvp-chip-day">All symbols</span>
                      <span className="mvp-chip-meta">{dayLabel(day)}</span>
                    </button>
                  ))}
                  {depthEntries.map((e) => (
                    <button
                      key={e.key}
                      type="button"
                      className={`mvp-chip mvp-chip--tight${e.key === focusedDepth?.key && !isAllSymbols ? ' mvp-chip--on' : ''}`}
                      aria-pressed={e.key === focusedDepth?.key && !isAllSymbols}
                      onClick={() => setFocusKey(e.key)}
                    >
                      <span className="mvp-chip-day">{e.symbol}</span>
                      <span className="mvp-chip-meta">{dayLabel(e.day)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {isAllSymbols ? (
              <section id="mvp-sec-execution" aria-label="Executions">
                <h3 className="mvp-depth-title">
                  Executions — every symbol the day picked
                  <span className="mvp-muted"> ({mergedTrades.length} row(s) across {daySymbols.length} symbol(s))</span>
                </h3>
                <ExecutionsTable trades={mergedTrades} />
                <p className="mvp-note">
                  The ladder and the per-bar table are per symbol — pick a chip above for those. This
                  table is the day&apos;s whole set of executions so the prices can be read against the
                  right ticker.
                </p>
              </section>
            ) : focusedDepth ? (
              <MoversDepthPanel symbol={focusedDepth.symbol} day={focusedDepth.day} detail={focusedDepth.detail} />
            ) : (
              <p className="mvp-note">
                No per-bar detail was returned. Turn on <strong>Bar-by-bar detail</strong> above and run
                again — a run without it keeps one composite per bar and no decomposition.
              </p>
            )}
          </StepAccordion>

          <StepAuditNote afterStep={MOVERS_STEP['mvp-step-bars'].step} ideas={MOVERS_STEP['mvp-step-bars'].audit} />

          {/*
            #1340 — the inventory sits AFTER the depth panel on purpose: it is what you read once you
            have looked at the numbers and want to know what else the run already knows.
          */}
          <StepAccordion
            pageId={MOVERS_PAGE_ID}
            {...MOVERS_STEP['mvp-step-inventory']}
          >
            <UnusedDataPanel runs={okRuns} bare />
          </StepAccordion>

          <StepAuditNote afterStep={MOVERS_STEP['mvp-step-inventory'].step} ideas={MOVERS_STEP['mvp-step-inventory'].audit} />

          {/* ── step 8 · which configuration these numbers describe ── */}
          {/* A change here PATCHes the bot and runs the same queue again (register row 247), so the
              page's own runner is handed in rather than the panel starting a run of its own. */}
          <StepAccordion
            pageId={MOVERS_PAGE_ID}
            {...MOVERS_STEP['mvp-step-config']}
            meta={(
              <>
                <StepMeta value={okRuns[0]?.tradeConfig?.bot?.name ?? 'no bot'} label="bot" />
                <StepMeta
                  value={okRuns[0]?.tradeConfig?.bot?.active ? 'active' : 'inactive'}
                  label="state"
                  tone={okRuns[0]?.tradeConfig?.bot?.active ? 'pos' : ''}
                />
              </>
            )}
          >
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
            priceRef={priceRef}
          />
          </StepAccordion>
          </>
          )}
        </div>
      )}
    </div>
  );
}
