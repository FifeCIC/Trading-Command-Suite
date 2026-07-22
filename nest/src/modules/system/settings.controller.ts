import { Controller, Get, Put, Body, Logger } from '@nestjs/common';
import { SettingsService } from './settings.service';
import type { AppSettings, HealthChecksConfig } from './settings.service';

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
}
