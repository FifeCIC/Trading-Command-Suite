import { Controller, Get, Put, Body, Logger } from '@nestjs/common';
import { SettingsService } from './settings.service';
import type { AppSettings } from './settings.service';

@Controller('system/settings')
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(private readonly settings: SettingsService) {}

  @Get()
  getSettings(): AppSettings {
    return this.settings.get();
  }

  @Put()
  updateSettings(@Body() body: Partial<AppSettings>): AppSettings {
    this.logger.log(`Settings updated: ${Object.keys(body).join(', ')}`);
    return this.settings.update(body);
  }
}
