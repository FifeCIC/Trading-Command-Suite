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
// ⚠️ Alert rows are COLLAPSED, not inserted (2026-09-23) — one shared rule with
// AlertsService.addAlert(). See common/alerts/alert-collapse.ts for why.
import { collapseOrCreateAlert } from '../../common/alerts/alert-collapse';

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
  | 'trade-disabled'
  | 'test';

/**
 * HOW LOUD AN EVENT IS ALLOWED TO BE.
 *
 * ⚠️ Added 2026-09-27 at the owner's request: *"If there are priorities in our notifications then
 * offer those as a control too."* Until this existed the only control was per-event on/off, so the
 * unit of decision for the owner was "this exact event", and the real question they were asking was
 * "stop sending me routine bookkeeping".
 *
 *   critical — trading is IMPOSSIBLE, or money is at immediate risk. Never mutable.
 *   high     — a fault that needs a human but does not stop execution.
 *   normal   — a trade lifecycle event.
 *   low      — running commentary. Adjustments, pacing, housekeeping.
 */
export type NotificationPriority = 'critical' | 'high' | 'normal' | 'low';

export const PRIORITY_RANK: Record<NotificationPriority, number> = {
  critical: 4, high: 3, normal: 2, low: 1,
};

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
  /** How loud this event is. Drives the global `minPriority` floor. */
  priority: NotificationPriority;
  /**
   * ⚠️ A MANDATORY EVENT CANNOT BE DISABLED, and the reason is the failure this whole channel
   * exists for: AutoTrading was off for days, 19 orders were refused, and NOBODY KNEW. An owner
   * who mutes "trading is impossible" while tidying up a noisy list has reproduced that outage by
   * hand. `send()` refuses to honour `enabled: false` on these rather than trusting the caller.
   */
  mandatory?: boolean;
  /**
   * The floor this event sits under, so the settings surface can explain the number rather than
   * leaving the owner to guess why a muted event still arrives.
   */
  minPriority?: NotificationPriority;
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
  { event: 'entry-signal', channels: ['windows', 'telegram', 'discord'], enabled: true, priority: 'high' },
  { event: 'drawdown-warning', channels: ['windows', 'telegram'], enabled: true, priority: 'critical' },
  { event: 'daily-limit', channels: ['email', 'discord'], enabled: true, priority: 'critical' },
  { event: 'daily-summary', channels: ['email'], enabled: true, priority: 'low' },
  { event: 'backtest-complete', channels: ['telegram'], enabled: true, priority: 'low' },
  { event: 'provider-degraded', channels: ['windows', 'telegram', 'discord'], enabled: true, priority: 'high' },
  { event: 'dxy-regime-change', channels: ['windows', 'telegram', 'discord'], enabled: true, priority: 'normal' },
  { event: 'position-opened', channels: ['windows', 'telegram', 'discord'], enabled: true, priority: 'normal' },
  { event: 'position-closed', channels: ['windows', 'telegram', 'discord'], enabled: true, priority: 'normal' },
  // ⚠️ TURNED DOWN 2026-09-27, from the owner's report: *"So far I'm being updated on every stop
  // loss adjustment."* MEASURED the same day: the Stop Guardian was trailing stops on a CLOSED
  // market every ~30 seconds and the broker ACCEPTED every edit (#1011), so this event fired
  // continuously all weekend for a market that was not trading. `low` is the honest
  // classification — a stop adjustment is bookkeeping, not news — and the floor below mutes it by
  // default while leaving the event itself intact and re-enableable.
  { event: 'stop-adjusted', channels: ['windows', 'telegram'], enabled: false, priority: 'low' },
  { event: 'test', channels: ['windows', 'telegram', 'discord', 'email'], enabled: true, priority: 'low' },

  /**
   * ⚠️ THE EVENT THAT MATTERS MOST, AND IT DID NOT EXIST UNTIL 2026-09-27.
   *
   * Every MT5 terminal had AutoTrading OFF; 19 orders were refused `retcode 10027`; `decision_log`
   * held ONE execution in 48h — and every bridge reported `connected: true` the whole time, so
   * `provider-degraded` correctly stayed silent. Nothing told anyone. The app looked healthy.
   *
   * `mandatory: true` because muting it reproduces that outage exactly.
   */
  { event: 'trade-disabled', channels: ['windows'], enabled: true, priority: 'critical', mandatory: true },
];

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private history: NotificationHistoryEntry[] = [];
  private preferences: NotificationPreference[] = [...DEFAULT_PREFERENCES];

  /**
   * THE GLOBAL FLOOR — nothing quieter than this is delivered, on any channel.
   *
   * ⚠️ Defaults to `'low'`, which suppresses NOTHING. That is deliberate: a control that starts
   * active and silent would look identical to a broken notification system, and the owner asked for
   * this to REDUCE noise they chose, not to have noise removed on their behalf. `'critical'` is what
   * mutes the routine traffic — and `trade-disabled` is exempt from the floor entirely.
   */
  private minPriority: NotificationPriority = 'low';
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

    // ⚠️ A MANDATORY EVENT IGNORES `enabled: false`, AND THAT IS ENFORCED HERE RATHER THAN TRUSTED.
    // `trade-disabled` means no order can be placed. An owner tidying a noisy list is exactly the
    // person who would switch it off, and switching it off reproduces the outage it exists for —
    // 19 refusals and ONE execution, with the app reporting healthy throughout. The refusal is
    // LOGGED, not silent, because a setting that appears to work and does not is worse than one
    // that cannot be set.
    if (prefs?.mandatory && !prefs.enabled) {
      this.logger.warn(
        `Refusing to mute mandatory notification "${msg.event}" — it is sent regardless of the stored preference.`,
      );
    } else if (!prefs || !prefs.enabled) {
      this.logger.debug(`Notification disabled for event: ${msg.event}`);
      return;
    }

    // ── The priority floor ──
    // ⚠️ AND MANDATORY EVENTS ARE EXEMPT FROM IT. `minPriority: 'critical'` is a legitimate thing
    // for the owner to choose and it must not take `trade-disabled` with it — the floor is a
    // convenience control, and no convenience control is allowed to silence "you cannot trade".
    if (!prefs?.mandatory && prefs) {
      const floor = PRIORITY_RANK[this.minPriority];
      if (PRIORITY_RANK[prefs.priority] < floor) {
        this.logger.debug(
          `Notification suppressed by minPriority=${this.minPriority}: ${msg.event} is ${prefs.priority}`,
        );
        return;
      }
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
   *
   * ⚠️ COLLAPSED, not inserted (2026-09-23). A trailing stop that creeps every cadence window
   * produced 50 `Stop adjusted — EURCAD` rows in two days; the same shape across symbols put
   * hundreds of undismissed rows in the bell. `collapseOrCreateAlert()` folds a repeat into the
   * existing row (`lastSeenAt`, `repeatCount`, latest detail). The per-event record is NOT lost:
   * closes live in the `trade` table, adjustments in `stop_adjustment`, and both are untouched.
   * The real-time channels (windows/telegram/discord) still fire on EVERY event — only the
   * attention row collapses.
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

    await collapseOrCreateAlert(this.prisma, {
      type: map.type,
      title: msg.title,
      detail: msg.body,
      severity,
      ticker: msg.symbol ?? null,
      link: map.link ?? null,
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

  /** The global floor, so a settings surface can show it rather than assume its default. */
  getMinPriority(): NotificationPriority {
    return this.minPriority;
  }

  /**
   * Update the floor. Returns what it actually became, so a caller cannot report a change that was
   * rejected — the same reason `notify()` returns a boolean rather than void.
   */
  setMinPriority(priority: NotificationPriority): NotificationPriority {
    if (PRIORITY_RANK[priority] == null) {
      this.logger.warn(`Ignoring unknown minPriority "${priority}" — keeping "${this.minPriority}".`);
      return this.minPriority;
    }
    this.minPriority = priority;
    this.logger.log(`Notification floor set to "${priority}".`);
    return this.minPriority;
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
