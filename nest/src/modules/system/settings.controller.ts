import { Controller, Get, Put, Delete, Body, Logger, BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import type { AppSettings, HealthChecksConfig, UiReviewConfig, UiReviewEntry } from './settings.service';

@Controller('system/settings')
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(private readonly settings: SettingsService) {}

  @Get()
  async getSettings(): Promise<AppSettings> {
    return this.settings.get();
  }

  @Put()
  async updateSettings(@Body() body: Partial<AppSettings>): Promise<AppSettings> {
    this.logger.log(`Settings updated: ${Object.keys(body).join(', ')}`);
    return this.settings.update(body);
  }

  /** GET /api/system/settings/health-checks — read health check toggles. */
  @Get('health-checks')
  async getHealthChecks(): Promise<HealthChecksConfig> {
    return this.settings.getHealthChecks();
  }

  /** PUT /api/system/settings/health-checks — update health check toggles. */
  @Put('health-checks')
  async updateHealthChecks(@Body() body: Partial<HealthChecksConfig>): Promise<HealthChecksConfig> {
    this.logger.log(`Health checks updated: ${Object.keys(body).join(', ')}`);
    return this.settings.updateHealthChecks(body);
  }

  /** GET /api/system/settings/ui-review — every page verdict recorded so far. */
  @Get('ui-review')
  async getUiReview(): Promise<UiReviewConfig> {
    return this.settings.getUiReview();
  }

  /**
   * PUT /api/system/settings/ui-review — save ONE page's verdict, called on every interaction.
   *
   * ⚠️ The view key travels in the BODY, not the path. A view key IS a route with slashes in it
   * (`/trading/positions-monitor`), and an encoded slash in a path param is the kind of thing that
   * works locally and breaks behind a proxy. A body field has no such ambiguity.
   *
   * ⚠️ Unknown fields are NOT copied through: the patch is narrowed to the four things a verdict
   * has, so a malformed request cannot write arbitrary keys into the settings blob.
   */
  @Put('ui-review')
  async setUiReviewEntry(
    @Body() body: { viewKey?: string; patch?: Partial<UiReviewEntry> },
  ): Promise<UiReviewEntry> {
    if (!body?.viewKey) throw new BadRequestException('viewKey is required');
    const p = body.patch || {};
    const clean: Partial<UiReviewEntry> = {};
    if (p.importance === 'H' || p.importance === 'M' || p.importance === 'L' || p.importance === null) {
      clean.importance = p.importance;
    }
    if (typeof p.hide === 'boolean' || p.hide === null) clean.hide = p.hide;
    if (p.keen === 1 || p.keen === 2 || p.keen === 3 || p.keen === null) clean.keen = p.keen;
    if (typeof p.note === 'string') clean.note = p.note.slice(0, 2000);
    return this.settings.setUiReviewEntry(body.viewKey, clean);
  }

  /**
   * DELETE /api/system/settings/ui-review — clear ONE page's verdict, or ALL of them.
   *
   * ⚠️ #1040 — the store was write-only per key, so a verdict created by mistake could never be
   * removed. That is how the stray `__selftest__` key (written by this feature's own round-trip
   * verification) is still in `app-settings.json`.
   *
   * ⚠️ The view key travels in the BODY, for the same reason the PUT does it: a view key IS a route
   * with slashes in it (`/trading/positions-monitor`), and an encoded slash in a path param works
   * locally and breaks behind a proxy.
   *
   * ⚠️ `all: true` is REQUIRED to clear the whole table. An absent `viewKey` alone does NOT mean
   * "delete everything": a caller that forgets the field must not wipe the owner's whole walkthrough
   * by accident. The destructive case is opt-in and named.
   */
  @Delete('ui-review')
  async deleteUiReviewEntry(
    @Body() body: { viewKey?: string; all?: boolean },
  ): Promise<{ removed: string[] }> {
    if (!body?.viewKey && !body?.all) {
      throw new BadRequestException('viewKey is required, or all: true to clear every verdict');
    }
    const removed = await this.settings.deleteUiReviewEntry(body.all ? undefined : body.viewKey);
    this.logger.log(
      removed.removed.length > 0
        ? `UI review cleared: ${body.all ? `ALL (${removed.removed.length})` : removed.removed[0]}`
        : `UI review clear was a no-op — nothing stored for ${body.all ? 'the store' : body.viewKey}`,
    );
    return removed;
  }
}
