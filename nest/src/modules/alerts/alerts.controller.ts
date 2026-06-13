import { Controller, Get, Post, Param, Put, Body, Query, Logger } from '@nestjs/common';
import { AlertsService, Alert, AlertConfig } from './alerts.service';

@Controller('alerts')
export class AlertsController {
  private readonly logger = new Logger(AlertsController.name);

  constructor(private readonly alertsService: AlertsService) {}

  @Get('active')
  getActive(): Alert[] {
    return this.alertsService.getActive();
  }

  @Get('history')
  getHistory(@Query('limit') limit?: string): Alert[] {
    return this.alertsService.getHistory(Number(limit) || 50);
  }

  @Get('count')
  getCount() {
    return this.alertsService.getAlertCount();
  }

  @Post(':id/acknowledge')
  acknowledge(@Param('id') id: string) {
    const result = this.alertsService.acknowledge(id);
    if (!result) return { error: 'Alert not found' };
    this.logger.log(`Alert acknowledged: ${id}`);
    return result;
  }

  @Post(':id/dismiss')
  dismiss(@Param('id') id: string) {
    const result = this.alertsService.dismiss(id);
    if (!result) return { error: 'Alert not found' };
    this.logger.log(`Alert dismissed: ${id}`);
    return result;
  }

  @Post(':id/snooze')
  snooze(@Param('id') id: string, @Body() body?: { minutes?: number }) {
    const result = this.alertsService.snooze(id, body?.minutes || 15);
    if (!result) return { error: 'Alert not found' };
    return result;
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
