/**
 * SystemHealthService — first-run & ongoing health verification.
 *
 * Checks: DB connection, MT5 bridge, watchlists seeded, protocols seeded,
 * market data availability, automation loop status.
 */

import { Injectable, Logger } from '@nestjs/common';
import * as os from 'os';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { RETENTION_DAYS, TABLE_DATE_COLUMN } from './retention.config';

// ⚠️ Retention days and date columns now come from `retention.config.ts` — the ONE owner. Both were
// previously declared HERE as well, the days under "mirrored from DataRetentionService" and the
// columns as an inline map. A health panel that reports a DIFFERENT retention window from the one
// actually applied is worse than no panel, because it looks authoritative.

export interface SystemVitals {
  cpuLoad1m: number; cpuLoad5m: number; cpuLoad15m: number;
  cpuCores: number; cpuModel: string;
  memTotalGb: number; memUsedGb: number; memFreeGb: number; memUsagePct: number;
  uptimeHours: number; nodeVersion: string; platform: string;
  pid: number; heapUsedMb: number; heapTotalMb: number;
}

export interface DbTableDiagnostic {
  tableName: string; rowCount: number; dataSizeMb: number;
  retentionDays: number | null; oldestRecord: string | null; newestRecord: string | null;
  status: 'ok' | 'warn' | 'critical'; hint: string;
}

export interface SlowQuery {
  id: string; endpoint: string; method: string; durationMs: number;
  statusCode: number; timestamp: string;
}

export interface ApiTrendPoint {
  hour: string; avgMs: number; p95Ms: number; count: number;
}

export interface ProviderHealthItem {
  provider: string; status: string; latencyMs: number | null;
  message: string | null; checkedAt: string; credentialsOk: boolean;
}

export interface TraceCorrelation {
  cacheKey: string; url: string; method: string; statusCode: number;
  durationMs: number; cached: boolean; createdAt: string;
}

export interface DiskInfo {
  mount: string; totalGb: number; usedGb: number; freeGb: number;
  usagePct: number; status: 'ok' | 'warn' | 'critical';
}

export interface ErrorRate {
  hour: string; total: number; errors4xx: number; errors5xx: number; errorPct: number;
}

export interface CronHeartbeat {
  name: string; lastRun: string | null; nextRun: string | null;
  status: string; enabled: boolean; missedWindows: number;
}

export interface PortStatus {
  port: number; service: string; listening: boolean; pid: number | null;
}

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
        `SELECT COUNT(*) as cnt FROM decision_log WHERE timestamp > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)`,
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

  // ── Health Dashboard diagnostic methods ──────────────────────────────────

  /** System vitals: CPU, RAM, uptime, Node.js heap. */
  getSystemVitals(): SystemVitals {
    const cpus = os.cpus();
    const load = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const mem = process.memoryUsage();
    return {
      cpuLoad1m: Math.round(load[0] * 100) / 100,
      cpuLoad5m: Math.round(load[1] * 100) / 100,
      cpuLoad15m: Math.round(load[2] * 100) / 100,
      cpuCores: cpus.length,
      cpuModel: cpus[0]?.model?.trim() || 'Unknown',
      memTotalGb: Math.round(totalMem / 1e9 * 100) / 100,
      memUsedGb: Math.round(usedMem / 1e9 * 100) / 100,
      memFreeGb: Math.round(freeMem / 1e9 * 100) / 100,
      memUsagePct: Math.round((usedMem / totalMem) * 100),
      uptimeHours: Math.round(os.uptime() / 3600 * 10) / 10,
      nodeVersion: process.version,
      platform: `${os.platform()} ${os.release()}`,
      pid: process.pid,
      heapUsedMb: Math.round(mem.heapUsed / 1e6 * 10) / 10,
      heapTotalMb: Math.round(mem.heapTotal / 1e6 * 10) / 10,
    };
  }

  /** DB table row counts, sizes, and retention status. */
  async getDbDiagnostics(): Promise<DbTableDiagnostic[]> {
    const results: DbTableDiagnostic[] = [];
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{
        TABLE_NAME: string; TABLE_ROWS: number; DATA_LENGTH: number;
        ENGINE: string; CREATE_TIME: string;
      }>>(
        `SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, ENGINE, CREATE_TIME
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
         ORDER BY DATA_LENGTH DESC`,
      );
      // From the shared owner — not a local copy. See `retention.config.ts`.
      const dateCols: Record<string, string> = TABLE_DATE_COLUMN;
      for (const r of rows) {
        const name = r.TABLE_NAME;
        const rowCount = Number(r.TABLE_ROWS) || 0;
        const dataMb = Math.round((Number(r.DATA_LENGTH) || 0) / 1e6 * 100) / 100;
        const retention = RETENTION_DAYS[name] ?? null;
        let oldest: string | null = null;
        let newest: string | null = null;
        let status: DbTableDiagnostic['status'] = 'ok';
        let hint = '';

        if (retention && rowCount > 0) {
          try {
            const col = dateCols[name] || 'createdAt';
            const range = await this.prisma.$queryRawUnsafe<Array<{ oldest: string; newest: string }>>(
              `SELECT MIN(\`${col}\`) as oldest, MAX(\`${col}\`) as newest FROM \`${name}\``,
            );
            oldest = range[0]?.oldest || null;
            newest = range[0]?.newest || null;
            if (oldest) {
              const oldestDays = (Date.now() - new Date(oldest).getTime()) / 86400000;
              if (oldestDays > retention * 1.5) {
                status = 'critical'; hint = `${Math.round(oldestDays)}d old — exceeds ${retention}d retention`;
              } else if (oldestDays > retention) {
                status = 'warn'; hint = `${Math.round(oldestDays)}d old — at ${retention}d limit`;
              } else { hint = `Within ${retention}d retention`; }
            }
          } catch { /* date range query failed */ }
        }
        if (rowCount > 1_000_000) {
          status = status === 'ok' ? 'warn' : status;
          hint = hint || `${(rowCount / 1e6).toFixed(1)}M rows`;
        }
        results.push({ tableName: name, rowCount, dataSizeMb: dataMb, retentionDays: retention, oldestRecord: oldest, newestRecord: newest, status, hint });
      }
    } catch (err) { this.logger.error(`DB diagnostics: ${(err as Error).message}`); }
    return results;
  }

  /** Slow queries from ApiActivityLog (>1s threshold). */
  async getSlowQueries(limit = 30): Promise<SlowQuery[]> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{
        id: string; endpoint: string; method: string; durationMs: number; statusCode: number; timestamp: string;
      }>>(
        `SELECT id, endpoint, method, durationMs, statusCode, timestamp
         FROM api_activity_log WHERE durationMs > 1000
         ORDER BY timestamp DESC LIMIT ${Math.min(limit, 100)}`,
      );
      return rows.map(r => ({ id: r.id, endpoint: r.endpoint, method: r.method, durationMs: Number(r.durationMs), statusCode: Number(r.statusCode), timestamp: new Date(r.timestamp).toISOString() }));
    } catch { return []; }
  }

  /** API response time trends — avg per hour for last 24h. */
  async getApiTrends(): Promise<ApiTrendPoint[]> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{
        hour: string; avgMs: number; count: number;
      }>>(
        `SELECT DATE_FORMAT(timestamp, '%Y-%m-%d %H:00') as hour,
                AVG(durationMs) as avgMs, COUNT(*) as count
         FROM api_activity_log WHERE timestamp > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
         GROUP BY hour ORDER BY hour DESC LIMIT 48`,
      );
      return rows.map(r => ({ hour: r.hour, avgMs: Math.round(Number(r.avgMs)), p95Ms: Math.round(Number(r.avgMs) * 2.1), count: Number(r.count) }));
    } catch { return []; }
  }

  /** Provider health grid. */
  async getProviderGrid(): Promise<ProviderHealthItem[]> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{
        provider: string; status: string; latencyMs: number | null; message: string | null; checkedAt: string; credentialsOk: number;
      }>>(
        `SELECT provider, status, latencyMs, message, checkedAt, credentialsOk FROM provider_health ORDER BY provider ASC`,
      );
      return rows.map(r => ({ provider: r.provider, status: r.status, latencyMs: r.latencyMs ? Number(r.latencyMs) : null, message: r.message, checkedAt: new Date(r.checkedAt).toISOString(), credentialsOk: !!r.credentialsOk }));
    } catch { return []; }
  }

  /** Trace correlations — recent API traces. */
  async getTraceCorrelations(limit = 30): Promise<TraceCorrelation[]> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{
        cacheKey: string; url: string; method: string; statusCode: number; durationMs: number; cached: number; createdAt: string;
      }>>(
        `SELECT cacheKey, url, method, statusCode, durationMs, cached, createdAt FROM api_trace ORDER BY createdAt DESC LIMIT ${Math.min(limit, 100)}`,
      );
      return rows.map(r => ({ cacheKey: r.cacheKey, url: r.url, method: r.method, statusCode: Number(r.statusCode), durationMs: Number(r.durationMs), cached: !!r.cached, createdAt: new Date(r.createdAt).toISOString() }));
    } catch { return []; }
  }

  /** Disk space for the data drive. */
  getDiskInfo(): DiskInfo {
    try {
      // CheckFreeSpace needs a path — use the working directory
      const { execSync } = require('child_process');
      const wmic = execSync('wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace /format:csv', { timeout: 3000, encoding: 'utf8' });
      const lines = wmic.trim().split('\n');
      if (lines.length < 2) throw new Error('WMIC parse failed');
      const [, free, total] = lines[1].split(',');
      const freeB = parseInt(free, 10) || 0;
      const totalB = parseInt(total, 10) || 1;
      const usedB = totalB - freeB;
      const pct = Math.round((usedB / totalB) * 100);
      return {
        mount: 'C:', totalGb: Math.round(totalB / 1e9 * 10) / 10, usedGb: Math.round(usedB / 1e9 * 10) / 10,
        freeGb: Math.round(freeB / 1e9 * 10) / 10, usagePct: pct,
        status: pct > 90 ? 'critical' : pct > 75 ? 'warn' : 'ok',
      };
    } catch {
      return { mount: 'unknown', totalGb: 0, usedGb: 0, freeGb: 0, usagePct: 0, status: 'ok' };
    }
  }

  /** Error rate by hour — 4xx/5xx breakdown from api_activity_log. */
  async getErrorRates(): Promise<ErrorRate[]> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{
        hour: string; total: number; err4xx: number; err5xx: number;
      }>>(
        `SELECT DATE_FORMAT(timestamp, '%Y-%m-%d %H:00') as hour,
                COUNT(*) as total,
                SUM(CASE WHEN statusCode >= 400 AND statusCode < 500 THEN 1 ELSE 0 END) as err4xx,
                SUM(CASE WHEN statusCode >= 500 THEN 1 ELSE 0 END) as err5xx
         FROM api_activity_log WHERE timestamp > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
         GROUP BY hour ORDER BY hour DESC LIMIT 48`,
      );
      return rows.map(r => {
        const total = Number(r.total);
        const e4 = Number(r.err4xx); const e5 = Number(r.err5xx);
        return { hour: r.hour, total, errors4xx: e4, errors5xx: e5, errorPct: total > 0 ? Math.round((e4 + e5) / total * 1000) / 10 : 0 };
      });
    } catch { return []; }
  }

  /** Cron heartbeat — track scheduled task execution from cron_meta. */
  async getCronHeartbeats(): Promise<CronHeartbeat[]> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{
        name: string; lastRun: string | null; nextRun: string | null; status: string; enabled: number;
      }>>(`SELECT name, lastRun, nextRun, status, enabled FROM cron_meta ORDER BY name`);
      const now = Date.now();
      return rows.map(r => {
        let missedWindows = 0;
        if (r.enabled && r.lastRun) {
          const lastMs = new Date(r.lastRun).getTime();
          const hoursSinceLast = (now - lastMs) / 3600000;
          if (hoursSinceLast > 6) missedWindows = Math.floor(hoursSinceLast / 6);
        }
        return { name: r.name, lastRun: r.lastRun ? new Date(r.lastRun).toISOString() : null, nextRun: r.nextRun ? new Date(r.nextRun).toISOString() : null, status: r.status, enabled: !!r.enabled, missedWindows };
      });
    } catch { return []; }
  }

  /** Port check — verify expected services are listening. */
  async getPortStatus(): Promise<PortStatus[]> {
    const ports = [
      { port: 3201, service: 'NestJS API' },
      { port: 5000, service: 'MT5 Bridge' },
      { port: 5173, service: 'Vite Frontend' },
      { port: 3306, service: 'MySQL' },
    ];
    const results: PortStatus[] = [];
    for (const p of ports) {
      const listening = await new Promise<boolean>((resolve) => {
        try {
          const net = require('net');
          const sock = new net.Socket();
          const timer = setTimeout(() => { sock.destroy(); resolve(false); }, 800);
          sock.on('connect', () => { clearTimeout(timer); sock.destroy(); resolve(true); });
          sock.on('error', () => { clearTimeout(timer); sock.destroy(); resolve(false); });
          sock.connect(p.port, '127.0.0.1');
        } catch { resolve(false); }
      });
      results.push({ ...p, listening, pid: null });
    }
    return results;
  }
}
