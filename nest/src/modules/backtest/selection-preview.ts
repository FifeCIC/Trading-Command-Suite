/**
 * selection-preview.ts — WHAT A DAY WOULD COST, TOLD BEFORE THE RUN IS SPENT.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * Owner, 2026-11-25, examining the movers strategy page: the run's own admission tests (publisher
 * choice, the 100-bar floor, the cutoff basis) all fire AFTER the button is pressed — the bar floor
 * per symbol, in particular, errors INSIDE the engine loop, after the day has been ranked. Measured
 * the same day against the stored day-lists: 3 of 14 lists carry a symbol below the floor
 * (`SFWL` at 42 / 51 / 59 bars), 1 list holds a ten-name screen where two candidates publish on a
 * different publisher and are therefore invisible to the ranking, and one list holds a SINGLE
 * candidate while `topN` offers 5. None of that was visible before a run.
 *
 * ── ⚠️ TWO BAR COUNTS, ON TWO DIFFERENT BASES — DO NOT MERGE THEM ───────────────────────────────
 * They answer different questions and are measured by different queries, because the run does:
 *
 * | Field | Basis | Predicts |
 * |---|---|---|
 * | `cutoffBars` | the RANKING's publisher, the group window, bars ≤ `cutoffUtc` on the answer day | whether this symbol can appear in the ranking at all |
 * | `windowBars` | the ENGINE's publisher (chosen per symbol), that symbol's OWN period window | the `< 100 bars` refusal, which is thrown per symbol inside the engine loop |
 *
 * A preview that counted one and compared it against the other would report a clean day that the run
 * then refuses — the "plausible output, no error" shape this repo designs against. The floor comes
 * from `BACKTEST_WINDOW_SIZE` rather than a local literal, so this can never disagree with the guard
 * that actually throws.
 *
 * ── ⚠️ NO SELECTED NAMES ────────────────────────────────────────────────────────────────────────
 * `selected` is a COUNT. The page deliberately shows no symbol list before a run — live, nobody knows
 * which names will be featured, and the bot reads a feed at the cutoff. The preview says how many the
 * ranking picked and on what basis; it does not hand the reader the answer key.
 *
 * ── WHAT A RUN COSTS, AND WHAT IS ESTIMATE RATHER THAN COUNT (owner, 2026-11-26) ─────────────────
 * The audit note asked for the run's cost before the button is pressed — *"days × top N symbols
 * re-scored"*. The ENGINE scores ONE BAR PER `fullScore()` CALL, after a 100-bar warm-up
 * (`backtest.service.ts`: `for (day = windowSize; day < bars.length; day++)`), so:
 *
 *     scoreEvaluations = Σ over the SELECTED symbols of max(0, windowBars − BACKTEST_WINDOW_SIZE)
 *
 * ⇒ **WORK IS EXACT.** It comes from bar counts already read for the admission test, over the symbols
 * the ranking actually picked. It is NOT the day's total: measured 2026-11-26, `movers-losers-2026-11-09`
 * holds a 9,332-bar candidate, and the ranking picked `DOMH`(220) / `KPTI`(448) / `SCKT`(190) — 558
 * bar-scores, not 16,224. A cost taken from the day's total would overstate that day 29×.
 *
 * ⇒ **TIME IS AN ESTIMATE, AND IT IS A BAND, NOT A NUMBER.** Six real runs were timed on this machine
 * on 2026-11-26 and the spread was **12–30 ms per bar scored, end to end** (database load, ranking and
 * transfer included). Fitting a line gave ≈ 2.6 s fixed + 11 ms per score, but the residual was around
 * ±40% because the machine carries other agents' work — so a single "≈ 42 s" would be precision this
 * does not have. The band is reported, and `cost.basis` carries the measurement so the page can print
 * it rather than inventing confidence.
 *
 * ⚠️ THE RATE IS A MEASUREMENT WITH A DATE, NOT A CONSTANT OF NATURE. If the engine gets faster or the
 * machine is replaced, `SCORE_COST_MS` is stale and nothing fails — it is an ESTIMATE, and every
 * surface that renders it must say so. Recorded as a gap rather than solved: a stored per-run duration
 * would let this calibrate itself, and no such column exists (`backtestrun` and `backtest_selection`
 * have no timing field).
 */
import { BACKTEST_WINDOW_SIZE, PERIOD_BAR_CAP } from './backtest.service';

/**
 * Measured end-to-end cost of ONE bar scored, in milliseconds.
 *
 * ── HOW THIS WAS MEASURED (do not replace these numbers without redoing it) ──────────────────────
 * Six `POST /api/backtest/selection-run` calls on 2026-11-26, one per movers day-list, timed with
 * `perf_counter` around the whole request and divided by the bar-scores the run performed:
 *
 * | day | picked | bar-scores | seconds | ms/score |
 * |---|---|---|---|---|
 * | movers-losers-2026-11-13 | 2 | 355 | 5.83 | 16.4 |
 * | movers-winners-2026-11-11 | 3 | 658 | 8.03 | 12.2 |
 * | movers-losers-2026-11-09 | 3 | 558 | 8.21 | 14.7 |
 * | movers-losers-2026-11-20 | 1 | 227 | 6.82 | 30.1 |
 * | movers-losers-2026-11-10 | 3 | 1011 | 15.20 | 15.0 |
 * | movers-winners-2026-11-20 | 3 | 578 | 12.52 | 21.7 |
 *
 * ⚠️ SMALL RUNS SIT AT THE SLOW END because the fixed cost (period load, ranking pass, HTTP) does not
 * shrink with the work — which is why the band is applied unmodified rather than corrected for size.
 * Erring HIGH on a small run is the safe direction: the reader is never told a run is cheaper than it
 * was.
 */
export const SCORE_COST_MS = { fast: 12, slow: 30, measuredOn: '2026-11-26', runs: 6 } as const;


/**
 * ── DECISION (2026-11-25, primary) ──
 * WHAT:       the pre-run preview is a `dryRun` flag on `POST /api/backtest/selection-run` that returns
 *             after ADMISSION, rather than a coverage endpoint of its own.
 * WHY:        a preview with its own copy of the admission rules (publisher choice, side conflict,
 *             `selectAnswerDay`, the 100-bar floor) is the copy that goes stale — and it fails in the
 *             worst direction: it reports a thin day as clean, and the run then refuses or errors.
 *             One code path cannot disagree with itself.
 * INSTEAD OF: adding coverage to `GET /movers-datasets`. That endpoint has no provider filter and no
 *             side/cutoff admission, so its numbers would have disagreed with the run.
 * REVERSE BY: deleting the `if (request.dryRun)` branch in `selection-run.service.ts` and the page's
 *             `checkCoverage()`; nothing is stored, so no data migration is involved.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 286
 * GUARD:     nest/src/modules/backtest/selection-preview.spec.ts
 */

/**
 * ── DECISION (2026-11-26, primary) ──
 * WHAT:       the run's cost is reported as an EXACT COUNT of bar-scores plus a wall-clock BAND, never
 *             as a single estimated duration.
 * WHY:        six real runs timed on this machine spanned 12–30 ms per bar scored, and a line fitted
 *             through them left ~±40% residual because the machine carries other agents' work. A
 *             single "≈ 42 s" would be precision this does not have, and the reader would treat a miss
 *             as a bug rather than as the estimate it is. The count is exact and carries the decision
 *             on its own; the band only translates it.
 * INSTEAD OF: one `msPerBar` constant multiplied into a point estimate — which is the version that
 *             looks authoritative and is wrong by a third.
 * REVERSE BY: collapsing `PreviewCost.estimatedSeconds` to a single number and deleting the band from
 *             the page total; nothing is stored, so no migration is involved.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 290
 * GUARD:     nest/src/modules/backtest/selection-preview.spec.ts (band ordering + basis named)
 */

/** One candidate's coverage, on both bases. */
export interface PreviewSymbolCoverage {
  symbol: string;
  /** Bars the RANKING can see: ranking publisher, group window, at or before the cutoff. */
  cutoffBars: number;
  /** Bars the ENGINE will load: that symbol's own window, on the publisher the engine will choose. */
  windowBars: number;
  /** The publisher the engine will read for this symbol — `null` when its window holds no bars. */
  windowProvider: string | null;
  /** `windowBars >= BACKTEST_WINDOW_SIZE`. False means the engine REFUSES this symbol. */
  clearsFloor: boolean;
  /**
   * `windowBars > PERIOD_BAR_CAP`. True means the engine refuses the WHOLE period rather than a
   * truncated window — a different refusal from the floor, and silent until the run is started.
   */
  exceedsCap: boolean;
  /** `cutoffBars > 0`. False means the ranking cannot see this candidate at all. */
  visibleToRanking: boolean;
}

/** `ready` = every candidate can be ranked and run. `thin` = it will run but with a named cost. */
export type PreviewStatus = 'ready' | 'thin' | 'blocked';

/**
 * WHAT THIS RUN WILL SPEND. `scoreEvaluations` is a COUNT; `estimatedSeconds` is an ESTIMATE over a
 * measured band — see `SCORE_COST_MS` and the header. They are reported separately on purpose: a
 * derived duration must never be the only thing on screen, or the reader cannot tell how much of it
 * was measured.
 */
export interface PreviewCost {
  /** `Σ max(0, windowBars − 100)` over the RUNNABLE selected symbols — one `fullScore()` per bar. EXACT. */
  scoreEvaluations: number;
  /** Bars the engine will READ for those symbols: the score count plus the 100-bar warm-up each. */
  barsLoaded: number;
  /**
   * The same count if every rankable candidate were picked — the cost of raising `topN` on this day.
   * Equal to `scoreEvaluations` when the list holds no more rankable names than `topN`.
   */
  ifAllRankable: number;
  /**
   * Picks the engine will REFUSE (below the bar floor, or over the period cap). They cost nothing
   * because nothing is scored — but they are why a day can report zero trades without the strategy
   * having been measured at all.
   */
  unrunnablePicks: number;
  /** Wall-clock band for `scoreEvaluations`, in seconds. Both zero when nothing will be scored. */
  estimatedSeconds: { low: number; high: number };
  /** One sentence naming how the band was measured, so a surface never prints a bare "≈ 40 s". */
  basis: string;
}

export interface SelectionPreview {
  /** Discriminator, so a caller can tell a preview from a result without guessing. */
  preview: true;
  datasetName: string;
  protocolId: string;
  answerDate: string;
  side: string;
  sideSource: string;
  timeframe: string;
  /** What the run was asked for. */
  topN: number;
  cutoffUtc: string;
  /** How many names the list holds — the population `topN` is drawn from. */
  candidates: number;
  /** How many of them the ranking can see AND the engine can run. */
  usable: number;
  /** How many the ranking selected. A COUNT — never the names (see the header). */
  selected: number;
  /** The fewest cutoff bars among the selected symbols: the thinnest basis this ranking rests on. */
  rankBasisBars: number | null;
  /** The publisher the RANKING will read, and its ambiguity note (#1282). */
  rankingProvider: {
    provider: string | null;
    available: string[];
    ambiguous: boolean;
    note: string | null;
  };
  symbols: PreviewSymbolCoverage[];
  cost: PreviewCost;
  status: PreviewStatus;
  /** One sentence each, ordered most consequential first. Empty is a normal result. */
  notes: string[];
  /** The floor the counts are judged against, so the page never states a literal of its own. */
  barFloor: number;
  /** The cap a single period may not exceed, for the same reason: no literal on the page. */
  barCap: number;
}

export interface BuildPreviewInput {
  datasetName: string;
  protocolId: string;
  answerDate: string;
  side: string;
  sideSource: string;
  timeframe: string;
  topN: number;
  cutoffUtc: string;
  candidates: string[];
  /** The symbols `buildDayRanks`/`selectAnswerDay` selected for the answer day. */
  selected: string[];
  rankingProvider: { provider: string | null; available: string[]; ambiguous: boolean; note: string | null };
  /** Bars the RANKING holds per symbol, at or before the cutoff on the answer day. */
  cutoffBarsBySymbol: Readonly<Record<string, number>>;
  /** The engine's own basis per symbol: bars in its window on the publisher it will read. */
  windowBarsBySymbol: Readonly<Record<string, { bars: number; provider: string | null }>>;
}

/** One decimal place — a band in seconds never needs more, and two would imply precision. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Cap a name list so a note stays one line (the owner's objection was volume, not detail). */
function namesCapped(names: string[], cap = 4): string {
  if (names.length <= cap) return names.join(', ');
  return `${names.slice(0, cap).join(', ')} +${names.length - cap} more`;
}

/**
 * buildSelectionPreview() — the day as the RUN will find it, from bars already in memory plus one
 * per-symbol count supplied by the caller.
 *
 * ⚠️ PURE, so the summary rules are testable without a database. The queries live in
 * `SelectionRunService` beside the identical choices the run makes; this function only compares what
 * they returned.
 */
export function buildSelectionPreview(input: BuildPreviewInput): SelectionPreview {
  const floor = BACKTEST_WINDOW_SIZE;
  const selected = new Set(input.selected);

  const symbols: PreviewSymbolCoverage[] = [...input.candidates]
    .sort((a, b) => a.localeCompare(b))
    .map((symbol) => {
      const cutoffBars = Number(input.cutoffBarsBySymbol[symbol] ?? 0);
      const engine = input.windowBarsBySymbol[symbol] ?? { bars: 0, provider: null };
      return {
        symbol,
        cutoffBars,
        windowBars: engine.bars,
        windowProvider: engine.provider,
        clearsFloor: engine.bars >= floor,
        exceedsCap: engine.bars > PERIOD_BAR_CAP,
        visibleToRanking: cutoffBars > 0,
      };
    });

  const usable = symbols.filter((s) => s.clearsFloor && s.visibleToRanking && !s.exceedsCap).length;

  const selectedBars = symbols
    .filter((s) => selected.has(s.symbol))
    .map((s) => s.cutoffBars);
  const rankBasisBars = selectedBars.length ? Math.min(...selectedBars) : null;

  /**
   * COST IS COMPUTED OVER THE PICKED SYMBOLS, NOT THE LIST.
   *
   * ⚠️ The engine is called once per SELECTED symbol and scores every bar in that symbol's own window
   * after the warm-up — nothing else in the day is touched. Measured 2026-11-26: `movers-losers-2026-11-09`
   * contains a 9,332-bar candidate the ranking did NOT pick, and the run spent 558 bar-scores, not
   * 16,224. Costing the whole list would have been wrong by 29× on the one day a reader most needs the
   * figure. `ifAllRankable` carries the whole-list figure separately, for the `topN` decision.
   *
   * ── ⚠️ THE RANKING CAN PICK SOMETHING THE ENGINE WILL REFUSE (found 2026-11-26) ────────────────
   * `movers-winners-2026-11-17` with `topN 1` ranks `SFWL` first — 59 bars, below the 100 floor — so the
   * run spends ZERO bar-scores and the day reports no trades. Read beside `usable: 1` that looks like
   * "the strategy found nothing", when in fact the pick could never be measured. A refused pick is
   * therefore counted, and a day whose EVERY pick is refused is `blocked` rather than `thin`: its result
   * does not describe the strategy at all.
   */
  const scoredOf = (s: PreviewSymbolCoverage) => Math.max(0, s.windowBars - floor);
  const picked = symbols.filter((s) => selected.has(s.symbol));
  /** A pick the engine will actually run. Over-cap and below-floor are refused BEFORE any scoring. */
  const runnable = (s: PreviewSymbolCoverage) => s.clearsFloor && !s.exceedsCap;
  const runnablePicks = picked.filter(runnable);
  const unrunnablePicks = picked.length - runnablePicks.length;
  const pickable = symbols.filter((s) => s.clearsFloor && s.visibleToRanking && !s.exceedsCap);
  const scoreEvaluations = runnablePicks.reduce((a, s) => a + scoredOf(s), 0);
  const barsLoaded = runnablePicks.reduce((a, s) => a + s.windowBars, 0);
  const ifAllRankable = pickable.reduce((a, s) => a + scoredOf(s), 0);
  const cost: PreviewCost = {
    scoreEvaluations,
    barsLoaded,
    ifAllRankable,
    unrunnablePicks,
    estimatedSeconds: {
      low: round1((scoreEvaluations * SCORE_COST_MS.fast) / 1000),
      high: round1((scoreEvaluations * SCORE_COST_MS.slow) / 1000),
    },
    basis:
      `measured on ${SCORE_COST_MS.runs} real runs (${SCORE_COST_MS.measuredOn}): ` +
      `${SCORE_COST_MS.fast}–${SCORE_COST_MS.slow} ms per bar scored, end to end`,
  };

  const notes: string[] = [];
  const belowFloor = symbols.filter((s) => !s.clearsFloor);
  const overCap = symbols.filter((s) => s.exceedsCap);
  const invisible = symbols.filter((s) => !s.visibleToRanking);

  if (overCap.length) {
    notes.push(
      `${overCap.length} candidate(s) exceed the ${PERIOD_BAR_CAP.toLocaleString()}-bar period cap ` +
        `(${namesCapped(overCap.map((s) => `${s.symbol} ${s.windowBars}`))}) — the engine refuses that ` +
        'window rather than measuring a truncated one.',
    );
  }

  if (belowFloor.length) {
    notes.push(
      `${belowFloor.length} candidate(s) hold fewer than ${floor} bars in their own window ` +
        `(${namesCapped(belowFloor.map((s) => `${s.symbol} ${s.windowBars}`))}) — the engine refuses ` +
        'those symbols rather than trading zero.',
    );
  }
  if (invisible.length) {
    const provider = input.rankingProvider.provider ?? 'the chosen publisher';
    notes.push(
      `${invisible.length} candidate(s) publish no ${provider} bars in this window ` +
        `(${namesCapped(invisible.map((s) => s.symbol))}), so the ranking cannot see them.`,
    );
  }
  if (input.topN > input.candidates.length) {
    notes.push(
      `top ${input.topN} on a list of ${input.candidates.length} — the list holds fewer names than the ` +
        'run asks for, so fewer will be traded than the setting says.',
    );
  }
  if (unrunnablePicks > 0) {
    notes.push(
      `${unrunnablePicks} of the ${picked.length} symbol(s) the ranking picked cannot be run (below the ` +
        `${floor}-bar floor, or over the period cap) — that day reports an error rather than trades, and ` +
        'a zero-trade result there says nothing about the strategy.',
    );
  }
  // ⚠️ `> 0` guards the blocked case: with nothing visible the min is 0, and "the ranking rests on 0
  // bars" would describe a ranking that does not exist. The two causes are already named above.
  if (rankBasisBars !== null && rankBasisBars > 0 && rankBasisBars <= 2) {
    notes.push(
      `The ranking rests on ${rankBasisBars} bar(s) by ${input.cutoffUtc} UTC — a thin basis, not a refusal.`,
    );
  }

  const status: PreviewStatus =
    usable === 0 || (picked.length > 0 && unrunnablePicks === picked.length)
      ? 'blocked'
      : notes.length
        ? 'thin'
        : 'ready';

  return {
    preview: true,
    datasetName: input.datasetName,
    protocolId: input.protocolId,
    answerDate: input.answerDate,
    side: input.side,
    sideSource: input.sideSource,
    timeframe: input.timeframe,
    topN: input.topN,
    cutoffUtc: input.cutoffUtc,
    candidates: input.candidates.length,
    usable,
    selected: input.selected.length,
    rankBasisBars,
    rankingProvider: input.rankingProvider,
    symbols,
    cost,
    status,
    notes,
    barFloor: floor,
    barCap: PERIOD_BAR_CAP,
  };
}
