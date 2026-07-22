import { Controller, Get, Query } from '@nestjs/common';
import { SystemHealthService } from './system-health.service';
import { SettingsService } from './settings.service';

@Controller('system')
export class SystemHealthController {
  constructor(
    private readonly health: SystemHealthService,
    private readonly settings: SettingsService,
  ) {}

  @Get('health-check')
  async healthCheck() {
    return this.health.runAllChecks();
  }

  /** GET /api/system/health-dashboard — diagnostics payload, respects health check toggles. */
  @Get('health-dashboard')
  async healthDashboard() {
    const hc = await this.settings.getHealthChecks();
    const results: any = { fetchedAt: new Date().toISOString() };

    const tasks: Promise<any>[] = [];
    const keys: string[] = [];

    const add = (key: string, fn: () => Promise<any> | any) => {
      if ((hc as any)[key] !== false) { keys.push(key); tasks.push(Promise.resolve(fn())); }
    };

    add('vitals', () => this.health.getSystemVitals());
    add('dbDiagnostics', () => this.health.getDbDiagnostics());
    add('slowQueries', () => this.health.getSlowQueries(30));
    add('apiTrends', () => this.health.getApiTrends());
    add('providerGrid', () => this.health.getProviderGrid());
    add('traceCorrelations', () => this.health.getTraceCorrelations(30));
    add('diskInfo', () => this.health.getDiskInfo());
    add('errorRates', () => this.health.getErrorRates());
    add('cronHeartbeats', () => this.health.getCronHeartbeats());
    add('portStatus', () => this.health.getPortStatus());

    const values = await Promise.all(tasks);
    keys.forEach((k, i) => { results[k] = values[i]; });

    results._healthCheckConfig = hc;
    return results;
  }

  /**
   * GET /api/system/health-summary — compact text summary for agents.
   * Designed to fit in ~500 chars for LLM context windows.
   * Agents should call this at the start of a session to understand system state.
   */
  @Get('health-summary')
  async healthSummary() {
    const start = Date.now();
    const [vitals, providerGrid, dbDiag] = await Promise.all([
      Promise.resolve(this.health.getSystemVitals()),
      this.health.getProviderGrid(),
      this.health.getDbDiagnostics(),
    ]);

    const lines: string[] = [];
    lines.push(`CPU: ${vitals.cpuLoad1m}/${vitals.cpuCores}cores | RAM: ${vitals.memUsagePct}% (${vitals.memUsedGb}/${vitals.memTotalGb}GB) | Heap: ${vitals.heapUsedMb}/${vitals.heapTotalMb}MB | Uptime: ${vitals.uptimeHours}h`);

    const degraded = providerGrid.filter(p => p.status !== 'healthy');
    const unhealthy = providerGrid.filter(p => p.status === 'unhealthy');
    if (unhealthy.length > 0) lines.push(`⚠️ UNHEALTHY providers: ${unhealthy.map(p => p.provider).join(', ')}`);
    else if (degraded.length > 0) lines.push(`⚠️ Degraded: ${degraded.map(p => `${p.provider}(${p.status})`).join(', ')}`);
    else lines.push(`✅ All ${providerGrid.length} providers healthy`);

    const critical = dbDiag.filter(t => t.status === 'critical');
    const warned = dbDiag.filter(t => t.status === 'warn');
    const bigTables = dbDiag.filter(t => t.rowCount > 500_000).map(t => `${t.tableName}(${(t.rowCount/1e3).toFixed(0)}K)`);
    if (critical.length > 0) lines.push(`🔴 DB retention critical: ${critical.map(t => t.tableName).join(', ')}`);
    if (warned.length > 0) lines.push(`⚠️ DB retention warn: ${warned.map(t => t.tableName).join(', ')}`);
    if (bigTables.length > 0) lines.push(`📊 Large tables: ${bigTables.join(', ')}`);

    return { summary: lines.join('\n'), fetchedMs: Date.now() - start };
  }
}
