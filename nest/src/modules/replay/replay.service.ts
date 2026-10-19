import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ProtocolGatingService, SIGNAL_THRESHOLDS } from '../scoring/protocol-gating.service';
import { resolveMt5BridgeUrl } from '../providers/mt5/mt5-bridge.config';
import { BacktestPeriodService } from '../backtest/backtest-period.service';
// #1049 / register row 56 — the read-time exclusion. The write-side rule can only ever drop the
// NEWEST bar (a refresh must never delete a settled row), so the 205 historical duplicates can only
// be removed here, on the replay path.
import { dropConsecutiveDuplicates } from '../../common/utils/building-bar-duplicate';
import type { MarketBar } from '../directives/interfaces/directive.interface';

/**
 * ⚠️ THE REPLAY BUDGET — measured 2026-10-16. Two guards, because a prediction is not enough.
 *
 * WHY IT MUST EXIST: the API client abandons a request at **28s**. A legitimate-looking request —
 * 5m over 10 days — takes 22-28s with ONE protocol and fails outright with three, and the page
 * offers exactly that window. Nothing bounded this, so the endpoint's latency was set by the
 * caller's date range. The caller then saw a timeout, and the server kept working on an answer
 * nobody would read.
 *
 * ⚠️ Do NOT name the client's timeout CODE here. It is a frontend code (`core/notices/from-error.js`)
 * that this server never emits, and `validate-notices.cjs` reads any code mentioned in backend
 * source as backend-emitted — so citing it here makes the guard demand a server-catalogue entry for
 * a message the server cannot send. The code belongs in the client files that raise it.
 *
 * ⚠️ WHY A WALL-CLOCK DEADLINE, AND NOT JUST A CALCULATED CAP. The cost per step varies **5.2×**
 * BETWEEN PROTOCOLS at the same window. Measured on EURUSD 1h over 14 days (212 steps, ONE protocol):
 *
 *   | protocol             | time   | ms/step |
 *   |----------------------|--------|---------|
 *   | euro-stoxx-v1        |  2.44s |    11.5 |
 *   | doge-speed-v1        |  2.53s |    11.9 |
 *   | vix-spike-v1         |  4.20s |    19.8 |
 *   | gold-macro-v1        |  4.29s |    20.2 |
 *   | momentum-stock-v1    |  6.75s |    31.9 |
 *   | xau-speed-v1         |  8.48s |    40.0 |
 *   | btc-speed-v1         |  9.44s |    44.5 |
 *   | btc-scalp-v1         | 12.65s |    59.7 |
 *
 * So `steps × protocols` predicts NOTHING usable: 800 ops is 9s for the cheapest protocol and 48s
 * for the dearest. `REPLAY_OP_FAST_REFUSE` therefore exists only to refuse the obviously impossible
 * in milliseconds; the DEADLINE is the guarantee, because it measures the work instead of modelling
 * it. Two earlier versions of this guard were wrong in exactly this way — the first used 1,500 ops
 * at 11 ms; the second used 800 ops at 25 ms and a 510-op request still ran past 28s. A cost model
 * that has been wrong twice is not made right by a third estimate.
 */
/**
 * Fast-path refusal, DERIVED — not guessed.
 *
 * No protocol has measured below **11.5 ms per step**, so inside a 20s deadline the theoretical
 * maximum is `20_000 / 11.5 ≈ 1,739` steps × protocols. A request above that figure cannot finish
 * in budget for ANY protocol mix, so it is refused in milliseconds instead of after 20s of work.
 * Requests BELOW it are handed to the deadline, which decides on the real cost — the dearest
 * protocol measured (59.7 ms/step) manages only ~335 ops in the same 20s, so the deadline is what
 * catches those.
 */
const REPLAY_OP_FAST_REFUSE = 1700;

/** The real guard. 20s leaves ~8s of headroom under the client's 28s timeout. */
const REPLAY_DEADLINE_MS = 20_000;

export interface ReplayConfig {
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
  /**
   * #986 — replay a STORED PERIOD in one call.
   *
   * ⚠️ The period is AUTHORITATIVE for `symbol`/`timeframe`/`from`/`to`; the caller supplies only
   * the scoring options (protocols, thresholds, window). Set this and the four window fields may be
   * omitted — hand-assembling them is how a replay ends up measuring slightly different dates from
   * the backtest it is meant to explain.
   */
  periodId?: string;
  protocolIds?: string[];
  windowSize?: number;
  /** Override BUY threshold (default: top 20th percentile of scores) */
  buyThreshold?: number;
  /** Override SELL threshold (default: bottom 20th percentile of scores) */
  sellThreshold?: number;
  /** Use relative scoring: rank each signal within its distribution (default: true) */
  relativeScoring?: boolean;
}

export interface ReplayBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ReplayStep {
  timestamp: Date;
  bar: ReplayBar;
  composite: number;
  signal: string;
  normalizedScore: number;
  /**
   * The raw pre-risk directional score and the CONFIGURED denominator it was scaled against.
   * `normalizedScore === signalRaw / signalMax`. Carried so the backtesting table can show
   * "60 / 140" — the number AND what it was measured against — rather than only the derived
   * percentage, which is the form that hid the denominator question (#823).
   */
  signalRaw: number;
  signalMax: number;
  /** The DUAL score's second reading: opportunity (every directive counts, gates included), as a
   *  percentage. Lets the protocol table show both readings side by side, as the Ladder does. */
  opportunityPct: number;
  /** Direction-eligible directives that produced a reading this bar — the observed count. */
  directionEligibleDirectives?: number;
  /** Selected protocol (signal thesis) + its name + executing bot (execution policy). */
  protocolId: string | null;
  protocolName: string | null;
  botName: string | null;
  activeDirectives: number;
  totalDirectives: number;
  /** Forward returns: what happened AFTER this signal */
  forwardReturn1?: number;  forwardReturn3?: number;
  forwardReturn5?: number;
  forwardReturn10?: number;
  /** Was this signal directionally correct? */
  signalCorrect?: boolean;
  directiveBreakdown?: Array<{
    name: string;
    score: number;
    maxScore: number;
    signalClass: string;
    reason: string;
  }>;
  protocolResults?: Array<{
    protocolId: string;
    composite: number;
    signal: string;
    passed: boolean;
    checks?: any;
  }>;
}

export interface ReplayResult {
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
  totalBars: number;
  /**
   * #986 — the stored period this replayed, echoed so the output says WHICH window it describes.
   * Absent for a hand-assembled config.
   */
  period?: { id: string; name: string; note: string | null };
  /**
   * The thresholds a score must clear to become a signal, echoed so the table can show the BAR
   * each row is measured against instead of leaving the reader to assume one (#823).
   */
  thresholds: { entry: number; strong: number; scale: string };
  steps: ReplayStep[];
  summary: {
    avgComposite: number;
    maxComposite: number;
    minComposite: number;
    buySignals: number;
    sellSignals: number;
    holdSignals: number;
    /** #758 — bars where the protocol had NO directional evidence. Deliberately NOT folded
     *  into `holdSignals`: a phantom "HOLD" is what #758 removed from the scorer, and
     *  re-creating it in the summary would report "the market did nothing" when the truth
     *  is "we could not read the market". */
    noDataSignals: number;
    totalDirectivesRun: number;
    directivesPerBar: number;
  };
  /** Backtesting outcomes — signal accuracy and forward returns */
  outcomes?: {
    buyAccuracy: number;
    sellAccuracy: number;
    avgBuyReturn1: number;
    avgSellReturn1: number;
    avgBuyReturn5: number;
    avgSellReturn5: number;
    bestBuyReturn: number;
    worstBuyReturn: number;
    signalCount: number;
    missedOpportunities: number;
    falsePositives: number;
    lowScoreAccuracy: number;
    midScoreAccuracy: number;
  };
}

/**
 * May the MT5 fallback REPLACE the stored series?
 *
 * ⚠️ #1128 — ONLY when it genuinely adds bars. The bridge is asked for its LATEST `limit` bars with
 * no date parameters, so for a historical window it returns nothing inside the requested range.
 * The old code returned that empty list regardless, throwing away the stored rows it had already
 * read — so a window holding 12 bars reported "found 0 bars", blaming the store for a count it
 * never had. A fallback that can REDUCE the data available is worse than no fallback.
 */
export function preferFallbackBars(fallbackCount: number, storedCount: number): boolean {
  return fallbackCount > storedCount;
}

@Injectable()
export class ReplayService {
  private readonly logger = new Logger(ReplayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly protocolGating: ProtocolGatingService,
    // #986 — resolves a stored period to the window the replay walks. Optional so the existing
    // hand-assembled path keeps working unchanged when no period is supplied.
    private readonly periods?: BacktestPeriodService,
  ) {}

  /** Load bars for a symbol within a date range */
  async loadBars(    symbol: string,
    timeframe: string,
    from: Date,
    to: Date,
  ): Promise<ReplayBar[]> {
    // Find symbol in DB
    const sym = await this.prisma.symbol.findFirst({
      where: { ticker: symbol.toUpperCase() },
    });

    if (!sym) {
      this.logger.warn(`Symbol ${symbol} not found in DB`);
      return [];
    }

    const rawRows = await this.prisma.marketBar.findMany({
      where: {
        symbolId: sym.id,
        timeframe,
        timestamp: { gte: from, lte: to },
      },
      orderBy: { timestamp: 'asc' },
    });

    // ── #1049 / register row 56 — READ-TIME exclusion of the duplicate bars ──────────────────
    //
    // A replay walks the STORE. The 205 duplicate daily bars already written are historical, and
    // the write-side rule deliberately cannot remove them (it only ever drops the newest, so a
    // refresh can never delete a settled row). So the exclusion belongs HERE, on the read path.
    //
    // ⚠️ 166 of those 205 are FRIDAY, on a series stamped by session OPEN where no Friday session
    // exists — so a daily replay would trade a day that never happened.
    //
    // ⚠️ Deliberately NOT applied in `MarketDataService.getBars()`. Removing a bar from a
    // directive's window changes what a tradeable symbol scores — a maths change, needing a copied
    // configuration and a comparison. A BACKTEST is not a live score, and this is where it belongs.
    const { bars: rows, dropped: duplicateBars } = dropConsecutiveDuplicates(rawRows as any[]);
    if (duplicateBars.length > 0) {
      // Reported, never silent: a replay that ran on a different series than the store holds is
      // itself a defect, and the operator has to be able to see that it happened.
      this.logger.warn(
        `Replay: dropped ${duplicateBars.length} bar(s) for ${symbol} (${timeframe}) that were ` +
        'byte-identical to the bar before them. These are stray duplicate writes, not sessions ' +
        '(#1049) — 166 of 205 measured are Friday, on a series with no Friday session. The replay ' +
        'runs on the deduplicated series; the stored rows are unchanged.',
      );
    }

    if (rows.length < 30) {
      // Try MT5 bridge fallback
      try {
        const mt5Bars = await this.fetchMT5Bars(symbol, timeframe, 200);
        if (mt5Bars.length > 0) {
          // Import into DB for future use
          const importData = mt5Bars.map((b) => ({
            symbolId: sym.id,
            provider: 'mt5',
            timeframe,
            timestamp: b.timestamp,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
          }));
          try {
            await this.prisma.marketBar.createMany({
              data: importData,
              skipDuplicates: true,
            });
          } catch { /* dupes ok */ }
          this.logger.log(
            `MT5 fallback: imported ${mt5Bars.length} bars for ${symbol}`,
          );
          // ⚠️ The fallback is a SECOND import path, and it bypasses `bar-refresh.service.ts`
          // entirely — so it needs the same treatment. Deduplicate before RETURNING (the replay must
          // not walk a series the store would not have produced), and note that `skipDuplicates` in
          // the `createMany` above only dedupes on the (symbol, timeframe, timestamp) KEY, which a
          // repeated OHLCV at a NEW timestamp does not collide with.
          const inWindow = mt5Bars.filter(
            (b) => b.timestamp >= from && b.timestamp <= to,
          );
          const deduped = dropConsecutiveDuplicates(inWindow as any[]);
          if (deduped.dropped.length > 0) {
            this.logger.warn(
              `MT5 fallback: dropped ${deduped.dropped.length} duplicate bar(s) for ${symbol} ` +
              `(${timeframe}) before the replay sees them (#1049).`,
            );
          }
          // ⚠️ #1128 — THE FALLBACK COULD MAKE THINGS WORSE, AND SILENTLY.
          //
          // `fetchMT5Bars` asks for the LATEST `limit` bars — it has no date parameters. So for a
          // HISTORICAL window (say last March) the 200 most recent bars contain NONE of the
          // requested dates, `inWindow` is empty, and this used to `return deduped.bars` — i.e.
          // return ZERO and throw away the stored rows it had already read. A window with 12
          // stored bars then reported "found 0 bars", blaming the store for a bar count it never
          // had. Only accept the fallback when it genuinely adds bars.
          if (preferFallbackBars(deduped.bars.length, rows.length)) {
            return deduped.bars as any;
          }
          this.logger.warn(
            `MT5 fallback produced ${deduped.bars.length} bar(s) inside the window for ${symbol} ` +
              `${timeframe}, which is no better than the ${rows.length} already stored — keeping ` +
              'the stored series. The bridge returns its LATEST bars, so a historical window ' +
              'cannot be filled this way.',
          );
        }
      } catch (err) {
        this.logger.warn(
          `MT5 fallback failed: ${(err as Error).message}`,
        );
      }
    }

    return rows.map((r) => ({
      timestamp: r.timestamp,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));
  }

  /** Fetch bars from MT5 bridge */
  private async fetchMT5Bars(
    symbol: string,
    timeframe: string,
    limit: number,
  ): Promise<ReplayBar[]> {
    try {
      const res = await fetch(
        `${resolveMt5BridgeUrl()}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`,
      );
      const data = await res.json();
      return (data.bars || []).map((b: any) => ({
        timestamp: new Date(b.timestamp || b.time),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume || 0,
      }));
    } catch {
      return [];
    }
  }

  /**
   * #986 — resolve a stored period to the window this replay walks, or `null` for a hand-assembled
   * config.
   *
   * ⚠️ THROWS rather than defaulting. A replay that silently walked a different window from the
   * backtest it is meant to explain is the most misleading output this module can produce: every
   * number would be plausible and the dates would be wrong.
   */
  private async resolvePeriod(periodId?: string) {
    if (!periodId) return null;
    if (!this.periods) {
      throw new BadRequestException(
        'A period-scoped replay was requested but the period service is not wired, so the window ' +
          'cannot be resolved. Refusing to walk an unspecified range.',
      );
    }
    return this.periods.resolveForRun(periodId);
  }

  /** Run replay — step through bars and score each one */
  async runReplay(config: ReplayConfig): Promise<ReplayResult> {
    // ── #986 — a stored PERIOD names the market and the window ───────────────────────────────
    // ⚠️ Resolved BEFORE the destructure, and it THROWS when the id does not resolve. A fallback
    // would replay different dates than the backtest it is meant to explain, and the output would
    // look exactly as convincing.
    const period = await this.resolvePeriod(config.periodId);

    const {
      symbol: configSymbol,
      timeframe: configTimeframe,
      from: configFrom,
      to: configTo,
      protocolIds,
      windowSize = 30,
    } = config;

    const symbol = period?.symbol ?? configSymbol;
    const timeframe = period?.timeframe ?? configTimeframe;
    const from = period?.from.toISOString() ?? configFrom;
    const to = period?.to.toISOString() ?? configTo;
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (!symbol || !timeframe || !from || !to) {
      throw new BadRequestException(
        'Replay needs either a periodId, or symbol + timeframe + from + to. ' +
          'A partially-filled config would walk an unintended window.',
      );
    }
    if (!protocolIds?.length) {
      // ⚠️ Was `throw new Error(...)` — a CLIENT-side validation failure reported as a server
      // fault (HTTP 500, `TCS-SYS-006`). Measured 2026-10-16: the replay UI's "Load Replay"
      // button did not disable itself with no protocol selected, so the first click a user made
      // was answered with an internal-error code that named nothing actionable. The two guards
      // around this one already used BadRequestException; this was the odd one out.
      throw new BadRequestException(
        'Replay requires at least one protocolId for canonical META.Stack scoring — ' +
          'a replay IS the scorer, so there is nothing to replay without a recipe.',
      );
    }

    // Load bars
    const bars = await this.loadBars(symbol, timeframe, fromDate, toDate);

    // ⚠️ #986 — AN EMPTY WINDOW IS A FINDING, NOT A RESULT.
    // This used to log a warning and return a summary of ZEROES, which is the "plausible numbers,
    // no error" shape: `avgComposite: 0, buySignals: 0` reads as "the market did nothing", and the
    // truth — "we never read any bars" — was nowhere in the payload. An unreadable input must make
    // the caller's job fail, not hand it a confident zero.
    if (bars.length < windowSize) {
      const where = period
        ? `period '${period.name}' (${from} → ${to})`
        : `${symbol} ${timeframe} (${from} → ${to})`;
      throw new BadRequestException(
        `Replay found ${bars.length} bar(s) for ${where}, and needs ${windowSize}+ to score one ` +
          'window. Refusing to return a zero-filled summary: that would report "the market did ' +
          'nothing" when the real finding is that there are no bars to read. ' +
          (period
            ? `Import them first: POST /api/backtest/periods/${period.id}/import`
            : 'Check the symbol, timeframe and date range.'),
      );
    }

    // ── THE REPLAY BUDGET, guard 1 of 2 (see REPLAY_OP_FAST_REFUSE) ─────────────────────────────
    // A heuristic, kept only so the obviously impossible is refused in milliseconds rather than
    // after 20s of work. It cannot bound the cost on its own — see the docblock.
    const stepCount = bars.length - windowSize + 1;
    const scoreOps = stepCount * protocolIds.length;
    if (scoreOps > REPLAY_OP_FAST_REFUSE) {
      throw new BadRequestException(
        `Replay would score ${stepCount} bar(s) × ${protocolIds.length} protocol(s) = ` +
          `${scoreOps.toLocaleString()} scoring operations. Cost per bar varies ~5x by protocol ` +
          '(11.5–59.7 ms measured), so this cannot finish inside the API client\'s 28s timeout. ' +
          'Narrow the date range, choose a higher timeframe, or select fewer protocols.',
      );
    }

    const steps: ReplayStep[] = [];
    // ── guard 2 of 2: the wall-clock deadline ──
    const replayStartedAt = Date.now();    let totalComposite = 0;
    let maxComposite = -Infinity;
    let minComposite = Infinity;
    let buyCount = 0;
    let sellCount = 0;
    let holdCount = 0;
    let noDataCount = 0;
    let totalDirectivesRun = 0;

    // #739 — resolve protocol (thesis) + bot (execution policy) display names
    // up-front so each decision card can show them distinctly (mirrors the
    // signal-envelope botName resolution).
    const nameBySlug = new Map<string, string>();
    try {
      const protocols = await this.prisma.protocol.findMany({
        where: { slug: { in: protocolIds } },
        select: { slug: true, name: true },
      });
      for (const p of protocols) nameBySlug.set(p.slug, p.name);
    } catch { /* best-effort */ }
    const botByKey = new Map<string, string>();
    try {
      const bots = await this.prisma.tradingStrategy.findMany({
        where: { active: true },
        select: { name: true, protocolId: true, symbol: true },
      });
      for (const b of bots) {
        if (b.protocolId) botByKey.set(`${b.protocolId}|${b.symbol.toUpperCase()}`, b.name);
      }
    } catch { /* best-effort */ }

    // Step through bars using the canonical protocol evaluator (2026-09-08).
    //
    // Higher-timeframe bundle (#735 / MST-004): resolved ONCE for the run, not per bar —
    // a replay is a fixed historical slice, so the 1d/1h/15m series a given protocol sees
    // does not change as `i` advances. Omitting it made every MTF directive score from base
    // bars only, so a replay reported decisions the live loop would never make.
    const replaySym = await this.prisma.symbol.findFirst({
      where: { ticker: symbol.toUpperCase() },
      select: { id: true },
    });
    const tfBundles = new Map<string, { dayBars: MarketBar[]; hourBars: MarketBar[]; min15Bars: MarketBar[] }>();
    if (replaySym) {
      for (const protocolId of protocolIds) {
        try {
          tfBundles.set(protocolId, await this.protocolGating.loadHigherTfBundle(replaySym.id, protocolId));
        } catch {
          // A protocol with no resolvable bars simply replays from base bars; do not
          // fabricate a bundle, and do not abort the whole replay for one protocol.
          tfBundles.set(protocolId, { dayBars: [], hourBars: [], min15Bars: [] });
        }
      }
    }

    for (let i = windowSize - 1; i < bars.length; i++) {
      // ── THE DEADLINE — the guard that actually holds ──────────────────────────────────────────
      // Measured against the WORK, not a prediction of it, so it cannot under-estimate. Throwing
      // is deliberate: returning the steps computed so far would hand back a summary describing a
      // WINDOW THAT WAS NEVER REPLAYED — the "plausible numbers, no error" defect this repo keeps
      // re-finding.
      if (Date.now() - replayStartedAt > REPLAY_DEADLINE_MS) {
        throw new BadRequestException(
          `Replay exceeded its ${Math.round(REPLAY_DEADLINE_MS / 1000)}s budget after ` +
            `${i - windowSize + 1} of ${stepCount} bar(s) (${symbol} ${timeframe}, ${from} → ${to}). ` +
            'Cost per bar varies about 5x between protocols (11.5–59.7 ms measured), so a window ' +
            'that is comfortable for one protocol can be far too slow for another. Narrow the date ' +
            'range, choose a higher timeframe, or select fewer protocols.',
        );
      }

      const currentBar = bars[i];
      const windowBars = bars.slice(Math.max(0, i - windowSize + 1), i + 1);
      const gatedResults = await Promise.all(
        protocolIds.map(protocolId =>
          this.protocolGating.scoreWithGating(
            symbol,
            windowBars,
            protocolId,
            tfBundles.get(protocolId) ?? { dayBars: [], hourBars: [], min15Bars: [] },
          ),
        ),
      );
      let selectedIdx = 0;
      for (let j = 1; j < gatedResults.length; j++) {
        if (gatedResults[j].signalPct > gatedResults[selectedIdx].signalPct) selectedIdx = j;
      }
      const selected = gatedResults[selectedIdx];
      const selectedProtocolId = protocolIds[selectedIdx];
      const normalizedScore = selected.signalPct;
      const signal = selected.signal;
      const breakdown = Object.values(selected.breakouts).flat().map(d => ({
        name: d.name,
        score: d.score,
        maxScore: d.maxScore,
        signalClass: d.signalClass,
        reason: d.reason,
      }));
      const activeCount = breakdown.filter(d => d.score > 0).length;

      if (signal === 'BUY' || signal === 'STRONG_BUY') buyCount++;
      else if (signal === 'SELL' || signal === 'STRONG_SELL') sellCount++;
      else if (signal === 'NO_DATA') noDataCount++;
      else holdCount++;

      totalComposite += normalizedScore;
      maxComposite = Math.max(maxComposite, normalizedScore);
      minComposite = Math.min(minComposite, normalizedScore);
      totalDirectivesRun += selected.meta.directiveCount;

      const protocolResults: ReplayStep['protocolResults'] = gatedResults.map((result, index) => ({
        protocolId: protocolIds[index],
        composite: result.signalPct,
        signal: result.signal,
        passed: result.signal !== 'HOLD' && !result.riskGate?.hardGateTriggered,
        checks: {
          // ⚠️ `required` must come from SIGNAL_THRESHOLDS, not a literal.
          //
          // This read `required: 40` — the PRE-RESCALE entry threshold. The 2026-09-15
          // rescale divided every percentage by ~6.3x (ADR-011 changed the denominator
          // from the observed directional sum to the configured directional capacity),
          // so `signalPct` now runs 6-33 instead of 40-80. A hardcoded 40 therefore
          // reports a FAILED check (required 40, actual 12) on ticks that actually
          // PASSED — `passed` is derived from `signal !== 'HOLD'`, which is already
          // rescaled, so the two fields disagreed on every replay.
          //
          // Importing the shared constant means the next rescale updates both together;
          // a second copy of a threshold is guaranteed to drift and only one gets fixed.
          scoreOk: { passed: result.signal !== 'HOLD', required: SIGNAL_THRESHOLDS.entry, actual: result.signalPct },
          directionOk: { passed: result.meta.directionalEvidence.selected !== 'none' },
          riskOk: { passed: !result.riskGate?.hardGateTriggered },
        },
      }));

      steps.push({
        timestamp: currentBar.timestamp,
        bar: currentBar,
        composite: selected.composite,
        signal,
        normalizedScore,
        signalRaw: selected.signalRaw,
        signalMax: selected.signalMax,
        opportunityPct: selected.opportunityPct,
        directionEligibleDirectives: selected.meta.directionEligibleDirectives,
        protocolId: selectedProtocolId ?? null,
        protocolName: nameBySlug.get(selectedProtocolId) ?? selectedProtocolId ?? null,
        botName: botByKey.get(`${selectedProtocolId}|${symbol.toUpperCase()}`) ?? null,
        activeDirectives: activeCount,
        totalDirectives: selected.meta.directiveCount,
        directiveBreakdown: breakdown.slice(0, 10),
        protocolResults,
      });
    }

    // Relative percentiles may be reported as analytics, but must not replace
    // canonical protocol actions. The former z-score reclassification was a
    // second signal trigger and was removed on 2026-09-08.

    // ── Forward-return analysis ─────────────────────────
    // Compute what happened AFTER each signal
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepBarIdx = bars.findIndex(b => b.timestamp.getTime() === step.timestamp.getTime());
      if (stepBarIdx < 0) continue;

      const computeReturn = (ahead: number): number | undefined => {
        const futureIdx = stepBarIdx + ahead;
        if (futureIdx >= bars.length) return undefined;
        if (step.bar.close <= 0) return undefined;
        return ((bars[futureIdx].close - step.bar.close) / step.bar.close) * 100;
      };

      step.forwardReturn1 = computeReturn(1);
      step.forwardReturn3 = computeReturn(3);
      step.forwardReturn5 = computeReturn(5);
      step.forwardReturn10 = computeReturn(10);

      // Signal accuracy: BUY correct if price went up, SELL correct if price went down
      const fwd1 = step.forwardReturn1;
      if (fwd1 !== undefined) {
        if (step.signal === 'BUY' || step.signal === 'STRONG_BUY') step.signalCorrect = fwd1 > 0;
        else if (step.signal === 'SELL' || step.signal === 'STRONG_SELL') step.signalCorrect = fwd1 < 0;
      }
    }

    // ── Outcome aggregation ─────────────────────────────
    const buySteps = steps.filter(s => (s.signal === 'BUY' || s.signal === 'STRONG_BUY') && s.forwardReturn1 !== undefined);
    const sellSteps = steps.filter(s => (s.signal === 'SELL' || s.signal === 'STRONG_SELL') && s.forwardReturn1 !== undefined);
    const actionableSteps = [...buySteps, ...sellSteps];

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a,b) => a+b, 0) / arr.length : 0;

    const outcomes = {
      buyAccuracy: buySteps.length > 0 ? Math.round(buySteps.filter(s => s.signalCorrect).length / buySteps.length * 100) : 0,
      sellAccuracy: sellSteps.length > 0 ? Math.round(sellSteps.filter(s => s.signalCorrect).length / sellSteps.length * 100) : 0,
      avgBuyReturn1: Math.round(avg(buySteps.map(s => s.forwardReturn1!)) * 100) / 100,
      avgSellReturn1: Math.round(avg(sellSteps.map(s => s.forwardReturn1!)) * 100) / 100,
      avgBuyReturn5: Math.round(avg(buySteps.filter(s => s.forwardReturn5 !== undefined).map(s => s.forwardReturn5!)) * 100) / 100,
      avgSellReturn5: Math.round(avg(sellSteps.filter(s => s.forwardReturn5 !== undefined).map(s => s.forwardReturn5!)) * 100) / 100,
      bestBuyReturn: buySteps.length > 0 ? Math.round(Math.max(...buySteps.map(s => s.forwardReturn1!)) * 100) / 100 : 0,
      worstBuyReturn: buySteps.length > 0 ? Math.round(Math.min(...buySteps.map(s => s.forwardReturn1!)) * 100) / 100 : 0,
      signalCount: actionableSteps.length,
      // Missed opps: BUY signals where price rose >0.5% OR SELL signals where price fell >0.5% but system scored low
      missedOpportunities: steps
        .filter(s => s.normalizedScore < 15 && s.forwardReturn1 !== undefined)
        .filter(s => (s.signal !== 'BUY' && s.forwardReturn1! > 0.5) || (s.signal !== 'SELL' && s.forwardReturn1! < -0.5))
        .length,
      // False positives: wrong-direction signals with significant adverse moves
      falsePositives: steps
        .filter(s => s.signalCorrect === false && s.forwardReturn1 !== undefined)
        .filter(s => Math.abs(s.forwardReturn1!) > 0.5)
        .length,
      // Edge ratio: what % of signals with extreme scores were correct vs middle scores
      lowScoreAccuracy: (() => {
        const low = steps.filter(s => s.normalizedScore < 15 && s.signalCorrect !== undefined);
        return low.length > 0 ? Math.round(low.filter(s => s.signalCorrect).length / low.length * 100) : 0;
      })(),
      midScoreAccuracy: (() => {
        const mid = steps.filter(s => s.normalizedScore >= 15 && s.normalizedScore <= 25 && s.signalCorrect !== undefined);
        return mid.length > 0 ? Math.round(mid.filter(s => s.signalCorrect).length / mid.length * 100) : 0;
      })(),
    };

    const validSteps = steps.filter((s) => s.normalizedScore > 0);
    const avgComposite =
      steps.length > 0
        ? Math.round(totalComposite / steps.length)
        : 0;

    return {
      symbol,
      timeframe,
      from,
      to,
      totalBars: bars.length,
      // #986 — which stored window this replayed, so the output says why the dates mattered.
      period: period ? { id: period.id, name: period.name, note: period.note } : undefined,
      thresholds: {
        entry: SIGNAL_THRESHOLDS.entry,
        strong: SIGNAL_THRESHOLDS.strong,
        scale: SIGNAL_THRESHOLDS.scale,
      },
      steps,
      summary: {
        avgComposite,
        maxComposite: maxComposite === -Infinity ? 0 : maxComposite,
        minComposite: minComposite === Infinity ? 0 : minComposite,
        buySignals: buyCount,
        sellSignals: sellCount,
        holdSignals: holdCount,
        noDataSignals: noDataCount,
        totalDirectivesRun,
        directivesPerBar:
          steps.length > 0
            ? Math.round(totalDirectivesRun / steps.length)
            : 0,
      },
      outcomes,
    };
  }

  /** List symbols with bar data available for replay */
  async getDataInventory() {
    const rows = await this.prisma.marketBar.groupBy({
      by: ['symbolId'],
      _count: { id: true },
      _min: { timestamp: true },
      _max: { timestamp: true },
    });

    const inventory = [];
    for (const row of rows) {
      const sym = await this.prisma.symbol.findUnique({
        where: { id: row.symbolId },
      });
      if (sym) {
        inventory.push({
          symbol: sym.ticker,
          barCount: row._count.id,
          earliestBar: row._min.timestamp,
          latestBar: row._max.timestamp,
        });
      }
    }
    return inventory.sort((a, b) => b.barCount - a.barCount);
  }
}
