/**
 * Notification Service — Multi-channel alert dispatcher
 * ======================================================
 * Sends alerts via email, Windows toast, Telegram bot, and Discord webhook.
 * Supports configurable rules for which events trigger which channels.
 */

import { Injectable, Logger } from '@nestjs/common';
import { EmailChannel } from './channels/email.channel';
import { WindowsChannel } from './channels/windows.channel';
import { TelegramChannel } from './channels/telegram.channel';
import { DiscordChannel } from './channels/discord.channel';

export type NotificationChannel = 'email' | 'windows' | 'telegram' | 'discord';
export type NotificationEvent =
  | 'entry-signal'
  | 'drawdown-warning'
  | 'daily-limit'
  | 'daily-summary'
  | 'backtest-complete'
  | 'provider-degraded'
  | 'dxy-regime-change'
  | 'position-opened'
  | 'position-closed'
  | 'stop-adjusted'
  | 'test';

export interface NotificationMessage {
  title: string;
  body: string;
  symbol?: string;
  score?: number;
  event: NotificationEvent;
  metadata?: Record<string, unknown>;
}

export interface NotificationPreference {
  event: NotificationEvent;
  channels: NotificationChannel[];
  enabled: boolean;
}

export interface NotificationHistoryEntry {
  id: string;
  timestamp: Date;
  channel: NotificationChannel;
  event: NotificationEvent;
  title: string;
  status: 'sent' | 'failed';
  error?: string;
}

const DEFAULT_PREFERENCES: NotificationPreference[] = [
  { event: 'entry-signal', channels: ['windows', 'telegram', 'discord'], enabled: true },
  { event: 'drawdown-warning', channels: ['windows', 'telegram'], enabled: true },
  { event: 'daily-limit', channels: ['email', 'discord'], enabled: true },
  { event: 'daily-summary', channels: ['email'], enabled: true },
  { event: 'backtest-complete', channels: ['telegram'], enabled: true },
  { event: 'provider-degraded', channels: ['windows', 'telegram', 'discord'], enabled: true },
  { event: 'dxy-regime-change', channels: ['windows', 'telegram', 'discord'], enabled: true },
  { event: 'position-opened', channels: ['windows', 'telegram', 'discord'], enabled: true },
  { event: 'position-closed', channels: ['windows', 'telegram', 'discord'], enabled: true },
  { event: 'stop-adjusted', channels: ['windows', 'telegram'], enabled: true },
  { event: 'test', channels: ['windows', 'telegram', 'discord', 'email'], enabled: true },
];

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private history: NotificationHistoryEntry[] = [];
  private preferences: NotificationPreference[] = [...DEFAULT_PREFERENCES];
  private emailRateLimit = 0; // 0 = not rate limited
  private lastEmailSent = 0;

  constructor(
    private readonly emailChannel: EmailChannel,
    private readonly windowsChannel: WindowsChannel,
    private readonly telegramChannel: TelegramChannel,
    private readonly discordChannel: DiscordChannel,
  ) {}

  private getChannel(channel: NotificationChannel) {
    switch (channel) {
      case 'email': return this.emailChannel;
      case 'windows': return this.windowsChannel;
      case 'telegram': return this.telegramChannel;
      case 'discord': return this.discordChannel;
    }
  }

  /** Send a notification through all enabled channels for this event type. */
  async send(msg: NotificationMessage): Promise<void> {
    const prefs = this.preferences.find((p) => p.event === msg.event);

    if (!prefs || !prefs.enabled) {
      this.logger.debug(`Notification disabled for event: ${msg.event}`);
      return;
    }

    for (const channelId of prefs.channels) {
      const channel = this.getChannel(channelId);
      if (!channel) continue;

      // Rate limit: email max once per 15 minutes
      if (channelId === 'email') {
        const now = Date.now();
        if (now - this.lastEmailSent < 15 * 60_000) {
          this.logger.debug('Email rate limited — skipping');
          continue;
        }
      }

      try {
        await channel.send(msg);
        this.history.push({
          id: `${channelId}-${Date.now()}`,
          timestamp: new Date(),
          channel: channelId,
          event: msg.event,
          title: msg.title,
          status: 'sent',
        });
        this.logger.log(`Notification sent via ${channelId}: ${msg.title}`);

        if (channelId === 'email') {
          this.lastEmailSent = Date.now();
        }
      } catch (err) {
        const errorMsg = (err as Error).message;
        this.logger.error(`Notification failed via ${channelId}: ${errorMsg}`);
        this.history.push({
          id: `${channelId}-${Date.now()}-fail`,
          timestamp: new Date(),
          channel: channelId,
          event: msg.event,
          title: msg.title,
          status: 'failed',
          error: errorMsg,
        });

        // Retry failed once after 5 minutes
        setTimeout(async () => {
          try {
            await channel.send(msg);
            this.logger.log(`Retry succeeded for ${channelId}: ${msg.title}`);
          } catch {
            this.logger.warn(`Retry failed for ${channelId}: ${msg.title}`);
          }
        }, 5 * 60_000);
      }
    }
  }

  /** Get notification history. */
  getHistory(limit = 20): NotificationHistoryEntry[] {
    return this.history.slice(-limit).reverse();
  }

  /** Get current notification preferences. */
  getPreferences(): NotificationPreference[] {
    return this.preferences;
  }

  /** Update notification preferences. */
  updatePreferences(prefs: NotificationPreference[]): void {
    this.preferences = prefs;
    this.logger.log(`Notification preferences updated: ${prefs.length} rules`);
  }

  /** Send a test notification to a specific channel. */
  async sendTest(channel: NotificationChannel): Promise<boolean> {
    const msg: NotificationMessage = {
      title: '🔔 SEES Notification Test',
      body: 'This is a test notification from the SEES Trading System.',
      event: 'test',
      metadata: { timestamp: new Date().toISOString() },
    };
    try {
      const ch = this.getChannel(channel);
      if (!ch) return false;
      await ch.send(msg);
      return true;
    } catch (err) {
      this.logger.error(`Test notification failed via ${channel}: ${(err as Error).message}`);
      return false;
    }
  }

  // ── Convenience wrappers called by other modules ──

  async notifyEntrySignal(symbol: string, score: number): Promise<void> {
    await this.send({
      title: `🔔 ${symbol} — Entry Signal`,
      body: `Score: ${score} | Confidence: high`,
      symbol,
      score,
      event: 'entry-signal',
    });
  }

  async notifyDrawdown(source: string, drawdownPct: number, level: string): Promise<void> {
    await this.send({
      title: `⚠️ Drawdown Warning — ${source}`,
      body: `Drawdown: ${drawdownPct.toFixed(1)}% | Level: ${level}`,
      event: 'drawdown-warning',
      metadata: { drawdown: drawdownPct, level, source },
    });
  }

  async notifyDailySummary(suggestions: Array<{ symbol: string; score: number; action?: string }>): Promise<void> {
    const top = suggestions.slice(0, 3).map((s) => `${s.symbol}: ${s.score}`).join(', ');
    await this.send({
      title: '📈 Daily Trading Summary',
      body: `Top signals: ${top || 'none'}`,
      event: 'daily-summary',
      metadata: { suggestions },
    });
  }

  async notifyBacktestComplete(symbol: string, winRate: number): Promise<void> {
    await this.send({
      title: `📊 Backtest Complete: ${symbol}`,
      body: `${symbol} backtest done — Win Rate: ${(winRate * 100).toFixed(0)}%`,
      symbol,
      event: 'backtest-complete',
      metadata: { winRate: `${(winRate * 100).toFixed(0)}%` },
    });
  }
}
