import { Controller, Get, Post, Delete, Param, Put, Body, Query, Logger } from '@nestjs/common';
import { AlertsService, Alert, AlertConfig } from './alerts.service';

@Controller('alerts')
export class AlertsController {
  private readonly logger = new Logger(AlertsController.name);

  constructor(private readonly alertsService: AlertsService) {}

  @Get('active')
  async getActive() {
    return this.alertsService.getActiveAsync();
  }

  /** GET /api/alerts/history — dismissed/aged-out alerts, newest first (DB-backed since 2026-09-23). */
  @Get('history')
  async getHistory(@Query('limit') limit?: string): Promise<Alert[]> {
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

  /** POST /api/alerts/dismiss-all — bulk dismiss all active alerts */
  @Post('dismiss-all')
  async dismissAll() {
    const count = await this.alertsService.dismissAll();
    return { dismissed: count };
  }

  /** DELETE /api/alerts/cleanup — remove old/dismissed alerts beyond retention */
  @Delete('cleanup')
  async cleanup(@Query('retainDays') retainDays?: string) {
    const days = parseInt(retainDays || '7', 10);
    const deleted = await this.alertsService.cleanupOld(days);
    return { deleted, retainDays: days };
  }

  /** PUT /api/alerts/settings — update notification preferences */
  @Put('settings')
  async updateSettings(@Body() body: { maxAlerts?: number; autoDismissDays?: number; mutedTypes?: string[] }) {
    return this.alertsService.updateNotificationSettings(body);
  }

  /** GET /api/alerts/settings — get notification preferences */
  @Get('settings')
  async getSettings() {
    return this.alertsService.getNotificationSettings();
  }
}
