import { Controller, Get, Post, Body } from '@nestjs/common';
import { StopGuardianService } from './stop-guardian.service';

@Controller('automation/stop-guardian')
export class StopGuardianController {
  constructor(private readonly guardian: StopGuardianService) {}

  /** GET /api/automation/stop-guardian/status */
  @Get('status')
  getStatus() {
    return this.guardian.getState();
  }

  /** POST /api/automation/stop-guardian/start */
  @Post('start')
  start() {
    return this.guardian.start();
  }

  /** POST /api/automation/stop-guardian/stop */
  @Post('stop')
  stop() {
    return this.guardian.stop();
  }

  /** POST /api/automation/stop-guardian/run-now */
  @Post('run-now')
  async runNow() {
    return this.guardian.runNow();
  }

  /** POST /api/automation/stop-guardian/interval */
  @Post('interval')
  setInterval(@Body() body: { ms: number }) {
    this.guardian.state.tickIntervalMs = body.ms;
    return { intervalMs: this.guardian.state.tickIntervalMs };
  }
}
