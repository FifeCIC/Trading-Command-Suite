/**
 * SystemHealthService — first-run & ongoing health verification.
 *
 * Checks: DB connection, MT5 bridge, watchlists seeded, protocols seeded,
 * market data availability, automation loop status.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';

export interface HealthCheckItem {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
  checkedAt: string;
}

export interface HealthCheckResult {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  passed: number;
  failed: number;
  warned: number;
  checks: HealthCheckItem[];
  timestamp: string;
}

@Injectable()
export class SystemHealthService {
  private readonly logger = new Logger(SystemHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  async runAllChecks(): Promise<HealthCheckResult> {
    const checks: HealthCheckItem[] = [];

    // 1. Database connection
    checks.push(await this.checkDatabase());

    // 2. Core tables exist
    checks.push(await this.checkCoreTables());

    // 3. Watchlists seeded
    checks.push(await this.checkWatchlists());

    // 4. Protocols seeded (PROTOCOL_REGISTRY)
    checks.push(await this.checkProtocols());

    // 5. MT5 bridge reachable
    checks.push(await this.checkMt5Bridge());

    // 6. Market data available
    checks.push(await this.checkMarketData());

    // 7. Automation loop status (if applicable)
    checks.push(await this.checkAutomation());

    const passed = checks.filter(c => c.status === 'pass').length;
    const failed = checks.filter(c => c.status === 'fail').length;
    const warned = checks.filter(c => c.status === 'warn').length;
    const overall = failed > 0 ? 'unhealthy' : warned > 0 ? 'degraded' : 'healthy';

    return { overall, passed, failed, warned, checks, timestamp: new Date().toISOString() };
  }

  private pass(name: string, detail: string): HealthCheckItem {
    return { name, status: 'pass', detail, checkedAt: new Date().toISOString() };
  }
  private warn(name: string, detail: string): HealthCheckItem {
    return { name, status: 'warn', detail, checkedAt: new Date().toISOString() };
  }
  private fail(name: string, detail: string): HealthCheckItem {
    return { name, status: 'fail', detail, checkedAt: new Date().toISOString() };
  }

  private async checkDatabase(): Promise<HealthCheckItem> {
    try {
      if (!this.prisma.isAvailable) return this.fail('Database', 'Prisma reports DB unavailable');
      // Test a simple query
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return this.pass('Database', 'MySQL connected and responding');
    } catch (err) {
      return this.fail('Database', `Connection failed: ${(err as Error).message}`);
    }
  }

  private async checkCoreTables(): Promise<HealthCheckItem> {
    try {
      const required = ['watchlist', 'symbol', 'trading_strategy', 'scoring_strategy', 'position', 'marketbar'];
      const missing: string[] = [];
      for (const table of required) {
        try {
          await this.prisma.$queryRawUnsafe(`SELECT 1 FROM \`${table}\` LIMIT 0`);
        } catch { missing.push(table); }
      }
      if (missing.length === 0) return this.pass('Core Tables', `${required.length} required tables present`);
      return this.fail('Core Tables', `Missing: ${missing.join(', ')}`);
    } catch (err) {
      return this.fail('Core Tables', `Check failed: ${(err as Error).message}`);
    }
  }

  private async checkWatchlists(): Promise<HealthCheckItem> {
    try {
      const count = await (this.prisma as any).watchlist?.count?.() ?? 0;
      const systemCount = await (this.prisma as any).watchlist?.count?.({ where: { kind: 'system' } }) ?? 0;
      if (systemCount >= 8) {
        const names = await (this.prisma as any).watchlist?.findMany({
          where: { kind: 'system' },
          select: { name: true },
        });
        const list = names?.map((w: any) => w.name).join(', ') || '';
        return this.pass('Watchlists Seeded', `${systemCount} system watchlists: ${list}`);
      }
      if (count > 0) return this.warn('Watchlists Seeded', `${count} total but only ${systemCount} system (need 8+) — run seed-watchlists.ts`);
      return this.fail('Watchlists Seeded', 'No watchlists in DB — run seed-watchlists.ts');
    } catch {
      return this.warn('Watchlists Seeded', 'Watchlist table may not exist yet');
    }
  }

  private async checkProtocols(): Promise<HealthCheckItem> {
    try {
      // Check if protocol table exists with data
      let count = 0;
      try {
        const rows = await this.prisma.$queryRawUnsafe<Array<{ cnt: number }>>('SELECT COUNT(*) as cnt FROM protocol');
        count = Number(rows[0]?.cnt ?? 0);
      } catch { /* table may not exist */ }

      if (count >= 20) return this.pass('Protocols Seeded', `${count} protocols in DB`);
      if (count > 0) return this.warn('Protocols Seeded', `Only ${count} protocols — expected 32+.`);
      return this.warn('Protocols Seeded', 'DB has 0 protocols — run seed-protocols.ts to populate.');
    } catch (err) {
      return this.warn('Protocols Seeded', `Check failed: ${(err as Error).message}`);
    }
  }

  private async checkMt5Bridge(): Promise<HealthCheckItem> {
    try {
      const mt5 = this.adapterFactory.create('mt5');
      if (!mt5) return this.fail('MT5 Bridge', 'MT5 adapter not registered');
      // Try getQuote as lightweight connectivity test
      try {
        const q = await (mt5 as any).getQuote?.('EURUSD');
        if (q?.last) return this.pass('MT5 Bridge', `Connected — EURUSD bid=${q.bid ?? q.last} ask=${q.ask ?? q.last}`);
      } catch { /* try other methods */ }
      // Fallback: check health endpoint
      const health = await (mt5 as any).checkHealth?.().catch(() => null) ?? null;
      if (health?.connected) return this.pass('MT5 Bridge', `Connected via health check — ${health.server || ''}`);
      return this.warn('MT5 Bridge', 'Bridge reachable but not returning quote data — may need MT5 login');
    } catch {
      return this.warn('MT5 Bridge', 'Bridge unreachable — check port 5000 and mt5_bridge.py');
    }
  }

  private async checkMarketData(): Promise<HealthCheckItem> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ cnt: number; latest: string }>>(
        `SELECT COUNT(*) as cnt, MAX(timestamp) as latest FROM marketbar`,
      );
      const count = Number(rows[0]?.cnt ?? 0);
      const latest = rows[0]?.latest;
      if (count > 0 && latest) {
        const ageMin = Math.round((Date.now() - new Date(latest).getTime()) / 60000);
        if (ageMin < 60) return this.pass('Market Data', `${count} bars — freshest ${ageMin}m ago`);
        return this.warn('Market Data', `${count} bars but freshest ${ageMin}m ago (>60min stale)`);
      }
      return this.warn('Market Data', 'No market bars — run an import or start BarRefreshService');
    } catch {
      return this.warn('Market Data', 'MarketBar table may not exist yet');
    }
  }

  private async checkAutomation(): Promise<HealthCheckItem> {
    try {
      // Check if automation has run at least once
      const rows = await this.prisma.$queryRawUnsafe<Array<{ cnt: number }>>(
        `SELECT COUNT(*) as cnt FROM decision_log WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      );
      const recentDecisions = Number(rows[0]?.cnt ?? 0);
      if (recentDecisions > 0) return this.pass('Automation Loop', `${recentDecisions} decisions in the last hour — actively scoring`);
      // Check if loop is enabled
      const configRows = await this.prisma.$queryRawUnsafe<Array<{ enabled: number }>>(
        `SELECT enabled FROM automation_config WHERE brokerId = 'mt5' LIMIT 1`,
      );
      if (configRows.length > 0 && configRows[0].enabled) {
        return this.warn('Automation Loop', 'Enabled but no recent decisions — may be paused or waiting for tick');
      }
      return this.warn('Automation Loop', 'Not active — enable from Automation Dashboard');
    } catch {
      return this.warn('Automation Loop', 'Status unknown — tables may not exist');
    }
  }
}
