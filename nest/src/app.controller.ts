import { Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { ModeService } from './config/mode.service';
import { PrismaService } from './database/prisma.service';
import { ProvidersService } from './modules/providers/providers.service';
import { Mt5ConnectionManager } from './modules/providers/mt5/mt5-connection-manager.service';
import { StopGuardianService } from './modules/automation/stop-guardian.service';

@Controller()
export class AppController {
  private startedAt = Date.now();

  constructor(
    private readonly appService: AppService,
    private readonly modeService: ModeService,
    private readonly prisma: PrismaService,
    private readonly providersService: ProvidersService,
    private readonly mt5Connection: Mt5ConnectionManager,
    private readonly stopGuardian: StopGuardianService,
  ) {}

  @Get()
  async getServerInfo() {
    const uptimeSec = Math.floor((Date.now() - this.startedAt) / 1000);
    const uptimeFmt = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m ${uptimeSec % 60}s`;

    // Fetch MT5 bridge health and terminal info
    let mt5Bridge: any = { connected: false, tradeAllowed: null, account: null, balance: null };
    try {
      const health = await this.mt5Connection.getHealth();
      const terminal = await this.mt5Connection.getTerminalInfo();
      mt5Bridge = {
        connected: health?.connected ?? false,
        tradeAllowed: terminal?.tradeAllowed ?? null,
        account: health?.account ?? null,
        server: health?.server ?? null,
        balance: health?.balance ?? null,
        equity: health?.equity ?? null,
        build: terminal?.build ?? null,
      };
    } catch {
      // MT5 bridge unavailable — keep defaults
    }

    return {
      server: 'Trading Command Suite — NestJS API',
      version: process.env.npm_package_version || '0.1.0',
      uptime: uptimeFmt,
      uptimeSeconds: uptimeSec,
      database: this.prisma.isAvailable ? 'connected' : 'disconnected',
      mode: process.env.QUEUE_MODE === 'local' ? 'local' : 'fallback',
      port: process.env.PORT ?? 3201,
      mt5Bridge,
      stopGuardian: {
        enabled: this.stopGuardian.state.enabled,
        guardedCount: this.stopGuardian.state.guardedPositions.length,
        lastTickAt: this.stopGuardian.state.lastTickAt,
        tickCount: this.stopGuardian.state.tickCount,
      },
      providers: null,
      endpoints: {
        health: '/api/health',
        docs: '/docs',
        automation: '/api/automation/status',
        scoring: '/api/scoring/runs',
        strategies: '/api/trading/strategies',
        portfolio: '/api/portfolio/summary',
        market: '/api/trading/sessions/market-context',
      },
    };
  }

  @Get('version')
  getVersion() {
    const modeInfo = this.modeService.getModeInfo();
    return {
      version: 'nest-0.1.0',
      status: 'ok',
      timestamp: new Date().toISOString(),
      mode: modeInfo.mode,
      services: {
        database: modeInfo.database,
        databaseConnected: this.prisma.isAvailable,
        queue: modeInfo.queue,
        redis: modeInfo.redis,
      },
    };
  }

  @Get('health')
  async getHealth() {
    const modeInfo = this.modeService.getModeInfo();
    const start = Date.now();

    let dbStatus = 'unknown';
    let dbLatency: number | null = null;
    try {
      if (this.prisma.isAvailable) {
        await this.prisma.$queryRaw`SELECT 1`;
        dbLatency = Date.now() - start;
        dbStatus = 'connected';
      } else {
        dbStatus = 'disconnected';
      }
    } catch {
      dbStatus = 'error';
    }

    let providerHealth: { total: number; healthy: number; degraded: number; failed: number } = { total: 0, healthy: 0, degraded: 0, failed: 0 };
    try {
      const health = await this.providersService.getHealth();
      providerHealth.total = health.providers.length;
      for (const p of health.providers) {
        if (p.status === 'healthy' || p.status === 'ok') providerHealth.healthy++;
        else if (p.status === 'missing-credentials' || p.status === 'unknown') providerHealth.degraded++;
        else providerHealth.failed++;
      }
    } catch {
      providerHealth = { total: 0, healthy: 0, degraded: 0, failed: 0 };
    }

    const queueStatus = modeInfo.queue ? 'available' : (process.env.QUEUE_MODE === 'off' ? 'disabled' : 'unavailable');

    const degraded =
      dbStatus !== 'connected' ||
      providerHealth.failed > 0;
    const down = dbStatus === 'error';

    const overallStatus = down ? 'down' : degraded ? 'degraded' : 'ok';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      mode: modeInfo.mode,
      subsystems: {
        database: { status: dbStatus, latency: dbLatency },
        providers: providerHealth,
        queue: { status: queueStatus, pending_jobs: null },
      },
    };
  }

  /** First-run / setup status — checks whether the app needs initial configuration. */
  @Get('health/setup')
  async getSetupStatus() {
    const checks: Record<string, boolean> = {};
    let protocolCount = 0, strategyCount = 0, watchlistCount = 0;

    if (this.prisma.isAvailable) {
      try {
        protocolCount = await (this.prisma as any).protocol.count();
        strategyCount = await (this.prisma as any).tradingStrategy.count();
        watchlistCount = await (this.prisma as any).watchlist.count();
      } catch { /* DB unavailable — counts stay 0 */ }
    }

    checks.hasProtocols = protocolCount > 0;
    checks.hasStrategies = strategyCount > 0;
    checks.hasWatchlists = watchlistCount > 0;
    checks.hasProviders = !!process.env.TRADING212_API_KEY || !!process.env.MT5_BRIDGE_URL;

    const allReady = Object.values(checks).every(Boolean);

    return {
      ready: allReady,
      checks,
      counts: { protocols: protocolCount, strategies: strategyCount, watchlists: watchlistCount },
      message: allReady
        ? 'All systems configured.'
        : 'Setup incomplete — configure providers and create your first protocol.',
    };
  }
}
