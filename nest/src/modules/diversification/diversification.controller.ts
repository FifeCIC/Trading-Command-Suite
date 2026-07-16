/**
 * DiversificationController
 * ==========================
 * REST API for global cross-broker diversification.
 *
 * Endpoints:
 *   GET  /api/diversification/summary   — full diversification overview
 *   GET  /api/diversification/settings  — global settings
 *   PUT  /api/diversification/settings  — update settings
 *   GET  /api/diversification/check?symbol=X&brokerId=Y — pre-trade check
 */

import { Controller, Get, Put, Query, Body, Logger } from '@nestjs/common';
import { GlobalDiversificationService } from './global-diversification.service';

@Controller('diversification')
export class DiversificationController {
  private readonly logger = new Logger(DiversificationController.name);

  constructor(private readonly diversificationService: GlobalDiversificationService) {}

  @Get('summary')
  async getSummary() {
    return this.diversificationService.getDiversificationSummary();
  }

  @Get('settings')
  async getSettings() {
    return this.diversificationService.getSettings();
  }

  @Put('settings')
  async updateSettings(@Body() body: Record<string, string>) {
    await this.diversificationService.updateSettings(body);
    return { success: true };
  }

  @Get('check')
  async checkPreTrade(
    @Query('symbol') symbol: string,
    @Query('brokerId') brokerId: string,
  ) {
    if (!symbol) return { error: 'symbol query parameter required' };
    return this.diversificationService.checkPreTrade(
      symbol,
      brokerId || 'mt5',
    );
  }
}
