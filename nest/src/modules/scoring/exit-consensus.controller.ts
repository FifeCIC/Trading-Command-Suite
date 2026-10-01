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
 *            cannot reach a verdict in useful time: `MAX_AB_SYMBOLS = 4` and ONE ACTIVE TEST at a
 *            time across 27 bots, so a controlled exit comparison needs weeks for a readable sample.
 *            A change that cannot be MEASURED must not be made on a money path, however good the
 *            reasoning for it looks.
 *            ⚠️ CORRECTED 2026-10-01. This marker first said #929 blocked the monitor via the
 *            `metastack_snapshot.mode` conflation. **That was fixed on 2026-09-23** —
 *            `resolveTradeAuthority()` reads the mode from the BOT, and `ab-trade-authority.spec.ts`
 *            locks it. The claim was carried from `maths-change-requires-ab.instructions.md`,
 *            which was itself stale, and reached this file without being re-measured. Measured
 *            2026-10-01: `ab_test` = 2 rows, **122 trades tagged** `abTestId` — the runner works.
 * INSTEAD OF: Giving the chain authority now — the owner's R29 asked for "an advanced exit process",
 *            and a computed-but-unused verdict is a fair reading of that as unfinished.
 * REVERSE BY: Fix #929, create a copied configuration (`maths-change-requires-ab`), run the
 *            comparison, then set the action. One line of behaviour, once it is measurable.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 54
 * GUARD:     NONE — nothing fails if a future change starts acting on `action`. 🔴 UNGUARDED, and
 *            said plainly rather than implied.
 */
@Controller('scoring/exit-consensus')
export class ExitConsensusController {
  constructor(private readonly exitConsensus: ExitConsensusService) {}

  @Get()
  async get(@Query('bot') bot?: string) {
    const all = await this.exitConsensus.assessAll();
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
       * ⚠️ THE DENOMINATOR. Without it `count: 0` cannot be told apart from a failed broker read,
       * and `assessAll()` returns `[]` for BOTH. A bot page showing "no open positions" when the
       * bridge was unreachable is this repo's most-repeated defect; `poolTotal` makes the two
       * distinguishable without a fake success flag.
       */
      poolTotal: all.length,
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
