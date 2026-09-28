import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AbTest } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { sanitizeMt5Comment } from '../providers/mt5-comment.util';
// #965 — the verdict bar moved to ONE shared module when the backtest comparison needed the same
// rule. It was private here; a second private copy there would agree today and drift at the first
// tuning. Aliased to the local name so every use site (and this service's spec) is unchanged.
import { MIN_SAMPLES_FOR_VERDICT as AB_MIN_TRADES_FOR_VERDICT } from '../../common/trading/verdict-bar';

/**
 * Symbols allowed in a single A/B test. Default 8 — env-overridable via AB_MAX_SYMBOLS (#929).
 *
 * ⚠️ #929 recorded the capacity decision (2026-09-22): one test × 4 symbols accrued evidence
 * too slowly for A/B to settle any open finding, so the SPEED constraint — not the plumbing —
 * was the binding one. Widened together with the honesty bar below, so more sampling cannot
 * turn into more confident wrong answers.
 */
const MAX_AB_SYMBOLS = (() => {
  const n = Number(process.env.AB_MAX_SYMBOLS);
  return Number.isFinite(n) && n > 0 ? n : 8;
})();

/**
 * Concurrent running tests allowed. Default 2 (#929 capacity decision) — the loop evaluates
 * EVERY active test each tick (`getActiveTests`). Env-overridable via AB_MAX_ACTIVE.
 */
const MAX_AB_ACTIVE = (() => {
  const n = Number(process.env.AB_MAX_ACTIVE);
  return Number.isFinite(n) && n > 0 ? n : 2;
})();

/**
 * Closed trades PER SIDE required before any winner is named — see
 * `nest/src/common/trading/verdict-bar.ts` for the definition and the measurement behind it.
 *
 * 30 matches the repo's n≥30 threshold language (#805's edge controller). Below it the result
 * says `insufficient-data` WITH the current n — refusing to answer is the honest output, not a tie.
 */
// (value now imported above as AB_MIN_TRADES_FOR_VERDICT — do not re-declare it here.)

/** Side tags used in the broker comment so results can be attributed. */
const SIDE_A_TAG = 'AB-A';
const SIDE_B_TAG = 'AB-B';

/**
 * INERT_SNAPSHOT_FIELDS — config fields an A/B test CANNOT measure (#929).
 *
 * ⚠️ A field belongs here ONLY when the running code demonstrably ignores it. The list is a claim
 * like any other: a field is added with a spec proving the code ignores it, and must be REMOVED
 * the moment it is wired.
 *
 * `weightStrategy` is the first. `protocol-gating.service.ts` declares it INERT — the denominator
 * is hardcoded, so both of its values produce identical composites — guarded by
 * `weight-strategy-inert.spec.ts`.
 *
 * ⚠️ MEASURED 2026-09-25 — THIS IS NOT HYPOTHETICAL, IT ALREADY COST A TEST.
 * The only A/B test that has ever completed (`#929 XAU M15 - group vs maxscore weighting`,
 * 2026-09-22 11:19 → 2026-09-23 10:01) differed in EXACTLY ONE field of its two snapshots:
 *
 *     control v1.0.1  weightStrategy: "group-weighted"
 *     variant v1.0.2  weightStrategy: "maxscore-weighted"
 *
 * ...which is the single field declared inert. Both arms therefore scored identically and the
 * test was null BY CONSTRUCTION. Its verdict read
 * `"Refusing to name a winner: 0 vs 0 closed trades (need >=30 per side)"` — which blames SAMPLE
 * SIZE for a result that adding trades could never have produced. A month of accrual was spent
 * to answer a question that had no answer.
 *
 * So the refusal below exists to fail at CREATE time, when changing the variant is one edit,
 * rather than at read time a month later when it is a wasted window.
 */
const INERT_SNAPSHOT_FIELDS = new Set(['weightStrategy']);

/**
 * Who is allowed to decide HOW an A/B side trades (#929).
 *
 * `mode: null` means **cannot judge** — never a default. See `resolveTradeAuthority()`.
 */
export interface AbTradeAuthority {
  /** `'auto'` to place live orders; anything else cannot produce a measurable result. */
  mode: string | null;
  botId: string | null;
  botName: string | null;
  /** Populated only when `mode` is null — the cause, so it is never a mystery. */
  reason?: string;
}

/**
 * A/B Test Runner (#482) — run two MetaStack snapshots (control vs variant)
 * side-by-side on the same symbols and compare real trading results.
 *
 * Lifecycle: draft → running → complete (or cancelled).
 * Trades are tagged with `Trade.abTestId` + `brokerComment "TCS AB-A/AB-B {name}"`.
 * Results (PnL, win rate, max drawdown) are computed from the Trade table on stop.
 */
@Injectable()
export class AbTestService {
  private readonly logger = new Logger(AbTestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
    private readonly tradeRecorder: TradeRecorderService,
  ) {}

  /** Create a draft A/B test. Validates the 1-active / 4-symbol limits. */
  async create(input: {
    name: string;
    controlStackId: string;
    variantStackId: string;
    symbols: string[];
  }): Promise<AbTest> {
    if (!input.name?.trim()) throw new BadRequestException('name is required');
    if (!Array.isArray(input.symbols) || input.symbols.length === 0) {
      throw new BadRequestException('symbols must be a non-empty array');
    }
    const symbols = [...new Set(input.symbols.map((s) => String(s).trim()).filter(Boolean))];
    if (symbols.length > MAX_AB_SYMBOLS) {
      throw new BadRequestException(`A/B test limited to ${MAX_AB_SYMBOLS} symbols (got ${symbols.length})`);
    }
    if (input.controlStackId === input.variantStackId) {
      throw new BadRequestException('controlStackId and variantStackId must differ');
    }

    await this.assertSnapshotsExist(input.controlStackId, input.variantStackId);
    await this.assertArmsCanDiffer(input.controlStackId, input.variantStackId);

    return this.prisma.abTest.create({
      data: {
        name: input.name.trim(),
        controlStackId: input.controlStackId,
        variantStackId: input.variantStackId,
        symbols,
        status: 'draft',
      },
    });
  }

  /**
   * diffSnapshots() — which fields two frozen configs actually disagree on.
   *
   * Returns FIELD NAMES only, never values: a strategy config can carry a broker credential, and
   * a diff that leaks one into a log or an error message is a worse bug than the one it fixes.
   */
  private diffSnapshots(a: unknown, b: unknown): {
    changed: string[];
    inert: string[];
    liveable: string[];
  } {
    const ka = (a ?? {}) as Record<string, unknown>;
    const kb = (b ?? {}) as Record<string, unknown>;
    const changed = [...new Set([...Object.keys(ka), ...Object.keys(kb)])].filter(
      (k) => JSON.stringify(ka[k] ?? null) !== JSON.stringify(kb[k] ?? null),
    );
    const inert = changed.filter((k) => INERT_SNAPSHOT_FIELDS.has(k));
    return { changed, inert, liveable: changed.filter((k) => !INERT_SNAPSHOT_FIELDS.has(k)) };
  }

  /**
   * assertArmsCanDiffer() — REFUSE AN A/B WHOSE ARMS CANNOT PRODUCE A DIFFERENCE (#929).
   *
   * ⚠️ THE RULE IS ONE-SIDED ON PURPOSE: this refuses only when EVERY differing field is a KNOWN
   * inert one. A single unrecognised field is treated as LIVE, because this service cannot know
   * that a field it has never heard of is ignored — assuming inertness would block valid tests,
   * and a guard that blocks valid work gets removed.
   *
   * Refusing here rather than warning is deliberate: the cost of a wrong refusal is one edit at
   * create time, and the cost of a wrong admission is a whole measurement window spent accruing
   * trades that cannot differ. That trade was already paid once (see INERT_SNAPSHOT_FIELDS).
   */
  private async assertArmsCanDiffer(controlId: string, variantId: string): Promise<void> {
    const [control, variant] = await Promise.all([
      this.prisma.metaStackSnapshot.findUnique({ where: { id: controlId } }),
      this.prisma.metaStackSnapshot.findUnique({ where: { id: variantId } }),
    ]);
    if (!control || !variant) return; // assertSnapshotsExist has already reported this

    const { changed, inert, liveable } = this.diffSnapshots(control.snapshot, variant.snapshot);

    if (changed.length === 0) {
      throw new BadRequestException(
        `Control (${control.version}) and variant (${variant.version}) have IDENTICAL configs — ` +
          `there is nothing to compare. Change at least one field on the variant (#929).`,
      );
    }

    if (liveable.length === 0) {
      throw new BadRequestException(
        `A/B test cannot measure anything: the two snapshots differ ONLY in ` +
          `${inert.map((f) => `'${f}'`).join(', ')}, which the code declares INERT ` +
          `(the value is stored and echoed, but nothing branches on it). Both arms would score ` +
          `identically, so no number of trades could separate them. Change a field the pipeline ` +
          `actually reads — or wire '${inert[0]}' first (#929).`,
      );
    }

    // Visible, not silent: a test whose arms differ in a live field AND an inert one is valid,
    // but the inert difference is a decoy that must not later be credited with any result.
    if (inert.length) {
      this.logger.warn(
        `A/B ${control.version} vs ${variant.version} also differs in inert field(s) ` +
          `${inert.join(', ')} — those cannot contribute to a result (#929).`,
      );
    }
  }

  /** Start a test — enforces the max-1-active rule. */
  async start(id: string): Promise<AbTest> {
    const test = await this.prisma.abTest.findUnique({ where: { id } });
    if (!test) throw new NotFoundException(`A/B test ${id} not found`);
    if (test.status === 'running') return test;

    const active = await this.getActiveTests();
    if (active.length >= MAX_AB_ACTIVE && !active.some((t) => t.id === id)) {
      throw new BadRequestException(
        `A/B capacity reached (${active.length}/${MAX_AB_ACTIVE} running: ${active.map((t) => t.name).join(', ')}) — stop one first (#929)`,
      );
    }

    await this.assertSnapshotsExist(test.controlStackId, test.variantStackId);

    // ⚠️ #929 — REFUSE A TEST THAT CANNOT MEASURE ANYTHING.
    //
    // If the owning bot does not trade live, no order is ever placed, so no trade ever closes and
    // no result can ever be computed. Starting it anyway is how this issue spent a day accruing
    // ten phantom rows that were reported as executions. The honest output is a refusal that names
    // the bot and its mode — see `resolveTradeAuthority()`.
    const authority = await this.resolveTradeAuthority(test.controlStackId);
    if (authority.mode !== 'auto') {
      throw new BadRequestException(
        `A/B test "${test.name}" cannot produce a result: ` +
          (authority.reason ??
            `owning bot "${authority.botName}" is '${authority.mode}', not 'auto'`) +
          `. A/B compares OUTCOMES, so it needs live orders — set the bot to 'auto' first (#929).`,
      );
    }

    this.logger.log(
      `A/B test "${test.name}" started (${Array.isArray(test.symbols) ? test.symbols.length : 0} symbols) ` +
        `— trade authority: bot "${authority.botName}" (${authority.mode})`,
    );
    return this.prisma.abTest.update({
      where: { id },
      data: { status: 'running', startAt: new Date(), endAt: null, results: null },
    });
  }

  /** Stop a test and compute final results. */
  async stop(id: string): Promise<AbTest> {
    const test = await this.prisma.abTest.findUnique({ where: { id } });
    if (!test) throw new NotFoundException(`A/B test ${id} not found`);

    const results = await this.computeResults(test);
    this.logger.log(
      `A/B test "${test.name}" stopped — control PnL=${results.control.totalPnl} variant PnL=${results.variant.totalPnl}`,
    );
    return this.prisma.abTest.update({
      where: { id },
      data: { status: 'complete', endAt: new Date(), results },
    });
  }

  /** Cancel a draft/running test without computing results. */
  async cancel(id: string): Promise<AbTest> {
    const test = await this.prisma.abTest.findUnique({ where: { id } });
    if (!test) throw new NotFoundException(`A/B test ${id} not found`);
    return this.prisma.abTest.update({ where: { id }, data: { status: 'cancelled' } });
  }

  /**
   * Get a test plus its current results (computed live if running).
   *
   * ⚠️ `tradeAuthority` is returned deliberately (#929) — a BURIED ABILITY given a surface.
   *
   * The verdict depends on WHERE the orders came from, and that used to be invisible: the runner
   * read its trading mode off a SCORING field, so a test that CANNOT trade and a test that simply
   * has not traded yet both rendered as `0 vs 0`. Returning the resolved bot makes the difference
   * a fact in the payload instead of an inference the reader has to make.
   */
  async getResults(id: string): Promise<{ test: AbTest; tradeAuthority: AbTradeAuthority; results: any; arms: any }> {
    const test = await this.prisma.abTest.findUnique({ where: { id } });
    if (!test) throw new NotFoundException(`A/B test ${id} not found`);
    const [tradeAuthority, results, arms] = await Promise.all([
      this.resolveTradeAuthority(test.controlStackId),
      test.status === 'complete' ? Promise.resolve(test.results ?? {}) : this.computeResults(test),
      // ⚠️ #929 — ALWAYS computed, even for a completed test. A stored verdict is a record of what
      // was concluded AT THE TIME; the arms diff is a live fact about the config that can explain
      // it. The first test to complete ended with "0 vs 0 closed trades (need ≥30 per side)", which
      // reads as "wait longer" when the true answer was "these arms cannot differ — no number of
      // trades would help". Without this the one test that went wrong is the one test that cannot
      // say why.
      this.describeArms(test.controlStackId, test.variantStackId),
    ]);
    return { test, tradeAuthority, results, arms };
  }

  /** The first running test (null if none). ⚠️ Prefer getActiveTests() — capacity is >1 (#929). */
  async getActiveTest(): Promise<AbTest | null> {
    return this.prisma.abTest.findFirst({ where: { status: 'running' } });
  }

  /** Every running test (capacity: MAX_AB_ACTIVE). The loop evaluates all of them each tick (#929). */
  async getActiveTests(): Promise<AbTest[]> {
    return this.prisma.abTest.findMany({ where: { status: 'running' }, orderBy: { startAt: 'asc' } });
  }

  /**
   * resolveTradeAuthority() — WHO decides HOW an A/B side trades? (#929)
   *
   * ⚠️ THIS IS THE FIX FOR AN UNREACHABLE ORDER PATH, NOT A REFACTOR.
   *
   * `dispatchSideTrade` used to read its `mode` from the SNAPSHOT (`controlCfg.mode`). That field
   * is written from `scoringStrategy.mode` (`metastack-versioning.service.ts` L42) and therefore
   * holds the SCORING style. Measured on the live database 2026-09-23:
   *
   *     scoring_strategy.mode  ->  'score' x18 | 'semi-auto' x7 | 'manual' x2 | 'auto' x0
   *     trading_strategy.mode  ->  'auto'  x25 | 'manual' x2
   *
   * The runner compared the first against the TRADING modes `'auto'|'manual'|'semi-auto'`, so
   * `mode !== 'auto'` was true for **every stack that has ever existed** and the order branch was
   * unreachable. A/B ran for a day without placing a single order — the ten `EXECUTED` rows it
   * produced were intents with `brokerTicket: NULL`.
   *
   * One field name, two meanings. The trading authority is the BOT, because the bot is what
   * actually dispatches orders (Gate 2, `automation-loop.service.ts`). The snapshot is a frozen
   * CONFIG being compared; it is not an authority on how to trade.
   *
   * Resolution: snapshot -> `scoringStrategyId` -> every `trading_strategy` referencing it.
   *   - no active bot        -> cannot judge (never a silent default)
   *   - bots disagree        -> cannot judge
   *   - all agree on a mode  -> that mode
   */
  async resolveTradeAuthority(snapshotId: string): Promise<AbTradeAuthority> {
    const snapshot = await this.prisma.metaStackSnapshot.findUnique({ where: { id: snapshotId } });
    if (!snapshot) {
      return { mode: null, botId: null, botName: null, reason: `snapshot ${snapshotId} not found` };
    }
    return this.resolveAuthorityForScoringStrategy(snapshot.scoringStrategyId);
  }

  /** The body of `resolveTradeAuthority`, keyed on the scoring strategy a snapshot froze. */
  private async resolveAuthorityForScoringStrategy(scoringStrategyId: string): Promise<AbTradeAuthority> {
    const bots = await this.prisma.tradingStrategy.findMany({
      where: { scoringStrategyId },
      select: { id: true, name: true, mode: true, active: true },
    });

    if (bots.length === 0) {
      return {
        mode: null,
        botId: null,
        botName: null,
        reason: `no trading_strategy row references scoring strategy ${scoringStrategyId}`,
      };
    }

    const isActive = (v: unknown) => v === true || Number(v) === 1;
    const active = bots.filter((b) => isActive(b.active));
    if (active.length === 0) {
      return {
        mode: null,
        botId: null,
        botName: null,
        reason: `every bot on ${scoringStrategyId} is inactive (${bots.map((b) => b.name).join(', ')})`,
      };
    }

    const distinct = [...new Set(active.map((b) => String(b.mode)))];
    if (distinct.length > 1) {
      return {
        mode: null,
        botId: null,
        botName: null,
        reason:
          `bots on ${scoringStrategyId} disagree on mode (` +
          `${active.map((b) => `${b.name}=${b.mode}`).join(', ')}) — ` +
          `a test on an ambiguous authority would compare two things at once`,
      };
    }

    return { mode: distinct[0], botId: active[0].id, botName: active[0].name };
  }

  /** List recent A/B tests (newest first). */
  async list(limit = 25): Promise<AbTest[]> {
    return this.prisma.abTest.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }

  /** List available MetaStack snapshots for the create form. */
  async listSnapshots(): Promise<Array<{ id: string; scoringStrategyId: string; version: string; createdAt: Date }>> {
    return this.prisma.metaStackSnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, scoringStrategyId: true, version: true, createdAt: true },
      take: 100,
    });
  }

  /**
   * Dispatch a single side's trade (called by the automation loop).
   * Places the order via the adapter (auto mode) and records it with abTestId.
   */
  async dispatchSideTrade(params: {
    test: AbTest;
    side: 'A' | 'B';
    symbol: string;
    brokerId: string;
    sideDir: 'BUY' | 'SELL';
    quantity: number;
    slPct: number;
    tpPct: number;
    entryPrice: number;
    /**
     * Resolved from the owning BOT via `resolveTradeAuthority()` — NEVER from a snapshot.
     * `null` means "cannot judge" and is a refusal, not a fallback to 'manual'.
     */
    tradeMode: string | null;
    /** Human name of the bot whose mode this is, for the refusal message. */
    tradeModeSource?: string;
    /** Why `tradeMode` is null, when it is. */
    tradeModeReason?: string;
  }): Promise<{ success: boolean; error?: string; ticket?: number; price?: number; refused?: boolean }> {
    const {
      test, side, symbol, brokerId, sideDir, quantity, slPct, tpPct, entryPrice,
      tradeMode, tradeModeSource, tradeModeReason,
    } = params;
    const comment = sanitizeMt5Comment(`TCS ${side === 'A' ? SIDE_A_TAG : SIDE_B_TAG} ${test.name}`, 27);

    const sl = sideDir === 'BUY' ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100);
    const tp = sideDir === 'BUY' ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100);

    // ⚠️ #929 — A REFUSAL WRITES NO `trade` ROW, AND IS NOT A FAILURE.
    //
    // The previous branch recorded a `trade` row for an order that was never placed and returned
    // `success: true`. The caller logged those as `EXECUTED` — ten rows with `brokerTicket: NULL`
    // in a 7-hour window on 2026-09-22 ("Reconciled: no broker counterpart (stranded row)").
    //
    // Two things were wrong, and only the second was the real fault:
    //   1. an intent is not a trade, and `computeResults` reads `trade WHERE abTestId` — so a
    //      phantom row is a lie in the very table the verdict is computed from;
    //   2. the `mode` it branched on came from the SNAPSHOT, which carries the SCORING style.
    //      `'auto'` is not a value `scoring_strategy.mode` has ever held, so the order branch was
    //      UNREACHABLE. See `resolveTradeAuthority()`.
    //
    // `refused` is a THIRD outcome, distinct from success and failure: nothing went wrong, the
    // configuration simply does not trade live. Collapsing it into `FAILED` would report a
    // non-event as an error, and the evidence that a signal fired is already in `decision_log`.
    if (tradeMode !== 'auto') {
      return {
        success: false,
        refused: true,
        error: tradeMode === null
          ? `cannot determine how to trade: ${tradeModeReason ?? 'trade authority unresolved'}`
          : `${tradeModeSource ?? 'owning bot'} is '${tradeMode}' — no live order (A/B needs 'auto')`,
      };
    }

    const adapter = this.adapterFactory.create(brokerId);
    if (!adapter?.placeOrder) {
      return { success: false, error: `Broker ${brokerId} has no order capability` };
    }

    const result = await adapter.placeOrder({
      symbol,
      side: sideDir,
      quantity,
      sl,
      tp,
      comment,
      clientOrderId: `ab-${test.id}-${side}-${symbol}`,
    });

    await this.tradeRecorder.record({
      symbol,
      side: sideDir.toLowerCase() as 'buy' | 'sell',
      quantity,
      entryPrice: result.price || entryPrice || 0,
      provider: (brokerId as any) || 'mt5',
      strategy: `AB-${side} ${test.name}`,
      status: result.success ? 'open' : 'rejected',
      origin: 'strategy',
      source: 'meta-stack',
      abTestId: test.id,
      // ⚠️ #929 — the side is stored STRUCTURALLY. `computeResults` used to recover it by
      // parsing `brokerComment` for the `AB-A`/`AB-B` tag, but the stranded-trade reaper
      // overwrites that string, so a reaped A/B trade lost its side and vanished from the
      // verdict with no error. Measured 2026-09-23: 14 of 14 A/B rows attributed to 0 sides.
      abTestSide: side,
      // ⚠️ #1014 — still the ORDER ticket, on purpose. The A/B scale-ins are the clearest case: all
      // four orders on this NETTING account share ONE positionId, so switching this to
      // `result.positionId` would give all four rows the same closing deal — and the reconciler
      // books the position's ENTIRE net to each, with no volume split. That is a 4x overstatement
      // waiting for the next A/B run. The bridge and adapter now carry `positionId`; the switch
      // waits on the split.
      brokerTicket: result.ticket != null ? String(result.ticket) : undefined,
      sl,
      tp,
      brokerComment: comment,
    });

    return { success: result.success, error: result.error, ticket: result.ticket as number | undefined, price: result.price };
  }

  /** Aggregate per-side PnL, win rate, and max drawdown from recorded trades. */
  private async computeResults(test: AbTest): Promise<any> {
    const trades = await this.prisma.trade.findMany({
      where: { abTestId: test.id, pnlInvalid: 0 }, // #931 — phantom closes are not results
      orderBy: { openedAt: 'asc' },
    });

    // ⚠️ #929 — attribute by `abTestSide`, NOT by parsing `brokerComment`.
    //
    // This read `t.brokerComment?.includes('AB-A')`. `brokerComment` is NOT immutable: the
    // stranded-trade reaper (`position-sync.service.ts` `reapStrandedOpenTrades`) OVERWRITES it
    // with 'Reconciled: no broker counterpart (stranded row)'. Any A/B trade that got reaped
    // therefore matched NEITHER side and was dropped from both totals in silence — measured
    // 2026-09-23: 14 A/B rows, `side_A = 0`, `side_B = 0`, `0 vs 0` reported.
    //
    // A verdict must never depend on a mutable display string. `trade.abTestSide` is the record.
    const sideA = trades.filter((t) => t.abTestSide === 'A');
    const sideB = trades.filter((t) => t.abTestSide === 'B');

    // ⚠️ Rows tagged to this test that carry NO side are REPORTED, never dropped in silence.
    // They were traded before `abTestSide` existed, or written by a path that forgot it. A test
    // that says `0 vs 0` while holding rows nobody can attribute is the misleading output; a
    // count of those rows is the honest one (see development-philosophy §7, “make silence visible”).
    const unattributed = trades.filter((t) => t.abTestSide !== 'A' && t.abTestSide !== 'B').length;

    // Live unrealized P&L from MT5 positions tagged with the A/B comment.
    let liveBySide: Record<'A' | 'B', number> = { A: 0, B: 0 };
    try {
      const mt5 = this.adapterFactory.create('mt5') as any;
      const raw = mt5?.getPositionsRaw ? await mt5.getPositionsRaw() : [];
      for (const p of raw) {
        const comment = String(p.comment ?? '');
        if (comment.includes(SIDE_A_TAG)) liveBySide.A += Number(p.profit ?? 0);
        else if (comment.includes(SIDE_B_TAG)) liveBySide.B += Number(p.profit ?? 0);
      }
    } catch (err) {
      this.logger.warn(`A/B unrealized P&L lookup failed: ${(err as Error).message}`);
    }

    const summarize = (rows: typeof trades, livePnl: number) => {
      const closed = rows.filter((t) => t.status === 'closed' && t.pnl != null);
      const open = rows.filter((t) => t.status === 'open');
      const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
      const realized = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
      // Running equity curve for max drawdown (realized + live unrealized)
      let equity = livePnl;
      let peak = Math.max(0, equity);
      let maxDrawdown = peak - equity;
      for (const t of closed) {
        equity += t.pnl ?? 0;
        if (equity > peak) peak = equity;
        const dd = peak - equity;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }
      return {
        trades: rows.length,
        openTrades: open.length,
        closedTrades: closed.length,
        winRate: closed.length ? +(wins / closed.length).toFixed(4) : null,
        realizedPnl: +realized.toFixed(2),
        unrealizedPnl: +livePnl.toFixed(2),
        totalPnl: +(realized + livePnl).toFixed(2),
        maxDrawdown: +maxDrawdown.toFixed(2),
      };
    };

    const result = {
      control: summarize(sideA, liveBySide.A),
      variant: summarize(sideB, liveBySide.B),
      unattributed,
      symbols: test.symbols,
      computedAt: new Date().toISOString(),
    };

    // ⚠️ #929 — HOW COULD THIS TEST HAVE DIFFERED AT ALL?
    //
    // A verdict of "no difference" is meaningless if the two arms were never able to differ. This
    // is not hypothetical: the first test to complete differed in exactly one field, and that
    // field was inert, so the comparison was null by construction. Without this field the only
    // visible output is `0 vs 0`, which reads as "not enough trades yet" and invites the operator
    // to wait longer for a result that cannot arrive.
    const arms = await this.describeArms(test.controlStackId, test.variantStackId);
    // #929 — a result without a stated verdict is not a result. The verdict REFUSES to name a
    // winner below the per-side sample bar, and names its method when it does.
    return { ...result, arms, verdict: this.buildVerdict(result.control, result.variant, unattributed, arms) };
    // #929 — a result without a stated verdict is not a result. The verdict REFUSES to name a
    // winner below the per-side sample bar, and names its method when it does.
    return { ...result, arms, verdict: this.buildVerdict(result.control, result.variant, unattributed, arms) };
  }

  /**
   * describeArms() — can these two frozen configs produce a different decision at all? (#929)
   *
   * ⚠️ EXTRACTED SO IT CAN BE READ ON A **COMPLETED** TEST, WHICH IS THE ONLY PLACE IT MATTERS.
   *
   * `getResults` serves the STORED `results` blob for a completed test rather than recomputing it,
   * so a test that finished before this diagnostic existed carries a verdict with no explanation
   * of why it produced nothing. That is precisely the test an operator will look at. Attaching the
   * diff at read time fixes that WITHOUT rewriting `test.results` — a stored verdict is a
   * historical record of what was concluded, and back-filling it would be falsifying it.
   */
  private async describeArms(
    controlStackId: string,
    variantStackId: string,
  ): Promise<{ changedFields: string[]; inertFields: string[]; measurable: boolean } | null> {
    try {
      const [c, v] = await Promise.all([
        this.prisma.metaStackSnapshot.findUnique({ where: { id: controlStackId } }),
        this.prisma.metaStackSnapshot.findUnique({ where: { id: variantStackId } }),
      ]);
      if (!c || !v) return null;
      const d = this.diffSnapshots(c.snapshot, v.snapshot);
      return { changedFields: d.changed, inertFields: d.inert, measurable: d.liveable.length > 0 };
    } catch (err) {
      // A diff is a diagnostic. It must never take a verdict down with it.
      this.logger.warn(`A/B arm diff failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * #929 — the honesty bar. Two things must never happen: a verdict on a sample too small to
   * carry one, and a verdict with no stated method. Below AB_MIN_TRADES_FOR_VERDICT per side
   * this returns `insufficient-data` WITH the counts; above, it runs a two-proportion z-test on
   * win rates and reports the PnL-per-trade difference, both named.
   */
  private buildVerdict(
    control: any,
    variant: any,
    unattributed = 0,
    arms: { changedFields: string[]; inertFields: string[]; measurable: boolean } | null = null,
  ): Record<string, unknown> {
    const nA = control.closedTrades ?? 0;
    const nB = variant.closedTrades ?? 0;
    // ⚠️ #929 — AN UNMEASURABLE TEST OUTRANKS AN UNDERPOWERED ONE.
    // "Wait for more trades" is the wrong instruction when no number of trades can separate the
    // arms. This is checked FIRST so the sample-size note cannot mask it.
    if (arms && !arms.measurable) {
      // ⚠️ TWO DISTINCT CAUSES, TWO DISTINCT SENTENCES. Composing one message for both produced
      // "the two arms differ only in , which the code declares INERT" when the field list was
      // empty — a sentence that reads as a bug and tells the reader nothing. `create()` refuses
      // both cases, so a runnable test cannot reach here; a LEGACY row still can.
      const which = arms.inertFields.length
        ? `differ only in ${arms.inertFields.map((f) => `'${f}'`).join(', ')}, which the code ` +
          `declares INERT`
        : `are IDENTICAL in every field`;
      return {
        verdict: 'unmeasurable',
        n: { control: nA, variant: nB },
        unattributed,
        requiredPerSide: AB_MIN_TRADES_FOR_VERDICT,
        changedFields: arms.changedFields,
        inertFields: arms.inertFields,
        note:
          `THIS TEST CANNOT PRODUCE A RESULT. The two arms ${which} — so both sides have always ` +
          `scored identically and MORE TRADES CANNOT CHANGE THAT. Do not read ` +
          `'${nA} vs ${nB}' as a small sample; it is an empty comparison (#929).`,
      };
    }
    // ⚠️ #929 — an unattributable row is named here, because `0 vs 0` reads as "no trades yet"
    // when it can equally mean "trades exist that we cannot attribute". Those are different
    // facts and must not render the same.
    const unattributedNote = unattributed
      ? ` ⚠️ ${unattributed} row(s) are tagged to this test but carry NO side and are in neither ` +
        `total — do NOT read this as "no trades yet".`
      : '';
    if (nA < AB_MIN_TRADES_FOR_VERDICT || nB < AB_MIN_TRADES_FOR_VERDICT) {
      return {
        verdict: 'insufficient-data',
        n: { control: nA, variant: nB },
        unattributed,
        requiredPerSide: AB_MIN_TRADES_FOR_VERDICT,
        note:
          `Refusing to name a winner: ${nA} vs ${nB} closed trades (need ≥${AB_MIN_TRADES_FOR_VERDICT} per side). ` +
          `A verdict on a smaller sample is noise wearing a result's clothes (#929).` +
          unattributedNote,
      };
    }
    const pA = control.winRate ?? 0;
    const pB = variant.winRate ?? 0;
    const z = twoProportionZ(pA, nA, pB, nB);
    const pValue = 2 * (1 - normalCdf(Math.abs(z)));
    const pnlPerTradeA = control.realizedPnl / nA;
    const pnlPerTradeB = variant.realizedPnl / nB;
    const significant = pValue < 0.05;
    return {
      verdict: !significant ? 'no-significant-difference' : pA > pB ? 'control-leads' : 'variant-leads',
      method: 'two-proportion z-test on win rate (p<0.05); PnL-per-trade difference reported, not tested',
      n: { control: nA, variant: nB },
      winRate: { control: pA, variant: pB, delta: +(pB - pA).toFixed(4) },
      pnlPerTrade: {
        control: +pnlPerTradeA.toFixed(2),
        variant: +pnlPerTradeB.toFixed(2),
        delta: +(pnlPerTradeB - pnlPerTradeA).toFixed(2),
      },
      pValue: +pValue.toFixed(4),
    };
  }

  private async assertSnapshotsExist(controlStackId: string, variantStackId: string): Promise<void> {
    const snapshots = await this.prisma.metaStackSnapshot.findMany({
      where: { id: { in: [controlStackId, variantStackId] } },
      select: { id: true, scoringStrategyId: true, version: true },
    });
    const found = new Set(snapshots.map((s) => s.id));
    if (!found.has(controlStackId)) throw new BadRequestException(`controlStackId ${controlStackId} is not a valid snapshot`);
    if (!found.has(variantStackId)) throw new BadRequestException(`variantStackId ${variantStackId} is not a valid snapshot`);
  }
}

/** Two-proportion z statistic for win rates (pooled variance, the standard test for this comparison). */
function twoProportionZ(p1: number, n1: number, p2: number, n2: number): number {
  if (n1 <= 0 || n2 <= 0) return 0;
  const p = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se === 0 ? 0 : (p1 - p2) / se;
}

/** erf via Abramowitz–Stegun 7.1.26 (|error| < 1.5e-7) — one formula is not worth a stats dependency. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF, for the two-sided p-value in buildVerdict (#929). */
function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}
