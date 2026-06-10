import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ModeService } from './config/mode.service';
import { PrismaService } from './database/prisma.service';
import { ProvidersService } from './modules/providers/providers.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly modeService: ModeService,
    private readonly prisma: PrismaService,
    private readonly providersService: ProvidersService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
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
}
