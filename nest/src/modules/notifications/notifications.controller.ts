/**
 * Notifications Controller
 * =========================
 * Endpoints for notification testing, preferences, and history.
 */

import { Controller, Get, Post, Put, Param, Body, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationService, NotificationPreference } from './notifications.service';
import type { NotificationChannel, NotificationPriority } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('preferences')
  @ApiOperation({ summary: 'Get current notification preferences' })
  getPreferences(): NotificationPreference[] {
    return this.notificationService.getPreferences();
  }

  /**
   * The global priority floor, returned WITH the preferences rather than as its own call.
   *
   * ⚠️ A settings surface that knows only "which events are on" cannot explain why a muted event
   * still arrives, or why an enabled one does not. The floor and the per-event priorities have to
   * be read together to be legible, so they travel together.
   */
  @Get('settings')
  @ApiOperation({ summary: 'Preferences plus the global priority floor' })
  getSettings() {
    return {
      preferences: this.notificationService.getPreferences(),
      minPriority: this.notificationService.getMinPriority(),
      priorities: ['critical', 'high', 'normal', 'low'],
      note:
        'minPriority suppresses anything quieter. Events marked mandatory (trade-disabled) are ' +
        'exempt — muting them would reproduce the outage they exist for.',
    };
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Update notification preferences' })
  async updatePreferences(@Body() prefs: NotificationPreference[]): Promise<{ ok: boolean }> {
    // ⚠️ `await` — the service now persists every rule through the settings registry, so a response
    // returned before the writes landed would report a save that had not happened.
    await this.notificationService.updatePreferences(prefs);
    return { ok: true };
  }

  @Put('min-priority')
  @ApiOperation({ summary: 'Set the global notification floor (critical | high | normal | low)' })
  async setMinPriority(@Body('minPriority') minPriority: NotificationPriority) {
    // Returns what it ACTUALLY became, not what was asked for — an invalid value is refused rather
    // than silently stored, and the caller can see the difference.
    //
    // ⚠️ `await` IS THE POINT (2026-10-05). The service now PERSISTS the floor through the settings
    // registry, so responding before the write lands would report a change that might not have been
    // saved — the same "accepted then forgotten" failure this change exists to fix.
    return { ok: true, minPriority: await this.notificationService.setMinPriority(minPriority) };
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
