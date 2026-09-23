import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
// ⚠️ The collapse rule lives in ONE place, shared with NotificationsService.persistAlert().
import { collapseOrCreateAlert } from '../../common/alerts/alert-collapse';

export type AlertSeverity = 'critical' | 'high' | 'warning' | 'info';
export type AlertCategory = 'system' | 'data' | 'trading';
export type AlertStatus = 'active' | 'acknowledged' | 'dismissed';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  timestamp: Date;
  status: AlertStatus;
  acknowledgedAt?: Date;
  dismissedAt?: Date;
  snoozedUntil?: Date;
  source?: string;
}

export interface AlertConfig {
  id: string;
  enabled: boolean;
  severity: AlertSeverity;
  channels: string[];
  throttleCount: number;
  throttleMinutes: number;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private configs: AlertConfig[] = [];

  constructor(private readonly prisma: PrismaService) {
    this.seedConfigs();
  }

  private seedConfigs() {
    const defaults: AlertConfig[] = [
      { id: 'mt5-bridge', enabled: true, severity: 'critical', channels: ['in-app', 'sound'], throttleCount: 3, throttleMinutes: 10 },
      { id: 'api-rate-limit', enabled: true, severity: 'warning', channels: ['in-app'], throttleCount: 5, throttleMinutes: 15 },
      { id: 'data-staleness', enabled: true, severity: 'warning', channels: ['in-app'], throttleCount: 3, throttleMinutes: 30 },
      { id: 'high-conviction-signal', enabled: true, severity: 'info', channels: ['in-app'], throttleCount: 10, throttleMinutes: 60 },
      { id: 'backend-down', enabled: true, severity: 'critical', channels: ['in-app', 'sound'], throttleCount: 2, throttleMinutes: 5 },
      { id: 'db-connection', enabled: true, severity: 'high', channels: ['in-app'], throttleCount: 3, throttleMinutes: 10 },
      { id: 'strategy-executed', enabled: true, severity: 'info', channels: ['in-app'], throttleCount: 20, throttleMinutes: 60 },
      { id: 'stop-loss-hit', enabled: true, severity: 'high', channels: ['in-app', 'sound'], throttleCount: 5, throttleMinutes: 30 },
    ];
    this.configs = defaults;
  }

  getActive(): Alert[] {
    return []; // Fallback — alerts are now DB-backed via getActiveAsync
  }

  /**
   * getActiveAsync() — the undismissed, un-snoozed alerts, MOST RECENTLY OBSERVED first.
   *
   * ⚠️ Ordered by `lastSeenAt`, not `createdAt` (2026-09-23). A condition that started ten days
   * ago and is STILL TRUE right now (a bridge that keeps dropping, data that keeps going stale)
   * is the most urgent thing on the surface — but under `createdAt DESC` it sank below every
   * newer one-off, which is exactly backwards for an attention list.
   */
  async getActiveAsync() {
    if (!this.prisma.isAvailable) return [];
    try {
      return await (this.prisma as any).alert.findMany({
        where: {
          dismissed: false,
          OR: [
            { snoozedUntil: null },
            { snoozedUntil: { lt: new Date() } },
          ],
        },
        orderBy: { lastSeenAt: 'desc' },
        take: 100,
      });
    } catch (err) {
      this.logger.warn(`getActiveAsync failed: ${err}`);
      return [];
    }
  }

  /**
   * getHistory() — alerts that have been dismissed or aged out, newest first.
   *
   * ⚠️ THIS RETURNED `[]` BY CONSTRUCTION until 2026-09-23 — `return []; // Fallback - now
   * DB-backed` was a migration that never happened, documented for weeks in the Architecture
   * Framework as *"12,665 rows are unreachable behind a comment that names a capability the code
   * does not have"*. Dismissing an alert removed it from every surface with no record kept: the
   * exact "plausible output, no error" shape this repo keeps re-finding.
   */
  async getHistory(limit = 50): Promise<any[]> {
    if (!this.prisma.isAvailable) return [];
    try {
      return await (this.prisma as any).alert.findMany({
        where: { dismissed: true },
        orderBy: { lastSeenAt: 'desc' },
        take: Math.min(Math.max(Number(limit) || 50, 1), 500),
      });
    } catch (err) {
      this.logger.warn(`getHistory failed: ${(err as Error).message}`);
      return [];
    }
  }

  async acknowledge(id: string): Promise<boolean> {
    if (!this.prisma.isAvailable) return false;
    try {
      await (this.prisma as any).alert.update({
        where: { id },
        data: { acknowledged: true, readAt: new Date() },
      });
      return true;
    } catch { return false; }
  }

  async dismiss(id: string): Promise<boolean> {
    if (!this.prisma.isAvailable) return false;
    try {
      await (this.prisma as any).alert.update({
        where: { id },
        data: { dismissed: true },
      });
      return true;
    } catch { return false; }
  }

  snooze(id: string, minutes = 15): Alert | null {
    return null; // Now DB-backed
  }

  getConfig(): AlertConfig[] {
    return this.configs;
  }

  updateConfig(id: string, updates: Partial<AlertConfig>): AlertConfig | null {
    const config = this.configs.find((c) => c.id === id);
    if (config) { Object.assign(config, updates); return config; }
    return null;
  }

  /**
   * getAlertCount() — what a BADGE number must be: exactly the number of rows the list returns.
   *
   * ⚠️ The previous implementation shipped every undismissed row to Node and deduped only
   * CONSECUTIVE identical title|detail pairs — an ad-hoc "run counter", not a count of anything.
   * Measured 2026-09-23: 12,865 rows in, **9,818 out**, while the notification popup rendered a
   * completely different source and said "All clear". Three numbers, one bell. It also ignored
   * `snoozedUntil` (unlike the list it was supposed to summarise) and counted acknowledged rows.
   *
   * Now: the SAME predicate as `getActiveAsync()` (dismissed = false, snooze window respected),
   * counted in SQL. Badge = list. If they can differ, they will.
   */
  async getAlertCount(): Promise<{ active: number; critical: number }> {
    if (!this.prisma.isAvailable) return { active: 0, critical: 0 };
    try {
      const base: any = {
        dismissed: false,
        OR: [
          { snoozedUntil: null },
          { snoozedUntil: { lt: new Date() } },
        ],
      };
      const [active, critical] = await Promise.all([
        (this.prisma as any).alert.count({ where: base }),
        (this.prisma as any).alert.count({ where: { ...base, severity: 'critical' } }),
      ]);
      return { active, critical };
    } catch { return { active: 0, critical: 0 }; }
  }

  /**
   * autoDismissStale() — the ONE owner of the age rule for alerts (2026-09-23).
   *
   * `autoDismissDays` has been declared in the notification settings since the beginning —
   * Settings → Notifications has a control for it — and was enforced NOWHERE. That is why the
   * table held 12,865 undismissed rows: a condition alert fired once per cooldown window for
   * months and nothing ever aged it out.
   *
   * Age is measured from `lastSeenAt` (the last observation of the condition), NOT `createdAt`:
   * a bridge that has been down since last week but re-fires every two minutes is CURRENT and
   * must not be aged out. Rows written before `lastSeenAt` existed fall back to `createdAt`.
   *
   * Dismissal, not deletion — the row survives in history (`getHistory()`), so "the alert that
   * told me about X" remains findable. If the condition recurs after dismissal, `addAlert()`
   * creates a NEW row: dismissal silences this occurrence, it is not a mute.
   */
  async autoDismissStale(): Promise<number> {
    if (!this.prisma.isAvailable) return 0;
    try {
      const days = this.notifSettings.autoDismissDays;
      if (!days || days <= 0) return 0;
      const cutoff = new Date(Date.now() - days * 86400000);
      const result = await (this.prisma as any).alert.updateMany({
        where: {
          dismissed: false,
          OR: [
            { lastSeenAt: { lt: cutoff } },
            { lastSeenAt: null, createdAt: { lt: cutoff } },
          ],
        },
        data: { dismissed: true },
      });
      if (result.count > 0) {
        this.logger.log(`Auto-dismissed ${result.count} alert(s) not seen in ${days} day(s)`);
      }
      return result.count;
    } catch (err) {
      this.logger.warn(`Alert auto-dismiss failed: ${(err as Error).message}`);
      return 0;
    }
  }

  /** Bulk dismiss all active alerts */
  async dismissAll(): Promise<number> {
    if (!this.prisma.isAvailable) return 0;
    try {
      const result = await (this.prisma as any).alert.updateMany({
        where: { dismissed: false },
        data: { dismissed: true },
      });
      this.logger.log(`Dismissed ${result.count} alerts`);
      return result.count;
    } catch (err) {
      this.logger.warn(`Failed to dismiss alerts: ${(err as Error).message}`);
      return 0;
    }
  }

  /** Delete alerts older than retainDays (both dismissed and active beyond retention) */
  async cleanupOld(retainDays: number): Promise<number> {
    if (!this.prisma.isAvailable) return 0;
    try {
      const cutoff = new Date(Date.now() - retainDays * 86400000);
      const result = await (this.prisma as any).alert.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      this.logger.log(`Cleaned up ${result.count} alerts older than ${retainDays} days`);
      return result.count;
    } catch (err) {
      this.logger.warn(`Alert cleanup failed: ${(err as Error).message}`);
      return 0;
    }
  }

  // ── Notification settings (in-memory, survives until restart) ──
  private notifSettings = { maxAlerts: 200, autoDismissDays: 3, mutedTypes: [] as string[] };

  async updateNotificationSettings(body: { maxAlerts?: number; autoDismissDays?: number; mutedTypes?: string[] }) {
    if (body.maxAlerts !== undefined) this.notifSettings.maxAlerts = body.maxAlerts;
    if (body.autoDismissDays !== undefined) this.notifSettings.autoDismissDays = body.autoDismissDays;
    if (body.mutedTypes !== undefined) this.notifSettings.mutedTypes = body.mutedTypes;
    return this.notifSettings;
  }

  async getNotificationSettings() { return this.notifSettings; }

  /**
   * addAlert() — condition alerts: create, or COLLAPSE a recurrence into the row that describes it.
   *
   * The collapse itself lives in `common/alerts/alert-collapse.ts` (ONE implementation, shared with
   * `NotificationsService.persistAlert()`) — see that file for the whole reasoning, including why
   * the key is (type, title) and why an alert is an attention record rather than an audit trail.
   *
   * ⚠️ This is the path a BLOCKED TRADE takes (`SignalActionsService`), so the same refusal
   * repeated by a retrying operator collapses to one row with a repeat count instead of flooding
   * the bell — the refusal still reaches the user every time, through the response itself.
   */
  async addAlert(type: string, title: string, detail?: string, severity = 'info', ticker?: string, link?: string) {
    if (!this.prisma.isAvailable) return null;
    try {
      return await collapseOrCreateAlert(this.prisma, { type, title, detail, severity, ticker, link });
    } catch (err) {
      this.logger.warn(`addAlert failed: ${err}`);
      return null;
    }
  }
}
