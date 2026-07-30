import { Controller, Post, Logger } from '@nestjs/common';
import { DirectivesService } from '../directives/directives.service';
import { ProtocolDbService } from '../scoring/protocol-db.service';

/**
 * Config Reload Controller — on-demand hot-reload of in-memory registries.
 *
 * POST /api/system/reload-config
 *
 * ── Two-Tier Config Reload Policy (2026-07-29, #509) ─────────────────
 *
 * TIER 1 — Hot Reload (POST /api/system/reload-config, ~20ms):
 *   ✅ Toggle directive active/inactive
 *   ✅ Update directive weights / maxScore
 *   ✅ Change protocol status (active/inactive)
 *   ✅ Modify scoring strategy thresholds
 *   ✅ Update settings (DB-read, always fresh)
 *   ✅ Trading strategy config changes
 *   No restart needed. Takes effect on next scoring tick.
 *
 * TIER 2 — Full Restart Required:
 *   ❌ New directive TypeScript class (compiled code, must re-register)
 *   ❌ Protocol group restructure (new directive-to-group relationships)
 *   ❌ New provider adapter registration
 *   ❌ Calibration override changes (in-memory cache, startup only)
 *   ❌ Prisma schema changes (migration + rebuild)
 *   ❌ Environment variable changes (.env)
 *
 * ── UI Guidance ──────────────────────────────────────────────────────
 * The MetaStackStatusPage "Reload Config" button handles Tier 1.
 * For Tier 2 changes, the UI should show "Restart Required" indicator.
 * The /api/system/reload-config response includes a `note` field
 * explaining what was reloaded and what still needs a restart.
 *
 * @see docs/handoff/2026-07-29-config-reload-policy-509.md
 */
@Controller('system')
export class ConfigReloadController {
  private readonly logger = new Logger(ConfigReloadController.name);

  constructor(
    private readonly directivesService: DirectivesService,
    private readonly protocolDbService: ProtocolDbService,
  ) {}

  @Post('reload-config')
  async reloadConfig() {
    const reloaded: string[] = [];
    const warnings: string[] = [];
    const start = Date.now();

    // 1. Reload directive metadata (active status, weight overrides)
    try {
      await this.directivesService.loadDirectiveMetadata();
      reloaded.push('directives');
      this.logger.log('Directive metadata reloaded from DB');
    } catch (err) {
      warnings.push(`directives: ${(err as Error).message}`);
      this.logger.error(`Failed to reload directives: ${(err as Error).message}`);
    }

    // 2. Reload protocol cache (protocol definitions, groups, entries)
    try {
      await this.protocolDbService.preloadAll();
      reloaded.push('protocols');
      this.logger.log('Protocol cache reloaded from DB');
    } catch (err) {
      warnings.push(`protocols: ${(err as Error).message}`);
      this.logger.error(`Failed to reload protocols: ${(err as Error).message}`);
    }

    // 3. Scoring strategies auto-pick up new thresholds on next rankAll() call
    //    — no explicit cache to clear; the DB-read path always queries fresh.

    const ms = Date.now() - start;
    this.logger.log(`Config reload complete in ${ms}ms: ${reloaded.join(', ')}${warnings.length ? ` (${warnings.length} warnings)` : ''}`);

    return {
      success: warnings.length === 0,
      reloaded,
      warnings: warnings.length > 0 ? warnings : undefined,
      ms,
      timestamp: new Date().toISOString(),
      note: 'Directives and protocols reloaded from DB. Scoring strategies pick up new thresholds on the next scoring tick. For new directive classes, protocol group changes, or schema changes, a full restart is still required.',
    };
  }
}
