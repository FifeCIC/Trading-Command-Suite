import { Controller, Get } from '@nestjs/common';
import { ProgressionService } from './progression.service';

/**
 * GET /api/progression — the earned level, the XP behind it, and the active-bot ceiling.
 *
 * ⚠️ TWO RESPONSE STATES, and they must never look alike:
 *   status: 'ok'          — the level was computed; every number below it is measured
 *   status: 'unavailable' — the counts could not be read; `reason` says why, and NO level is claimed
 *
 * The panel renders those differently on purpose. Collapsing them would show "Level 1" to an
 * established operator the moment a table was unavailable — a confident, wrong number, on the
 * surface that explains why a bot could not be activated.
 */
@Controller('progression')
export class ProgressionController {
  constructor(private readonly progression: ProgressionService) {}

  @Get()
  async get() {
    return this.progression.getView();
  }
}
