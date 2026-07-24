import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

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
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    } catch (err) {
      this.logger.warn(`getActiveAsync failed: ${err}`);
      return [];
    }
  }

  getHistory(limit = 50): Alert[] {
    return []; // Fallback — now DB-backed
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

  async getAlertCount(): Promise<{ active: number; critical: number }> {
    if (!this.prisma.isAvailable) return { active: 0, critical: 0 };
    try {
      const [active, critical] = await Promise.all([
        (this.prisma as any).alert.count({ where: { dismissed: false } }),
        (this.prisma as any).alert.count({ where: { dismissed: false, severity: 'critical' } }),
      ]);
      return { active, critical };
    } catch { return { active: 0, critical: 0 }; }
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

  /** Create a real alert — persisted to DB */
  async addAlert(type: string, title: string, detail?: string, severity = 'info', ticker?: string, link?: string) {
    if (!this.prisma.isAvailable) return null;
    try {
      return await (this.prisma as any).alert.create({
        data: { type, title, detail, severity, ticker, link },
      });
    } catch (err) {
      this.logger.warn(`addAlert failed: ${err}`);
      return null;
    }
  }
}
