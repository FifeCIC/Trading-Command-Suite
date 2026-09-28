import { Controller, Get } from '@nestjs/common';
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
  async get() {
    const assessments = await this.exitConsensus.assessAll();
    return {
      asOf: new Date().toISOString(),
      count: assessments.length,
      /**
       * ⚠️ An empty array is INFORMATION (no open bot positions), and must never be rendered the
       * same as a failed read. `ExitConsensusService.assessAll()` returns [] on a broker-read
       * failure too, so `count: 0` alone cannot distinguish them — the service logs which it was,
       * and this endpoint deliberately carries no fake success flag.
       */
      assessments,
    };
  }
}
