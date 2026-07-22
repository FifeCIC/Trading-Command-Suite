import { Controller, Get, Post, Param, Put, Body, Query, Logger } from '@nestjs/common';
import { AlertsService, Alert, AlertConfig } from './alerts.service';

@Controller('alerts')
export class AlertsController {
  private readonly logger = new Logger(AlertsController.name);

  constructor(private readonly alertsService: AlertsService) {}

  @Get('active')
  async getActive() {
    return this.alertsService.getActiveAsync();
  }

  @Get('history')
  getHistory(@Query('limit') limit?: string): Alert[] {
    return this.alertsService.getHistory(Number(limit) || 50);
  }

  @Get('count')
  async getCount() {
    return this.alertsService.getAlertCount();
  }

  @Post(':id/acknowledge')
  async acknowledge(@Param('id') id: string) {
    const ok = await this.alertsService.acknowledge(id);
    if (!ok) return { error: 'Alert not found' };
    return { success: true };
  }

  @Post(':id/dismiss')
  async dismiss(@Param('id') id: string) {
    const ok = await this.alertsService.dismiss(id);
    if (!ok) return { error: 'Alert not found' };
    return { success: true };
  }

  @Post(':id/snooze')
  snooze(@Param('id') id: string, @Body() body?: { minutes?: number }) {
    return { error: 'Snooze not yet implemented for DB-backed alerts' };
  }

  @Get('config')
  getConfig(): AlertConfig[] {
    return this.alertsService.getConfig();
  }

  @Put('config/:id')
  updateConfig(@Param('id') id: string, @Body() updates: Partial<AlertConfig>) {
    const result = this.alertsService.updateConfig(id, updates);
    if (!result) return { error: 'Config not found' };
    return result;
  }
}
