import { Controller, Get, Post, Body } from '@nestjs/common';
import { StopGuardianService, DEFAULT_TICK_INTERVAL_MS } from './stop-guardian.service';
import { SettingsResolverService } from '../../common/settings/settings-resolver.service';

@Controller('automation/stop-guardian')
export class StopGuardianController {
  constructor(
    private readonly guardian: StopGuardianService,
    private readonly settings: SettingsResolverService,
  ) {}

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

  /**
   * POST /api/automation/stop-guardian/interval — change the cadence, PERSISTED.
   *
   * ⚠️ 2026-11-06 — THIS USED TO SET `state.tickIntervalMs` ONLY, so the value was lost on restart
   * and the setting that now drives the cadence would have silently overwritten it on the next tick.
   * It writes through `SettingsResolverService.set()`, which validates against the registry, and
   * then applies it immediately; the guardian re-reads it every tick anyway, so the two agree.
   */
  @Post('interval')
  async setInterval(@Body() body: { ms: number }) {
    const written = await this.settings.set('automation.guardianTickIntervalMs', body?.ms);
    const applied = await this.guardian.syncIntervalFromSettings();
    return { intervalMs: applied, persisted: true, defaultValue: DEFAULT_TICK_INTERVAL_MS, setting: written?.key ?? 'automation.guardianTickIntervalMs' };
  }
}
