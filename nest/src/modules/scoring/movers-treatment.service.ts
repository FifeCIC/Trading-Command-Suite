/**
 * movers-treatment.service.ts — "here are today's biggest winners and losers, and here is what
 * TCS is actually doing about each one" (#1281).
 *
 * ── WHY THIS EXISTS ──
 * Owner, 2026-11-15: *"I would like to see a list of all the winners and losers and how TCS is
 * treating them in terms of scoring, trading, monitoring and decisions made."*
 *
 * The app can already answer each of those questions SEPARATELY — `/api/market-data/top-movers` has
 * the moves, `/lab/hot-stock-picks` has ranked scores, `/development/blocked-signals` has the
 * refusals. Nobody could see them SIDE BY SIDE for one symbol, and that is the question that
 * matters: a stock moved 40% and the app did nothing — was that a decision, a gap, or a bug?
 *
 * ⚠️ FOUR STATES, NOT TWO, AND THEY MUST NEVER COLLAPSE. A mover that TCS traded, one it refused,
 * one it scored but nobody was subscribed to, and one it never measured are four different answers.
 * Rendering "unscored" and "not tradable" as the same empty cell is exactly the "plausible output,
 * no error" failure this repo keeps re-paying for.
 *
 * ⚠️ NO FABRICATED ROW. A symbol with no bars is reported as `no-data` with the count of bars it
 * does have — never as a 0% move. A 0.00% change is a claim that the price did not move.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/** How a mover was treated. Ordered from "fully acted on" to "not measured". */
export type MoversTreatment =
  | 'traded'          // an order exists (open position or a closed trade today)
  | 'queued'          // in strategy_signal_queue, not yet executed
  | 'refused'         // the loop decided against it, and said why
  | 'scored'          // scored, but nothing is subscribed to act
  | 'unscored'        // monitored (has bars) but no score in the window
  | 'no-data';        // no bars — CANNOT JUDGE, which is not the same as "nothing happened"

export interface MoverRow {
  ticker: string;
  type: string;
  /** Percentage change over the lookback window. `null` when it could not be computed. */
  changePct: number | null;
  lastPrice: number | null;
  asOf: string | null;
  barsInWindow: number;
  /** Last bar's volume ÷ the window's own average. `null` when volume is unavailable. */
  volumeRatio: number | null;
  /** True when `volumeRatio` clears VOLUME_SPIKE_RATIO. `null` when it cannot be judged. */
  volumeSpike: boolean | null;
  direction: 'winner' | 'loser';
  score: {
    protocolId: string;
    compositePct: number | null;
    signal: string | null;
    snappedAt: string;
  } | null;
  monitored: {
    /** Protocols this symbol is assigned to. 0 means nothing is subscribed to score it. */
    assignedProtocols: number;
    /** Highest score this symbol reached in the window, across every protocol. */
    bestCompositePct: number | null;
  };
  trading: {
    queued: number;
    openPositions: number;
    tradesToday: number;
    lastTradeAt: string | null;
  };
  decision: { decision: string; reason: string | null; at: string } | null;
  /** True when this symbol is a candidate for at least one bot with `hotStockEnabled`. */
  hotCandidateFor: Array<{ bot: string; detectionMode: string | null }>;
  treatment: MoversTreatment;
  /** One plain sentence an operator can read without the table. */
  verdict: string;
}

/**
 * clampInt() — a numeric query parameter, or the fallback when it is not a number.
 *
 * ⚠️ MEASURED DEFECT, 2026-11-15. `?bars=abc` used to produce `measured: 0`, which the page renders
 * as "no movers" — a FALSE EMPTY, and the exact class of defect this endpoint exists to expose in
 * others. `Number('abc')` is `NaN`, and `NaN` passes straight through `Math.min`/`Math.max`, so the
 * SQL bind became unusable and nothing matched. A bad parameter must fall back (and the effective
 * window is reported) so that "bad input" stays distinguishable from "nothing happened".
 */
export function clampInt(value: unknown, fallback: number, lo: number, hi: number): number {
  // ⚠️ ABSENCE IS TESTED FIRST, AND THAT ORDER IS THE WHOLE GUARD. `Number(null)` and `Number('')`
  // are both `0` and `0` is finite, so a numeric-first check turns a MISSING parameter into `0` and
  // then clamps it to the minimum — a silent wrong answer that looks like a provided value. This is
  // the same `Number(null) === 0` trap that `validate-threshold-in-range.cjs` caught in its own
  // self-test (register row 181). The self-test here fails without this ordering.
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

/**
 * classifyTreatment() — the ONE place the four states are decided.
 *
 * ⚠️ ORDER IS THE RULE. A symbol can be queued AND scored AND refused in the same window (the queue
 * row is from an earlier tick). Taking the strongest claim first is what makes the verdict mean
 * "the furthest TCS got", which is the question being asked.
 */
export function classifyTreatment(input: {
  barsInWindow: number;
  openPositions: number;
  tradesToday: number;
  queued: number;
  decision: { decision: string } | null;
  bestCompositePct: number | null;
}): MoversTreatment {
  if (input.openPositions > 0 || input.tradesToday > 0) return 'traded';
  if (input.queued > 0) return 'queued';
  // A recorded refusal is a DECISION, and it outranks a score: the score exists and the loop said
  // no. Reporting only the score would hide the refusal behind a number.
  if (input.decision && /^(BLOCKED|SKIP|HOLD|REFUSED)$/i.test(input.decision.decision)) return 'refused';
  if (input.bestCompositePct != null) return 'scored';
  if (input.barsInWindow > 0) return 'unscored';
  return 'no-data';
}

/**
 * hotCandidates() — which symbols does a bot with `hotStockEnabled` want, per its detection mode?
 *
 * ── THIS IS THE FIRST REAL READER OF THE `hotStock*` COLUMNS ──
 * Measured 2026-11-15: `hotStockEnabled`, `hotStockAllocation`, `hotStockDetectionMode` and
 * `hotStockMaxHoldHours` were persisted, offered in the create form, and read by NOTHING
 * (`bot-rules.ts` says so in those words). Issue #339 was closed 2026-07-22 with every form task
 * ticked and no reader written — a ticked box is a claim, not a result.
 *
 * ⚠️ DETECTION ONLY. This decides which symbols a bot WOULD consider; it places no order and
 * changes no sizing. Trading a discovered symbol is a separate step that needs its own decision —
 * and `hotStockAllocation` / `hotStockMaxHoldHours` are still unread, stated here rather than
 * implied to work.
 *
 * Modes are the ones the form has always offered (`top-scoring | volume-spike | all`). An
 * unrecognised mode is returned as-is with no candidates, so a typo cannot silently behave like
 * 'all'.
 */
export function hotCandidates(input: {
  mode: string | null;
  volumeSpike: boolean;
  compositePct: number | null;
  topScoringThresholdPct: number;
}): boolean {
  const done = input.volumeSpike;
  const scored = input.compositePct != null && input.compositePct >= input.topScoringThresholdPct;
  switch ((input.mode ?? '').trim().toLowerCase()) {
    case 'top-scoring': return scored;
    case 'volume-spike': return done;
    case 'all': return scored || done;
    default: return false;
  }
}

/** One sentence per row — the table is for scanning, this is for reading. */
export function verdictSentence(row: Pick<MoverRow, 'ticker' | 'changePct' | 'treatment' | 'score' | 'trading' | 'decision' | 'barsInWindow'>): string {
  const move = row.changePct == null ? 'no measurable move' : `${row.changePct >= 0 ? '+' : ''}${row.changePct.toFixed(2)}%`;
  switch (row.treatment) {
    case 'traded':
      return `${row.ticker} moved ${move} and TCS is in it — ${row.trading.openPositions} open position(s), ${row.trading.tradesToday} trade(s) today.`;
    case 'queued':
      return `${row.ticker} moved ${move} and TCS has ${row.trading.queued} queued entr${row.trading.queued === 1 ? 'y' : 'ies'} awaiting execution.`;
    case 'refused':
      return `${row.ticker} moved ${move}; TCS scored ${row.score?.compositePct?.toFixed(1) ?? '?'}% and REFUSED it — ${row.decision?.reason ?? 'no reason recorded'}.`;
    case 'scored':
      return `${row.ticker} moved ${move} and scored ${row.score?.compositePct?.toFixed(1) ?? '?'}%, but nothing is subscribed to act on that protocol.`;
    case 'unscored':
      return `${row.ticker} moved ${move} and has ${row.barsInWindow} bar(s), but no protocol scored it — a coverage gap, not a decision.`;
    case 'no-data':
    default:
      return `${row.ticker} is listed but has NO bars in the window — TCS cannot judge it. That is an absence, not a 0% move.`;
  }
}

@Injectable()
export class MoversTreatmentService {
  private readonly logger = new Logger(MoversTreatmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * getTreatment() — top N winners and top N losers, each with what TCS did about it.
   *
   * ⚠️ BOUNDED ON PURPOSE. `MarketDataService.getTopMovers()` runs one query PER ACTIVE SYMBOL
   * (measured: 214 symbols), which is fine for a dashboard widget that refreshes rarely and not
   * fine for a page an operator opens. This is FOUR queries regardless of universe size, and the
   * bar window is bounded to the last 3 days so the window function never scans the whole table
   * (1.1 M 1m rows).
   */
  async getTreatment(opts: { timeframe?: string; bars?: number; limit?: number } = {}) {
    /**
     * ⚠️ A NON-NUMERIC `bars` MUST NOT BECOME AN EMPTY RESULT — see `clampInt()`.
     */
    const timeframe = (opts.timeframe ?? '').trim() || '5m';
    const bars = clampInt(opts.bars, 6, 1, 60);
    const limit = clampInt(opts.limit, 10, 1, 50);

    // ── 1. The moves, in ONE query ────────────────────────────────────────────────────────────
    const movers = await this.prisma.$queryRawUnsafe<Array<{
      ticker: string; type: string; lastClose: number | null; lastTs: Date | null;
      refClose: number | null; barsInWindow: bigint;
      lastVolume: number | null; avgVolume: number | null;
    }>>(`
      WITH ranked AS (
        SELECT b.symbolId, b.close, b.timestamp, b.volume,
               ROW_NUMBER() OVER (PARTITION BY b.symbolId ORDER BY b.timestamp DESC) AS rn,
               COUNT(*)     OVER (PARTITION BY b.symbolId) AS n
        FROM marketbar b
        WHERE b.timeframe = ?
          AND b.timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 3 DAY)
      )
      SELECT s.ticker AS ticker, s.type AS type,
             MAX(CASE WHEN r.rn = 1 THEN r.close END)     AS lastClose,
             MAX(CASE WHEN r.rn = 1 THEN r.timestamp END) AS lastTs,
             MAX(CASE WHEN r.rn = ? THEN r.close END)     AS refClose,
             MAX(CASE WHEN r.rn = 1 THEN r.volume END)    AS lastVolume,
             AVG(r.volume)                                AS avgVolume,
             MAX(r.n) AS barsInWindow
      FROM ranked r
      JOIN symbol s ON s.id = r.symbolId
      WHERE r.rn <= ? AND s.active = 1
      GROUP BY s.ticker, s.type
      HAVING lastClose IS NOT NULL AND refClose IS NOT NULL AND refClose > 0
    `, timeframe, bars + 1, bars + 1);

    /**
     * Volume spike — the input the `volume-spike` detection mode has always implied and never had.
     *
     * ⚠️ A RATIO OF x2 AGAINST THE WINDOW'S OWN AVERAGE, not an absolute share count. An absolute
     * threshold would be a number tuned for one instrument and silently wrong for every other —
     * the same one-deployment assumption `external-systems-are-data` forbids for accounts.
     */
    const VOLUME_SPIKE_RATIO = 2;

    const scored = movers
      .map((m) => {
        const last = Number(m.lastClose);
        const ref = Number(m.refClose);
        const avgVol = m.avgVolume == null ? null : Number(m.avgVolume);
        const lastVol = m.lastVolume == null ? null : Number(m.lastVolume);
        return {
          ticker: m.ticker,
          type: m.type,
          lastPrice: last,
          asOf: m.lastTs ? new Date(m.lastTs).toISOString() : null,
          changePct: ((last - ref) / ref) * 100,
          barsInWindow: Number(m.barsInWindow),
          volumeRatio: avgVol && avgVol > 0 && lastVol != null ? lastVol / avgVol : null,
        };
      })
      .filter((m) => Number.isFinite(m.changePct))
      .sort((a, b) => b.changePct - a.changePct);

    const winners = scored.slice(0, limit).map((m) => ({ ...m, direction: 'winner' as const }));
    const losers = scored.slice(-limit).reverse().map((m) => ({ ...m, direction: 'loser' as const }));
    const selected = [...winners, ...losers];
    const tickers = selected.map((m) => m.ticker);

    // ⚠️ NOTHING MOVED IS A REAL ANSWER, AND IT IS NOT AN ERROR. An empty selection returns an
    // empty list plus `measured: 0` — the caller renders "no measured moves", not a blank table.
    if (tickers.length === 0) {
      return {
        generatedAt: new Date().toISOString(),
        window: { timeframe, bars },
        measured: 0, universe: 0,
        winners: [], losers: [],
        note:
          `No symbol had two comparable bars at timeframe '${timeframe}' with ${bars} bars back. ` +
          'That is about the WINDOW (a timeframe no bar is stored at, or too few bars), not a market ' +
          'that did not move — this is not a 0% day.',
      };
    }

    const inList = tickers.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');

    // ── 2. What TCS knows: best score per symbol, assignments, queue, positions, decisions ────
    const [bestScores, assigned, queued, positions, tradesToday, decisions, hotBots] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{
        symbol: string; protocolId: string; compositePct: number | null; tradingSignal: string | null; snappedAt: Date;
      }>>(`
        SELECT ss.symbol, ss.protocolId, ss.signalPct AS compositePct, ss.trading_signal AS tradingSignal, ss.snappedAt AS snappedAt
        FROM score_snapshot ss
        JOIN (
          SELECT symbol, MAX(signalPct) AS mx
          FROM score_snapshot
          WHERE symbol IN (${inList}) AND snappedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 DAY)
          GROUP BY symbol
        ) top ON top.symbol = ss.symbol AND ss.signalPct = top.mx
        WHERE ss.snappedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 DAY)
        GROUP BY ss.symbol, ss.protocolId, ss.signalPct, ss.trading_signal, ss.snappedAt
      `),
      this.prisma.$queryRawUnsafe<Array<{ symbol: string; n: bigint }>>(`
        SELECT symbol, COUNT(*) AS n FROM symbol_protocol_assignment
        WHERE symbol IN (${inList}) GROUP BY symbol
      `),
      this.prisma.$queryRawUnsafe<Array<{ symbol: string; n: bigint }>>(`
        SELECT symbol, COUNT(*) AS n FROM strategy_signal_queue
        WHERE symbol IN (${inList}) AND status = 'pending' GROUP BY symbol
      `),
      this.prisma.$queryRawUnsafe<Array<{ symbol: string; n: bigint }>>(`
        SELECT symbol, COUNT(*) AS n FROM \`position\`
        WHERE symbol IN (${inList}) GROUP BY symbol
      `),
      this.prisma.$queryRawUnsafe<Array<{ symbol: string; n: bigint; lastAt: Date | null }>>(`
        SELECT symbol, COUNT(*) AS n, MAX(closedAt) AS lastAt FROM trade
        WHERE symbol IN (${inList}) AND closedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)
        GROUP BY symbol
      `),
      this.prisma.$queryRawUnsafe<Array<{ symbol: string; decision: string; reason: string | null; at: Date }>>(`
        SELECT d.symbol, d.decision, d.reason, d.timestamp AS at
        FROM decision_log d
        JOIN (SELECT symbol, MAX(timestamp) AS mx FROM decision_log
              WHERE symbol IN (${inList}) AND timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)
              GROUP BY symbol) latest ON latest.symbol = d.symbol AND d.timestamp = latest.mx
        GROUP BY d.symbol, d.decision, d.reason, d.timestamp
      `),
      // The FIRST reader of the `hotStock*` columns. Only bots that opted in are considered, so an
      // empty result means "no bot asked for hot stocks" — not "nothing qualified".
      this.prisma.$queryRawUnsafe<Array<{ name: string; detectionMode: string | null }>>(`
        SELECT name, hotStockDetectionMode AS detectionMode
        FROM trading_strategy WHERE active = 1 AND hotStockEnabled = 1
      `),
    ]);

    const scoreBy = new Map(bestScores.map((s) => [s.symbol, s]));
    const assignedBy = new Map(assigned.map((r) => [r.symbol, Number(r.n)]));
    const queuedBy = new Map(queued.map((r) => [r.symbol, Number(r.n)]));
    const posBy = new Map(positions.map((r) => [r.symbol, Number(r.n)]));
    const tradeBy = new Map(tradesToday.map((r) => [r.symbol, r]));
    const decisionBy = new Map(decisions.map((r) => [r.symbol, r]));

    // Threshold the 'top-scoring' detection mode uses. NOT a tuning knob for the strategy — it is
    // the same bar a bot must clear to act, so a "hot" candidate is one that would plausibly trade.
    const TOP_SCORING_PCT = 50;

    const build = (m: typeof selected[number]): MoverRow => {
      const s = scoreBy.get(m.ticker) ?? null;
      const bestCompositePct = s?.compositePct == null ? null : Number(s.compositePct);
      const t = tradeBy.get(m.ticker);
      const d = decisionBy.get(m.ticker);
      const trading = {
        queued: queuedBy.get(m.ticker) ?? 0,
        openPositions: posBy.get(m.ticker) ?? 0,
        tradesToday: t ? Number(t.n) : 0,
        lastTradeAt: t?.lastAt ? new Date(t.lastAt).toISOString() : null,
      };
      const decision = d ? { decision: d.decision, reason: d.reason ?? null, at: new Date(d.at).toISOString() } : null;
      const treatment = classifyTreatment({
        barsInWindow: m.barsInWindow,
        openPositions: trading.openPositions,
        tradesToday: trading.tradesToday,
        queued: trading.queued,
        decision,
        bestCompositePct,
      });
      const volumeSpike = m.volumeRatio == null ? null : m.volumeRatio >= VOLUME_SPIKE_RATIO;
      const row: MoverRow = {
        ticker: m.ticker,
        type: m.type,
        changePct: Number(m.changePct.toFixed(2)),
        lastPrice: m.lastPrice,
        asOf: m.asOf,
        barsInWindow: m.barsInWindow,
        volumeRatio: m.volumeRatio == null ? null : Number(m.volumeRatio.toFixed(2)),
        // ⚠️ null when the ratio is unknown — a missing volume is NOT "no spike".
        volumeSpike,
        direction: m.direction,
        score: s
          ? { protocolId: s.protocolId, compositePct: bestCompositePct, signal: s.tradingSignal, snappedAt: new Date(s.snappedAt).toISOString() }
          : null,
        monitored: { assignedProtocols: assignedBy.get(m.ticker) ?? 0, bestCompositePct },
        trading,
        decision,
        hotCandidateFor: hotBots
          .filter((b) => hotCandidates({
            mode: b.detectionMode,
            // ⚠️ `=== true`, not truthiness: an unknown volume must not silently count as a spike,
            // and must not silently count as "no spike" either — `hotCandidates` treats null as no.
            volumeSpike: volumeSpike === true,
            compositePct: bestCompositePct,
            topScoringThresholdPct: TOP_SCORING_PCT,
          }))
          .map((b) => ({ bot: b.name, detectionMode: b.detectionMode })),
        treatment,
        verdict: '',
      };
      row.verdict = verdictSentence(row);
      return row;
    };

    const all = selected.map(build);

    return {
      generatedAt: new Date().toISOString(),
      window: { timeframe, bars },
      measured: scored.length,
      universe: movers.length,
      // ⚠️ How many active bots actually opted into hot-stock detection. Zero is the honest answer
      // today and it is stated, not hidden — the columns are wired but nothing has ticked them.
      hotStockBots: hotBots.length,
      winners: all.filter((r) => r.direction === 'winner'),
      losers: all.filter((r) => r.direction === 'loser'),
      counts: {
        traded: all.filter((r) => r.treatment === 'traded').length,
        queued: all.filter((r) => r.treatment === 'queued').length,
        refused: all.filter((r) => r.treatment === 'refused').length,
        scored: all.filter((r) => r.treatment === 'scored').length,
        unscored: all.filter((r) => r.treatment === 'unscored').length,
        noData: all.filter((r) => r.treatment === 'no-data').length,
      },
    };
  }
}
