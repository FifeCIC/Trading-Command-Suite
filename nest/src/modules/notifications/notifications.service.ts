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
import { PrismaService } from '../../database/prisma.service';

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

/** Which events also surface as persisted Alert rows in the Alert Center. */
const ALERT_EVENT_MAP: Record<
  string,
  { type: string; severity: 'critical' | 'warning' | 'info' | 'success'; link?: string }
> = {
  'position-opened': { type: 'system', severity: 'info', link: '/lab/position-lifecycle' },
  'position-closed': { type: 'system', severity: 'info', link: '/lab/position-lifecycle' },
  'stop-adjusted': { type: 'system', severity: 'info', link: '/lab/position-lifecycle' },
  'drawdown-warning': { type: 'drawdown', severity: 'warning' },
  'daily-limit': { type: 'daily', severity: 'critical' },
  'provider-degraded': { type: 'system', severity: 'warning' },
  'dxy-regime-change': { type: 'system', severity: 'info' },
};

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
    private readonly prisma?: PrismaService,
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

    // Persist important events as Alert rows so they survive restarts and
    // surface in the Alert Center (#612 / position lifecycle).
    await this.persistAlert(msg);

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

  /**
   * Persist a notification as an Alert row (fire-and-forget) so important
   * events survive restarts and appear in the Alert Center. Only mapped
   * events are persisted — high-frequency events (entry-signal, daily-summary)
   * are intentionally excluded to avoid flooding.
   */
  private async persistAlert(msg: NotificationMessage): Promise<void> {
    const map = ALERT_EVENT_MAP[msg.event];
    if (!map || !this.prisma?.isAvailable) return;

    let severity = map.severity;
    // A closed position's severity reflects whether it won or lost.
    if (msg.event === 'position-closed') {
      const pnl = Number(msg.metadata?.pnl ?? NaN);
      if (Number.isFinite(pnl)) severity = pnl >= 0 ? 'success' : 'warning';
    }

    await this.prisma.alert.create({
      data: {
        type: map.type,
        title: msg.title,
        detail: msg.body,
        severity,
        ticker: msg.symbol ?? null,
        link: map.link ?? null,
      },
    }).catch((err) => {
      this.logger.debug(`Alert persist failed: ${(err as Error).message}`);
    });
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
