import { Controller, Get, Query } from '@nestjs/common';
import { ExitConsensusService } from './exit-consensus.service';

/**
 * ExitConsensusController — `GET /api/scoring/exit-consensus`
 *
 * WHY THIS IS A SEPARATE CONTROLLER, AND ON `/scoring` RATHER THAN `/portfolio`.
 *
 * The pre-existing `GET /api/portfolio/exit-signals` reads the **Trading 212** book through
 * `PortfolioService`. That book is a data-import concern (owner direction, 2026-09-28) and it is
 * not what a bot-managed position needs evaluating against. This endpoint answers the OTHER
 * question — "what does the combination of our evidence say about keeping this open MT5
 * position?" — so it lives beside the scoring stack it actually reads.
 *
 * ⚠️ ADVISORY. It returns an assessment; it closes nothing and moves no stop. Acting on an
 * `action` is a maths change and needs a copied configuration and a monitored comparison first
 * — see `ExitConsensusService`'s header.
 *
 * ── DECISION (2026-10-01, primary) ──
 * WHAT:      The exit chain stays ADVISORY. `action` is computed and published; nothing consumes it.
 * WHY:       Acting on it changes what a live position does, so it is a maths change. The owner's
 *            rule requires a COPIED configuration and a MONITORED comparison, and the monitor
 *            cannot yet reach a verdict on a REAL test: measured 2026-10-01, the one completed A/B
 *            run produced **identical P&L for both arms** (−11.80 / −11.80), and across the 122
 *            tagged trades only **17 distinct orders** exist while **91 of 110** arm rows carry a
 *            NULL `pnl` — the merged-position split is not resolving, so there is nothing to read.
 *            ⚠️ CORRECTED 2026-10-01 (second correction to this marker). It first blamed the
 *            `metastack_snapshot.mode` conflation — fixed 2026-09-23 — and then claimed capacity
 *            was `MAX_AB_SYMBOLS = 4` / one test at a time. **Both were read from issues rather than
 *            measured.** The real defaults are `AB_MAX_SYMBOLS = 8` and `AB_MAX_ACTIVE = 2`, both
 *            env-overridable, widened on 2026-09-22. Capacity is not the binding constraint;
 *            ATTRIBUTION is.
 * INSTEAD OF: Giving the chain authority now — the owner's R29 asked for "an advanced exit process",
 *            and a computed-but-unused verdict is a fair reading of that as unfinished.
 * REVERSE BY: Fix #929, create a copied configuration (`maths-change-requires-ab`), run the
 *            comparison, then set the action. One line of behaviour, once it is measurable.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 54
 * GUARD:     NONE — nothing fails if a future change starts acting on `action`. 🔴 UNGUARDED, and
 *            said plainly rather than implied.
 *
 * ── PLANNED IN #1125 — this RE-OPENS the DECISION above, and says what changed ──
 * ⚠️ Read the DECISION's reasoning as HISTORICAL. Its conclusion (stay advisory) may still hold;
 *    its PREMISE has moved, so it must not be treated as settled on the old grounds.
 * WHAT CHANGED: the DECISION's `REVERSE BY` routes through fixing #929 and running a LIVE A/B
 *    comparison. On 2026-10-14 the owner removed that route: *"B copies cannot always trade due to
 *    the accounts already have a position so the system is flawed"* — the live two-arm design is
 *    being retired in favour of BACKTESTING ONLY, so both arms can act as if placing trades. The
 *    measurement route is now `POST /api/backtest/run` (#816, #823), not a live pair.
 *    Separately, the "identical P&L for both arms" blocker it cites was explained on 2026-10-06 —
 *    that pair differed only in `weightStrategy`, which is INERT (register row 31 / #1054), so no
 *    number of trades could have produced a difference. That is a different limit from throughput.
 * MISSING:  an owner decision on whether the exit chain may CLOSE a position (options A1–A4 in
 *    #1125). Nothing needs building to make it an actor — the capability exists here.
 * TODAY:    advisory. Measured 2026-10-15: no score- or signal-driven close has ever been recorded,
 *    and `broker:tp` has fired exactly ONCE in the whole trade history.
 * WHEN BUILT: if the owner chooses an acting option, treat it as MATHS (`maths-change-requires-ab`)
 *    and change this marker before the behaviour.
 */
@Controller('scoring/exit-consensus')
export class ExitConsensusController {
  constructor(private readonly exitConsensus: ExitConsensusService) {}

  @Get()
  async get(@Query('bot') bot?: string) {
    // ⚠️ Uses the STATUS-carrying variant. `assessAll()` returns `[]` for a FAILED broker read and
    // for an empty book alike, so a caller cannot tell "nothing is open" from "we could not look"
    // — and on 2026-10-01 that rendered 11 live positions as "No open positions to evaluate."
    const result = await this.exitConsensus.assessAllWithStatus();
    const all = result.assessments;
    // ⚠️ #1051 criterion 7 — filtered by BOT NAME, because the bot detail view asks "what would
    // close THIS bot's positions", and pulling every open position onto one bot's page both
    // over-fetches and invites the reader to attribute another bot's verdict to this one.
    // `assessment.bot` is the bot's NAME (`bot?.name ?? null`), not its id — matched exactly.
    const assessments = bot ? all.filter((a) => (a.bot ?? '') === bot) : all;
    return {
      asOf: new Date().toISOString(),
      bot: bot ?? null,
      count: assessments.length,
      /**
       * ⚠️ THE DENOMINATOR, plus the READ OUTCOME beside it. Without these `count: 0` cannot be
       * told apart from a failed broker read, and `assessAll` returns `[]` for BOTH. A bot page
       * showing "no open positions" when the bridge was unreachable is this repo's most-repeated
       * defect; `readOk` and `positionsRead` make the three cases distinguishable without a fake
       * success flag.
       */
      poolTotal: all.length,
      /** `false` = the broker read FAILED. Render that, never an empty list. */
      readOk: result.readOk,
      /** Why it failed, or `null`. */
      readError: result.readError,
      /** Positions the broker reported. `0` = read OK and nothing open; `null` = could not read. */
      positionsRead: result.positionsRead,
      /**
       * ⚠️ An empty array is INFORMATION (this bot holds nothing open), and must never be rendered
       * the same as a failed read. `ExitConsensusService.assessAll()` returns [] on a broker-read
       * failure too, so `count: 0` alone cannot distinguish them — the service logs which it was,
       * and this endpoint deliberately carries no fake success flag.
       */
      assessments,
    };
  }
}
