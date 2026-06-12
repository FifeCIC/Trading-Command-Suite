/**
 * Notifications Controller
 * =========================
 * Endpoints for notification testing, preferences, and history.
 */

import { Controller, Get, Post, Put, Param, Body, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationService, NotificationPreference } from './notifications.service';
import type { NotificationChannel } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('preferences')
  @ApiOperation({ summary: 'Get current notification preferences' })
  getPreferences(): NotificationPreference[] {
    return this.notificationService.getPreferences();
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Update notification preferences' })
  updatePreferences(@Body() prefs: NotificationPreference[]): { ok: boolean } {
    this.notificationService.updatePreferences(prefs);
    return { ok: true };
  }

  @Post('test')
  @ApiOperation({ summary: 'Send a test notification to a channel' })
  async sendTest(@Query('channel') channel: NotificationChannel): Promise<{ ok: boolean }> {
    const ok = await this.notificationService.sendTest(channel);
    return { ok };
  }

  @Get('history')
  @ApiOperation({ summary: 'Get notification history' })
  getHistory(@Query('limit') limit?: string) {
    return this.notificationService.getHistory(limit ? parseInt(limit, 10) : 20);
  }
}
