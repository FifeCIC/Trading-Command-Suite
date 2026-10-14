/**
 * EdgeController — "is there edge, and is it profit?" in one call.
 * ==================================================================
 *
 * WHY A SINGLE ENDPOINT (2026-09-12)
 * ----------------------------------
 * The owner's condition for continuing development is: *"I don't want to continue building
 * unless a change will have a positive impact on profitable trade."*
 *
 * Answering that required three separate things that did not previously exist in one place:
 *   1. directional accuracy WITH uncertainty  (was: a bare point estimate)
 *   2. the long/short split                    (was: pooled, which actively misled)
 *   3. PnL / expectancy                        (was: not surfaced at all)
 *
 * `GET /api/scoring/edge/verdict` returns all three plus an explicit statement of what the
 * current sample CANNOT support. The individual endpoints exist for drill-down; the verdict
 * endpoint is the one to read.
 *
 * ⚠️ A NOTE ON THE VERDICT WORDING
 * -------------------------------
 * The verdict is deliberately reluctant. It will say `insufficient` far more often than it
 * says `edge`, because that is the honest answer at these sample sizes. A tool that reports
 * confidence it has not earned is worse than no tool — it would license exactly the kind of
 * unverifiable change the owner is trying to stop.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { EdgeStatisticsService, EdgeReport } from './edge-statistics.service';
import { PnlStatisticsService, PnlReport, PnlPopulation } from './pnl-statistics.service';

@ApiTags('scoring')
@Controller('scoring/edge')
export class EdgeController {
  constructor(
    private readonly edge: EdgeStatisticsService,
    private readonly pnl: PnlStatisticsService,
  ) {}

  @Get('report')
  @ApiOperation({
    summary: 'Directional edge with 95% confidence intervals, split long/short (NOT profitability)',
  })
  @ApiQuery({ name: 'days', required: false, description: 'Lookback in days (default 30)' })
  @ApiQuery({ name: 'symbol', required: false })
  @ApiQuery({ name: 'timeframe', required: false })
  getReport(
    @Query('days') days?: string,
    @Query('symbol') symbol?: string,
    @Query('timeframe') timeframe?: string,
  ): Promise<EdgeReport> {
    return this.edge.getEdgeReport({
      days: days ? Number(days) : undefined,
      symbol,
      timeframe,
    });
  }

  @Get('pnl')
  @ApiOperation({
    summary: 'Expectancy and profit factor by side/source/strategy (this IS the money measure)',
  })
  @ApiQuery({ name: 'days', required: false, description: 'Lookback in days (default 90)' })
  @ApiQuery({ name: 'symbol', required: false })
  @ApiQuery({
    name: 'population',
    required: false,
    enum: ['all', 'live', 'ab-test'],
    description:
      'Which trades to measure. `all` (default) = unchanged behaviour. `live` excludes A/B test rows — use this for "is the STRATEGY working?". `ab-test` measures the instrument alone. See #1120.',
  })
  getPnl(
    @Query('days') days?: string,
    @Query('symbol') symbol?: string,
    @Query('population') population?: string,
  ): Promise<PnlReport> {
    return this.pnl.getPnlReport({
      days: days ? Number(days) : undefined,
      symbol,
      population: parsePnlPopulation(population),
    });
  }

  /**
   * The single call that answers the owner's question.
   *
   * Combines directional edge (from `directiveoutcome`) with realised PnL (from `trade`) and
   * states plainly whether the evidence supports any conclusion yet.
   */
  @Get('verdict')
  @ApiOperation({
    summary: 'One call: is there measurable edge, is it profit, and is the sample large enough to say?',
  })
  @ApiQuery({ name: 'days', required: false })
  getVerdict(@Query('days') days?: string) {
    return this.buildVerdict(days ? Number(days) : undefined);
  }

  private async buildVerdict(days?: number) {
    // Run both in parallel — they hit different tables and neither depends on the other.
    const [edge, pnl] = await Promise.all([
      this.edge.getEdgeReport({ days }),
      this.pnl.getPnlReport({ days: days ?? 90 }),
    ]);

    const verdict = decideVerdict(edge, pnl);

    return {
      generatedAt: new Date().toISOString(),
      verdict: verdict.level,
      summary: verdict.summary,
      /** What the numbers actually support right now. */
      findings: verdict.findings,
      /** What they explicitly do NOT support. */
      notEstablished: verdict.notEstablished,
      whatWouldChangeThis: verdict.whatWouldChangeThis,
      directionalEdge: {
        note: 'Directional accuracy. NOT profit. Excludes spread, slippage, sizing and stops.',
        overall: edge.overall,
        sample: edge.sample,
        scoreBands: edge.scoreBands,
      },
      profitability: {
        note: 'Expectancy is the headline. A high win rate with negative expectancy loses money.',
        overall: pnl.overall,
        bySide: pnl.bySide,
        bySource: pnl.bySource,
        byStrategy: pnl.byStrategy,
        sample: pnl.sample,
      },
      caveats: [...edge.caveats, ...pnl.caveats],
    };
  }
}

export type VerdictLevel = 'insufficient-data' | 'no-edge-detected' | 'directional-edge-no-pnl' | 'edge-and-profit' | 'losing';

/**
 * Parse the `population` query parameter for the P&L report (#1120).
 *
 * ⚠️ **AN UNRECOGNISED VALUE FALLS BACK TO `all`, NEVER TO `live`.** The tempting default for a
 * typo is "the useful one", but here the two answer different questions and `all` is the status
 * quo: a typo that silently produced the live-only figures would hand back a *flattering* number
 * with no indication the filter had been applied — the same "plausible output, no error" shape as
 * the defect this parameter exists to make visible.
 *
 * Exported and pure so it can be canaried without an HTTP call.
 */
export function parsePnlPopulation(v?: string): PnlPopulation {
  const s = (v ?? '').trim().toLowerCase();
  if (s === 'live') return 'live';
  if (s === 'ab-test' || s === 'abtest' || s === 'ab') return 'ab-test';
  return 'all';
}

/**
 * The decision ladder.
 *
 * ⚠️ Ordered deliberately: SAMPLE SUFFICIENCY IS CHECKED FIRST. A result can look excellent
 * and still return `insufficient-data`, because at 4 days a strong-looking number is not
 * evidence. This ordering is the whole safeguard.
 */
export function decideVerdict(edge: EdgeReport, pnl: PnlReport) {
  const days = edge.sample.distinctDays;
  const pnlTrades = pnl.sample.withPnl;

  const notEstablished: string[] = [];
  const findings: string[] = [];

  // ── Exit-geometry check ──────────────────────────────────────────────
  // ⚠️ REVISED 2026-09-12 (#805). An earlier version of this warning asserted
  // "Reward:risk is INVERTED ... this points at exits/stops, NOT at entry scoring."
  //
  // That conclusion was NOT supported. Verification against the raw rows showed the 2.11x
  // ratio was produced by TWO single trades:
  //     worst loss -65.25 = 69.3% of ALL losses  ->  avgLoss without it: -7.22 (not -18.83)
  //     best  win  +55.49 = 62.2% of ALL wins    ->  avgWin  without it: +3.75 (not  +8.92)
  // And the CONFIGURED geometry contradicts it: 13 of 22 bots set slPct 1 / tpPct 1 (1:1),
  // the rest 1.5:1 or 2:1 favourable. The app is not set up to target less than it risks.
  //
  // So the honest statement is "the realised loss/win ratio looks adverse, but on this sample
  // it is one trade per side" — a tail observation, not a diagnosed geometry defect. Saying
  // "this points at exits/stops" would send an agent to fix something that is not broken,
  // which is the exact failure this project keeps repeating (cf. #638, #789/#790).
  const lossWinRatio =
    pnl.overall && pnl.overall.avgWin > 0 && pnl.overall.avgLoss < 0
      ? Math.abs(pnl.overall.avgLoss) / pnl.overall.avgWin
      : null;

  // Only assert a geometry problem when the sample can carry it. Below 30 trades a single
  // outlier moves the mean more than any structural property of the strategy.
  const exitGeometryWarning =
    lossWinRatio !== null && lossWinRatio > 1 && pnl.overall!.trades >= 30
      ? `⚠️ Realised loss/win ratio is ${lossWinRatio.toFixed(2)}:1 (avgWin ${pnl.overall!.avgWin}, ` +
        `avgLoss ${pnl.overall!.avgLoss}) over ${pnl.overall!.trades} trades. Break-even needs a ` +
        `${((Math.abs(pnl.overall!.avgLoss) / (pnl.overall!.avgWin + Math.abs(pnl.overall!.avgLoss))) * 100).toFixed(0)}% win rate; ` +
        `the book is at ${(pnl.overall!.winRate * 100).toFixed(1)}%. Check whether this is geometry or outliers.`
      : lossWinRatio !== null && lossWinRatio > 1
        ? `ℹ️ Realised loss/win ratio is ${lossWinRatio.toFixed(2)}:1 (avgWin ${pnl.overall!.avgWin}, ` +
          `avgLoss ${pnl.overall!.avgLoss}) — but on only ${pnl.overall!.trades} trade(s). ` +
          `At this size ONE trade moves each mean, so this is NOT evidence of a stop/target defect. ` +
          `Configured bot geometry is mostly 1:1 with several at 1.5–2:1 favourable. ` +
          `Re-measure at n≥30 before drawing a conclusion.`
        : null;
  if (exitGeometryWarning) findings.push(exitGeometryWarning);

  // ── Gate 1: is the sample big enough to say anything at all? ──
  // 30 days is the threshold at which a single market regime stops being the dominant
  // explanation for a directional result.
  if (days < 30) {
    return {
      level: 'insufficient-data' as VerdictLevel,
      summary:
        `Only ${days} calendar day(s) of matured outcomes across ${edge.sample.distinctSymbols} symbol(s) ` +
        `and ${pnlTrades} closed trade(s) with PnL. This is long enough to prove the pipeline WORKS ` +
        `end-to-end, and far too short to judge whether the scoring has edge or whether it makes money. ` +
        `Neither "scoring is flawed" nor "the approach works" can be concluded.`,
      // ⚠️ `exitGeometryWarning` is included here via spread. An earlier version listed a
      // literal array and SILENTLY DROPPED it — the warning was computed, pushed to
      // `findings`, then discarded because this branch rebuilt the array. The most
      // actionable finding in the whole report was present in the code and absent from
      // the output. If this branch is ever rewritten, keep the spread.
      findings: [
        ...findings,
        `The outcome pipeline is functioning: ${edge.sample.maturedRows} predictions matured with ` +
          `${edge.sample.withDirection} resolved directions. This was previously unverified.`,
        edge.overall.bearish
          ? `Bearish signals: ${(edge.overall.bearish.hitRate * 100).toFixed(1)}% hit rate on n=${edge.overall.bearish.n}.`
          : 'No bearish samples.',
        edge.overall.bullish
          ? `Bullish signals: ${(edge.overall.bullish.hitRate * 100).toFixed(1)}% hit rate on n=${edge.overall.bullish.n}.`
          : 'No bullish samples.',
        ...(pnl.overall
          ? [`Realised expectancy: ${pnl.overall.expectancy} per trade on n=${pnl.overall.trades} (reliability: ${pnl.overall.reliability}).`]
          : ['No closed PnL to measure yet.']),
      ],
      notEstablished: [
        'Whether the scoring has predictive edge.',
        'Whether mixing directives within a protocol helps or hurts.',
        'Whether any directive is individually worth keeping.',
        'Whether the system is profitable — PnL sample is a fraction of what is needed.',
      ],
      whatWouldChangeThis: [
        `Accumulate to at least 30 distinct days (currently ${days}) — roughly ${Math.max(1, Math.ceil((30 - days) / 7))} more week(s) of running.`,
        // ⚠️ Computed from the actual sample, not hardcoded. An earlier version said
        // "grow past 100" while the value was already 114, which reads as the tool not
        // looking at its own data.
        pnlTrades >= 100
          ? `Closed PnL trades are already ${pnlTrades} (target ≥100 met) — the gap is now TIME, not trade count.`
          : `Grow closed PnL trades past 100 (currently ${pnlTrades}); expectancy needs ~100+ to escape noise.`,
        'Keep the long and short books reported separately — pooling them gave the opposite conclusion on 2026-09-12.',
        '⚠️ Check EXITS before entries: if avgLoss >> avgWin, the stop/target geometry is the first suspect, not the scoring.',
      ],
    };
  }

  // ── Gate 2: enough days. Now does anything clear a coin flip? ──
  const bearish = edge.overall.bearish;
  const bullish = edge.overall.bullish;
  const hasEdge =
    (bearish?.verdict === 'edge' || bearish?.verdict === 'possible-edge') ||
    (bullish?.verdict === 'edge' || bullish?.verdict === 'possible-edge');

  if (!hasEdge) {
    return {
      level: 'no-edge-detected' as VerdictLevel,
      summary:
        `${days} days of data and no direction clears a coin flip with statistical confidence. ` +
        `That is not proof the scoring is broken — it means the current evidence is consistent with ` +
        `the scoring having no measurable directional skill over this window.`,
      findings: [
        bearish ? `Bearish: ${(bearish.hitRate * 100).toFixed(1)}% on n=${bearish.n} (95% CI ${(bearish.ci95.low * 100).toFixed(1)}-${(bearish.ci95.high * 100).toFixed(1)}%, p=${bearish.pValue}).` : 'No bearish samples.',
        bullish ? `Bullish: ${(bullish.hitRate * 100).toFixed(1)}% on n=${bullish.n} (95% CI ${(bullish.ci95.low * 100).toFixed(1)}-${(bullish.ci95.high * 100).toFixed(1)}%, p=${bullish.pValue}).` : 'No bullish samples.',
      ],
      notEstablished: [
        'The hypothesis that mixing directives causes harm.',
        'The hypothesis that individual directives are well-calibrated.',
      ],
      whatWouldChangeThis: [
        'Per-directive intervals — see /api/scoring/edge/report byDirective — to find which directives are noise.',
        'A longer window that spans more than one market regime.',
      ],
    };
  }

  // ── Gate 3: there is directional edge. Is it MONEY? ──
  if (!pnl.overall || pnl.overall.reliability === 'noise') {
    return {
      level: 'directional-edge-no-pnl' as VerdictLevel,
      summary:
        `Directional edge detected, but the PnL sample (n=${pnlTrades}) cannot yet confirm it converts ` +
        `into money. Directional accuracy excludes spread, slippage and sizing, so this is a genuine ` +
        `open question, not a formality.`,
      findings: [
        bearish ? `Bearish edge: ${(bearish.hitRate * 100).toFixed(1)}% (CI lower bound ${(bearish.ci95.low * 100).toFixed(1)}%, above a coin flip).` : 'No bearish data.',
        bullish ? `Bullish: ${(bullish.hitRate * 100).toFixed(1)}% (CI ${(bullish.ci95.low * 100).toFixed(1)}-${(bullish.ci95.high * 100).toFixed(1)}%).` : 'No bullish data.',
        pnl.overall ? `Expectancy so far: ${pnl.overall.expectancy}/trade (reliability ${pnl.overall.reliability}).` : 'No PnL yet.',
      ],
      notEstablished: ['That the directional edge survives costs.'],
      whatWouldChangeThis: [`Reach ~100 closed PnL trades (currently ${pnlTrades}) for a reliable expectancy.`],
    };
  }

  const exp = pnl.overall.expectancy;
  if (exp > 0) {
    return {
      level: 'edge-and-profit' as VerdictLevel,
      summary: `Directional edge AND positive expectancy (${exp}/trade, reliability ${pnl.overall.reliability}) on n=${pnl.overall.trades} trades.`,
      findings: [
        `Expectancy ${exp}/trade; win rate ${(pnl.overall.winRate * 100).toFixed(1)}%; profit factor ${pnl.overall.profitFactor}.`,
        `Reliability: ${pnl.overall.reliability}.`,
      ],
      notEstablished: ['That this persists across a different market regime.'],
      whatWouldChangeThis: ['Continued tracking across regimes; watch for expectancy decay.'],
    };
  }

  return {
    level: 'losing' as VerdictLevel,
    summary: `Directional accuracy exists but expectancy is NEGATIVE (${exp}/trade) on n=${pnl.overall.trades} trades. Accuracy is not converting into money.`,
    // ⚠️ Same trap as the insufficient-data branch: `...findings` must be spread in, or the
    // exit-geometry warning is computed and thrown away. Caught by edge.controller.spec.ts.
    findings: [
      ...findings,
      `Expectancy ${exp}/trade; win rate ${(pnl.overall.winRate * 100).toFixed(1)}%; avg win ${pnl.overall.avgWin}; avg loss ${pnl.overall.avgLoss}.`,
      'This is the classic profile of a high-win-rate, poor-reward:risk system.',
    ],
    notEstablished: ['Whether reward:risk is set correctly, or sizing is at fault.'],
    whatWouldChangeThis: ['Investigate exits/reward:risk BEFORE changing entry scoring.'],
  };
}
