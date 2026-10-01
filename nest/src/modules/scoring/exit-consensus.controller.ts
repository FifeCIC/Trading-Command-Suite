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
