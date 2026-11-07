import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AbTestService } from './ab-test.service';
import {
  decideExperiment,
  isMarketOpenNow,
  decideObjectiveReview,
  ExperimentDecision,
  ExperimentFacts,
  ObjectiveReview,
} from '../../common/trading/experiment-decision';

/**
 * Fields that actually change what a bot DOES. A copied configuration that differs in none of these
 * trades identically, so its comparison cannot produce a difference no matter how long it runs —
 * which is `measurable: false`, i.e. NO-ARMS.
 *
 * ⚠️ Deliberately EXCLUDES name, description, slug, version, magic, timestamps and `active`: those
 * describe or enable the bot, they do not change its trades. Including them would make every pair
 * "measurable" and defeat the check.
 */
const TRADE_AFFECTING_FIELDS = [
  'symbol', 'timeframe', 'slPct', 'tpPct', 'takeProfitAmount', 'baseSize', 'sizingModel',
  'sizingRiskPct', 'useRaritySizing', 'maxSize', 'maxPositions', 'maxPyramidTiers', 'maxDailyLoss',
  'cooldownMinutes', 'sessionWindow', 'minComposite', 'minRarityBand', 'requireDirection', 'mode',
  'protocolId', 'shortProtocolId', 'scoringStrategyId', 'maxHoldHours', 'exitBeforeUtc',
  'exhaustionObserveEnabled', 'exhaustionDecelPct', 'simTslEnabled', 'simTslActivationPct',
  'simTslDistancePct', 'hotStockEnabled', 'allocationAmount',
] as const;

export function diffTradeFields(control: Record<string, any>, variant: Record<string, any>): string[] {
  const norm = (v: any) => (v === null || v === undefined ? null : String(v));
  return TRADE_AFFECTING_FIELDS.filter((f) => norm(control[f]) !== norm(variant[f]));
}

/**
 * ExperimentReviewService — gathers the FACTS, then asks the rule what to do.
 *
 * ── POSITION IN THE PIPELINE ────────────────────────────────────────────────────────────────
 * BEFORE: `ab-test.service.ts` computes a verdict for ONE test and refuses to name a winner below
 *         the sample bar. `trading_strategy.duplicatedFromId` links a copied configuration to its
 *         control (the maths-change rule's mechanism).
 * HERE:   enumerate every live comparison and ask `experiment-decision.ts` what its lifecycle state
 *         is — including the states nobody was reporting: cannot collect, never measured, stalled,
 *         out of time.
 * AFTER:  `GET /api/automation/experiments`, the CLI `scripts/report-experiments.cjs`, and the
 *         Strategies view panel (`src/pages/AbStrategiesPage.jsx`).
 *
 * ⚠️ WHY THIS IS A SEPARATE SERVICE AND NOT A METHOD ON AbTestService. `AbTestService` owns the
 * *statistics* of one test and is already 750 lines; the question here spans three tables and two
 * kinds of experiment. Mixing them would make the verdict rule impossible to test without a
 * database — which is why `experiment-decision.ts` is pure and this file only produces `Facts`.
 *
 * ⚠️ NOTHING HERE WRITES. It reports, so it is safe to call from a script, a page load, or an agent
 * at any time. Acting on the report is a deliberate, separate step.
 */
@Injectable()
export class ExperimentReviewService {
  private readonly log = new Logger(ExperimentReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly abTest: AbTestService,
  ) {}

  async listExperiments(): Promise<{
    experiments: ExperimentDecision[];
    objectives: ObjectiveReview[];
    summary: Record<string, number>;
    objectiveSummary: Record<string, number>;
    computedAt: string;
  }> {
    const now = new Date();
    const experiments: ExperimentDecision[] = [];

    for (const facts of await Promise.all([this.abTestFacts(now), this.botPairFacts(now)])) {
      for (const f of facts) experiments.push(decideExperiment(f));
    }

    // Most urgent first. The order is the same one the rule uses, so the page, the CLI and an agent
    // all read the list the same way.
    const priority: Record<string, number> = {
      DECIDE: 0, BLOCKED: 1, 'NO-ARMS': 2, UNMEASURED: 3, INCONCLUSIVE: 4, STALLED: 5, RUNNING: 6, ARCHIVED: 7,
    };
    experiments.sort((a, b) => (priority[a.action] ?? 9) - (priority[b.action] ?? 9));

    const objectives = await this.objectiveReviews(now);
    const objectivePriority: Record<string, number> = {
      OVERDUE: 0, 'NO-DATE': 1, 'DUE-SOON': 2, 'ON-TIME': 3, SETTLED: 4,
    };
    objectives.sort((a, b) => (objectivePriority[a.action] ?? 9) - (objectivePriority[b.action] ?? 9));

    const summary: Record<string, number> = {};
    for (const e of experiments) summary[e.action] = (summary[e.action] ?? 0) + 1;
    const objectiveSummary: Record<string, number> = {};
    for (const o of objectives) objectiveSummary[o.action] = (objectiveSummary[o.action] ?? 0) + 1;

    return { experiments, objectives, summary, objectiveSummary, computedAt: now.toISOString() };
  }

  /**
   * Active objectives, reviewed against their own date.
   *
   * ⚠️ Raw SQL rather than a Prisma model call: `trading_objective` is one of the tables this repo
   * has been bitten by before (a modelled table missing columns silently under-reports), and the
   * read here names its columns explicitly so a missing one FAILS instead of vanishing.
   */
  private async objectiveReviews(now: Date): Promise<ObjectiveReview[]> {
    let rows: any[] = [];
    try {
      rows = await (this.prisma as any).$queryRawUnsafe(
        `SELECT id, title, description, status, targetDate, progressPct, linkedStrategy
           FROM trading_objective WHERE status = 'active'`,
      );
    } catch (e: any) {
      // ⚠️ A failed read must not look like "no objectives". Report it as a NO-DATE row with the
      // reason, which is loud, rather than returning [] which reads as "all fine".
      this.log.warn(`objective review: cannot read trading_objective: ${e?.message}`);
      return [{
        id: 'read-failure',
        title: 'Objectives could not be read',
        action: 'NO-DATE',
        reason: `The objective table could not be read (${e?.message ?? 'unknown'}) — this is "cannot judge", not "none outstanding".`,
        nextStep: 'Fix the read before trusting any objective as on-track.',
        daysLeft: null,
        progressPct: null,
        hasPrediction: false,
      }];
    }

    return rows.map((r) => decideObjectiveReview({
      id: r.id,
      title: r.title,
      status: r.status,
      targetDate: r.targetDate ? new Date(r.targetDate) : null,
      now,
      progressPct: r.progressPct === null || r.progressPct === undefined ? null : Number(r.progressPct),
      linkedStrategy: r.linkedStrategy ?? null,
      description: r.description ?? null,
    }));
  }

  /** Every `ab_test` row, with the sample the verdict machinery already computed for it. */
  private async abTestFacts(now: Date): Promise<ExperimentFacts[]> {
    const tests = await (this.prisma as any).abTest.findMany({ orderBy: { createdAt: 'desc' } });
    const out: ExperimentFacts[] = [];

    for (const t of tests) {
      // ⚠️ Per-test try/catch: one unreadable test must not blank the whole list. A failed read is
      // reported as UNMEASURED (via `n: null`), never as an empty experiment — "cannot judge" and
      // "no trades" must not render the same.
      let results: any = null;
      let authority: any = null;
      try {
        const r = await this.abTest.getResults(t.id);
        results = r?.results ?? null;
        authority = r?.tradeAuthority ?? null;
      } catch (e: any) {
        this.log.warn(`experiment review: could not read results for ${t.id}: ${e?.message}`);
      }

      const verdict = results?.verdict ?? null;
      const arms = results?.arms ?? null;
      const closed = await this.lastClosedForAbTest(t.id);

      // ⚠️ `mode: null` from resolveTradeAuthority means CANNOT JUDGE, and 'manual' means no orders
      // are dispatched automatically. Neither can grow an A/B sample, so both are `canCollect:false`
      // — with the producer's own words in `blockedReason` rather than a generic message.
      const mode = authority?.mode ?? null;
      const canCollect = mode === 'auto';
      const blockedReason = canCollect
        ? null
        : authority?.reason || (mode ? `the tested stack trades in '${mode}' mode, not 'auto'` : 'no active bot on the tested stack');

      out.push({
        kind: 'ab-test',
        id: t.id,
        title: t.name,
        status: String(t.status ?? 'draft'),
        startedAt: t.startAt ? new Date(t.startAt) : null,
        reviewBy: t.endAt ? new Date(t.endAt) : null,
        now,
        sides: [
          { label: 'control', n: verdict?.n?.control ?? results?.control?.closedTrades ?? null },
          { label: 'variant', n: verdict?.n?.variant ?? results?.variant?.closedTrades ?? null },
        ],
        lastSampleAt: closed.lastAt,
        canCollect,
        blockedReason,
        measurable: arms?.measurable ?? (verdict?.verdict === 'unmeasurable' ? false : null),
        marketOpen: await this.symbolsMarketOpen(t.symbols, now),
        winner: verdict?.verdict === 'control-leads' ? 'control'
          : verdict?.verdict === 'variant-leads' ? 'variant'
            : null,
      });
    }
    return out;
  }

  /**
   * Every copied configuration (`duplicatedFromId`), compared against its control.
   *
   * ⚠️ THE SAMPLE IS COUNTED BY MAGIC, NOT BY NAME OR BY A JOIN KEY. #1018 settled that attribution
   * comes from the recorded magic, because a bot's name and comment are editable. Counting by
   * `scoringStrategyId` here would repeat #459's wrong-foreign-key trap.
   */
  private async botPairFacts(now: Date): Promise<ExperimentFacts[]> {
    const pairs: any[] = await (this.prisma as any).$queryRawUnsafe(`
      SELECT t.id AS twinId, t.name AS twinName, t.magic AS twinMagic, t.active AS twinActive,
             t.createdAt AS twinCreated, t.symbol AS twinSymbol,
             c.id AS controlId, c.name AS controlName, c.magic AS controlMagic, c.active AS controlActive
        FROM trading_strategy t
        JOIN trading_strategy c ON c.id = t.duplicatedFromId
       ORDER BY t.createdAt DESC
    `);

    const out: ExperimentFacts[] = [];
    for (const p of pairs) {
      const [controlStats, twinStats, rows] = await Promise.all([
        this.closedStatsForMagic(Number(p.controlMagic)),
        this.closedStatsForMagic(Number(p.twinMagic)),
        (this.prisma as any).$queryRawUnsafe(
          'SELECT * FROM trading_strategy WHERE id IN (?, ?)', p.controlId, p.twinId,
        ),
      ]);

      const controlRow: any = (rows as any[]).find((r) => r.id === p.controlId) ?? {};
      const twinRow: any = (rows as any[]).find((r) => r.id === p.twinId) ?? {};
      const changedFields = diffTradeFields(controlRow, twinRow);

      const bothActive = Number(p.controlActive) === 1 && Number(p.twinActive) === 1;
      // ⚠️ No review date is stored on a copied configuration, so the rule's own default supplies
      // one. It is a POLICY date, not a result, which is why it is never labelled as a measurement.
      const started = p.twinCreated ? new Date(p.twinCreated) : null;
      const reviewBy = started ? new Date(started.getTime() + 14 * 86_400_000) : null;

      // Expectancy per closed trade names a LEADER at DECIDE. It is not a significance claim, and
      // the sample bar is what licenses speaking at all.
      const cExp = controlStats.n > 0 ? controlStats.pnl / controlStats.n : null;
      const tExp = twinStats.n > 0 ? twinStats.pnl / twinStats.n : null;
      const winner = cExp === null || tExp === null || cExp === tExp
        ? null
        : tExp > cExp ? 'variant' : 'control';

      out.push({
        kind: 'bot-pair',
        id: `${p.controlId}::${p.twinId}`,
        title:
          `${p.twinName} vs ${p.controlName} (${p.twinSymbol}; ` +
          `${changedFields.length ? `differs in ${changedFields.join(', ')}` : 'differs in NOTHING'})`,
        status: bothActive ? 'running' : 'paused',
        startedAt: started,
        reviewBy,
        now,
        sides: [
          { label: `control ${p.controlName}`, n: controlStats.n },
          { label: `variant ${p.twinName}`, n: twinStats.n },
        ],
        lastSampleAt: controlStats.lastAt && twinStats.lastAt
          ? new Date(Math.max(controlStats.lastAt.getTime(), twinStats.lastAt.getTime()))
          : (controlStats.lastAt ?? twinStats.lastAt ?? null),
        canCollect: bothActive,
        blockedReason: bothActive ? null : 'one of the two bots is inactive, so the pair cannot collect on both sides',
        // ⚠️ `false` is a FINDING, not a formality: two bots that differ in nothing trade identically,
        // so the comparison can never produce a difference however long it runs.
        measurable: changedFields.length > 0,
        // #1210 follow-up (2026-11-06): a shut market is not a stall.
        marketOpen: isMarketOpenNow(await this.assetTypeOf(String(p.twinSymbol)), now),
        winner,
      });
    }
    return out;
  }

  private async lastClosedForAbTest(abTestId: string): Promise<{ lastAt: Date | null }> {
    try {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        'SELECT MAX(closedAt) AS lastAt FROM trade WHERE abTestId = ? AND status = ?',
        abTestId, 'closed',
      );
      return { lastAt: rows?.[0]?.lastAt ? new Date(rows[0].lastAt) : null };
    } catch {
      return { lastAt: null };
    }
  }

  /** The `symbol.type` for a ticker: crypto / forex / index / stock / etf / commodity. */
  private async assetTypeOf(ticker: string | null | undefined): Promise<string | null> {
    const t = String(ticker ?? '').trim().toUpperCase();
    if (!t) return null;
    try {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        'SELECT type FROM symbol WHERE ticker = ?', t,
      );
      return rows?.[0]?.type ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Is the market open for an A/B test's symbols?
   *
   * ⚠️ A test can span symbols of different classes. If they disagree the answer is `null`
   * ("cannot judge") rather than the first one's — reporting "open" because one leg is crypto
   * would hide a shut FX leg, which is the exact conflation this flag exists to prevent.
   */
  private async symbolsMarketOpen(symbols: unknown, now: Date): Promise<boolean | null> {
    const list = Array.isArray(symbols) ? symbols.map((s) => String(s)) : [];
    if (!list.length) return null;
    const answers = await Promise.all(list.map(async (s) => isMarketOpenNow(await this.assetTypeOf(s), now)));
    const known = answers.filter((a) => a !== null);
    if (!known.length) return null;
    return known.every((a) => a === true);
  }

  /** Closed trades and realised P&L for one bot, by magic. `pnlInvalid` rows are excluded (#805). */  private async closedStatsForMagic(magic: number): Promise<{ n: number; pnl: number; lastAt: Date | null }> {
    try {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT COUNT(*) AS n, COALESCE(SUM(pnl),0) AS pnl, MAX(closedAt) AS lastAt
           FROM trade WHERE magic = ? AND status = ? AND pnlInvalid = 0`,
        magic, 'closed',
      );
      const r = rows?.[0] ?? {};
      return { n: Number(r.n ?? 0), pnl: Number(r.pnl ?? 0), lastAt: r.lastAt ? new Date(r.lastAt) : null };
    } catch {
      return { n: 0, pnl: 0, lastAt: null };
    }
  }
}
