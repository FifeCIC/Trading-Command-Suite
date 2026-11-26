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
 */
import { BACKTEST_WINDOW_SIZE } from './backtest.service';

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
  /** `cutoffBars > 0`. False means the ranking cannot see this candidate at all. */
  visibleToRanking: boolean;
}

/** `ready` = every candidate can be ranked and run. `thin` = it will run but with a named cost. */
export type PreviewStatus = 'ready' | 'thin' | 'blocked';

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
  status: PreviewStatus;
  /** One sentence each, ordered most consequential first. Empty is a normal result. */
  notes: string[];
  /** The floor the counts are judged against, so the page never states a literal of its own. */
  barFloor: number;
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
        visibleToRanking: cutoffBars > 0,
      };
    });

  const usable = symbols.filter((s) => s.clearsFloor && s.visibleToRanking).length;

  const selectedBars = symbols
    .filter((s) => selected.has(s.symbol))
    .map((s) => s.cutoffBars);
  const rankBasisBars = selectedBars.length ? Math.min(...selectedBars) : null;

  const notes: string[] = [];
  const belowFloor = symbols.filter((s) => !s.clearsFloor);
  const invisible = symbols.filter((s) => !s.visibleToRanking);

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
  // ⚠️ `> 0` guards the blocked case: with nothing visible the min is 0, and "the ranking rests on 0
  // bars" would describe a ranking that does not exist. The two causes are already named above.
  if (rankBasisBars !== null && rankBasisBars > 0 && rankBasisBars <= 2) {
    notes.push(
      `The ranking rests on ${rankBasisBars} bar(s) by ${input.cutoffUtc} UTC — a thin basis, not a refusal.`,
    );
  }

  const status: PreviewStatus =
    usable === 0 ? 'blocked' : notes.length ? 'thin' : 'ready';

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
    status,
    notes,
    barFloor: floor,
  };
}
