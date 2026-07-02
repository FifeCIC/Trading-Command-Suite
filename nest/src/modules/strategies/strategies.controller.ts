import { Controller, Get, Post, Patch, Param, Body, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';
import {
  STRATEGY_PREREQUISITES,
  checkStrategyViability,
  ProviderAvailability,
  DataAvailability,
} from './strategy-prerequisites';

@Controller('strategies')
export class StrategiesController {
  private readonly logger = new Logger(StrategiesController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
  ) {}

  @Get()
  async listStrategies() {
    // Determine provider availability
    const modeInfo = this.modeService.getModeInfo();
    const providers: ProviderAvailability = {
      alpaca: modeInfo.database,
      alphavantage: false,
      trading212: false,
      mt5: false,
    };

    // Determine data availability
    let barCount = 0;
    let timeframes: string[] = [];
    if (this.prisma.isAvailable) {
      try {
        barCount = await this.prisma.marketBar.count();
        const tfRows = await this.prisma.marketBar.findMany({
          select: { timeframe: true },
          distinct: ['timeframe'],
        });
        timeframes = tfRows.map(r => r.timeframe);
      } catch {
        // DB not synced yet
      }
    }

    const data: DataAvailability = {
      hasBars: barCount > 0,
      hasQuotes: false,
      hasFundamentals: false,
      hasNews: false,
      barCount,
      availableTimeframes: timeframes,
    };

    const results = STRATEGY_PREREQUISITES.map(s => checkStrategyViability(s, providers, data));
    const viableCount = results.filter(r => r.viable).length;

    return {
      mode: modeInfo.mode,
      total: results.length,
      viableCount,
      viable: results,
    };
  }

  @Post()
  async createStrategy(@Body() body: { name: string; directives: Array<{ id: string; weight: number }>; scope?: string[]; thresholds?: { entry?: number; watch?: number } }) {
    this.logger.log(`Creating custom strategy: ${body.name} with ${body.directives.length} directives`);
    const totalWeight = body.directives.reduce((s, d) => s + d.weight, 0);
    if (totalWeight !== 100) {
      return { error: 'Directive weights must sum to exactly 100', totalWeight };
    }

    if (!this.prisma.isAvailable) {
      return this.storeInMemory(body);
    }

    try {
      const strategy = await this.prisma.strategy.create({
        data: {
          name: body.name,
          description: `Custom strategy with ${body.directives.length} directives`,
          config: {
            entryThreshold: body.thresholds?.entry ?? 60,
            watchThreshold: body.thresholds?.watch ?? 40,
            defenseThreshold: 25,
            weights: Object.fromEntries(body.directives.map((d) => [d.id, d.weight])),
            scope: body.scope ?? ['stocks'],
          },
          active: true,
        },
      });
      return { success: true, strategyId: strategy.id, name: body.name };
    } catch (error) {
      this.logger.error(`Failed to save strategy: ${String(error)}`);
      return this.storeInMemory(body);
    }
  }

  private storeInMemory(body: { name: string; directives: Array<{ id: string; weight: number }>; description?: string; goals?: string; symbolFocus?: string[] }) {
    const strategyId = `custom-${Date.now()}`;
    this.logger.warn(`Database unavailable — storing strategy ${body.name} in memory (${strategyId})`);
    return { success: true, strategyId, name: body.name, persisted: false };
  }

  @Get('saved')
  async listSaved() {
    if (!this.prisma.isAvailable) {
      return { strategies: [] };
    }
    try {
      const strategies = await this.prisma.strategy.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 50,
      });
      return {
        strategies: strategies.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          active: s.active,
          directives: s.config && typeof s.config === 'object' && 'weights' in (s.config as any)
            ? Object.entries((s.config as any).weights as Record<string, number>).map(([id, weight]) => ({ id, weight }))
            : [],
          symbolFocus: s.config && typeof s.config === 'object' && 'scope' in (s.config as any)
            ? (s.config as any).scope as string[]
            : [],
          goals: s.config && typeof s.config === 'object' && 'goals' in (s.config as any)
            ? (s.config as any).goals as string
            : '',
          updatedAt: s.updatedAt,
        })),
      };
    } catch {
      return { strategies: [] };
    }
  }

  @Get(':id')
  async getStrategy(@Param('id') id: string) {
    if (!this.prisma.isAvailable) return { error: 'DB unavailable' };
    const s = await this.prisma.strategy.findUnique({ where: { id } });
    if (!s) return { error: 'Not found' };
    return { id: s.id, name: s.name, description: s.description, config: s.config };
  }

  @Post(':id/duplicate')
  async duplicateStrategy(@Param('id') id: string) {
    if (!this.prisma.isAvailable) return { error: 'DB unavailable' };
    const original = await this.prisma.strategy.findUnique({ where: { id } });
    if (!original) return { error: 'Not found' };
    const dup = await this.prisma.strategy.create({
      data: {
        name: `${original.name} (copy)`,
        description: original.description,
        config: original.config as any,
        active: true,
      },
    });
    return { success: true, id: dup.id, name: dup.name };
  }

  @Post('seed')
  async seedBuiltInStrategies() {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.join(__dirname, '..', 'data', 'built-in-strategies.seed.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const strategies = JSON.parse(raw);
    const results = [];
    for (const s of strategies) {
      if (!this.prisma.isAvailable) break;
      try {
        const existing = await this.prisma.strategy.findFirst({ where: { name: s.strategyName } });
        if (existing) { results.push({ name: s.strategyName, status: 'skipped' }); continue; }
        await this.prisma.strategy.create({
          data: {
            name: s.strategyName,
            description: s.description,
            config: Object.fromEntries(s.directives.map((d: any) => [d.id, d.weight])) as any,
            active: true,
          },
        });
        results.push({ name: s.strategyName, status: 'created' });
      } catch (e) { results.push({ name: s.strategyName, status: 'error', error: (e as Error).message }); }
    }
    return { seeded: results.length, results };
  }

  // ── Directive Configuration ──

  @Get(':id/directives')
  async getStrategyDirectives(@Param('id') id: string) {
    if (!this.prisma.isAvailable) return { directives: [] };

    const strategy = await this.prisma.strategy.findUnique({
      where: { id },
      include: { directives: true },
    });
    if (!strategy) return { error: 'Strategy not found' };

    // Strategy.directives are the DB-linked Directive rows
    // Also check strategy.config.weights for weight overrides
    const config = strategy.config as any;
    const weights = config?.weights ?? {};

    // Get all directives linked to this strategy via DB relation
    const dbDirectives = strategy.directives || [];

    // If DB directives exist, use them. Otherwise, resolve from config weights.
    if (dbDirectives.length > 0) {
      return {
        strategyId: id,
        strategyName: strategy.name,
        directives: dbDirectives.map((d) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          weight: d.weight,
          active: d.active,
          parentId: d.parentId,
          isDefault: d.isDefault,
          forkReason: d.forkReason,
        })),
      };
    }

    // Fallback: resolve from config weights (legacy)
    const directiveIds = Object.keys(weights);
    if (directiveIds.length === 0) {
      return { strategyId: id, strategyName: strategy.name, directives: [] };
    }

    const resolved = await Promise.all(
      directiveIds.map(async (directiveId) => {
        const original = await this.prisma.directive.findUnique({
          where: { id: directiveId === 'rsi-overbought' ? 'rsi-overbought' : directiveId },
        });
        if (!original) return null;
        return {
          id: original.id,
          name: original.name,
          type: original.type,
          weight: weights[directiveId] ?? original.weight,
          active: original.active,
          parentId: original.parentId,
          isDefault: original.isDefault,
          forkReason: null as string | null,
        };
      }),
    );

    return {
      strategyId: id,
      strategyName: strategy.name,
      directives: resolved.filter(Boolean),
    };
  }

  @Patch(':id/directives/:directiveId')
  async updateDirective(
    @Param('id') strategyId: string,
    @Param('directiveId') directiveId: string,
    @Body() body: { active?: boolean; weight?: number },
  ) {
    if (!this.prisma.isAvailable) return { error: 'DB unavailable' };

    const strategy = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
    });
    if (!strategy) return { error: 'Strategy not found' };

    // Update directive in the DB relation
    try {
      const directive = await this.prisma.directive.findFirst({
        where: { id: directiveId, strategyId },
      });

      if (directive) {
        // Update existing
        await this.prisma.directive.update({
          where: { id: directiveId },
          data: {
            ...(body.active !== undefined ? { active: body.active } : {}),
            ...(body.weight !== undefined ? { weight: body.weight } : {}),
          },
        });
      } else {
        // Directive not linked to this strategy — update config weights instead
        const config = (strategy.config as any) || {};
        const weights = config.weights || {};

        if (body.active !== undefined) {
          if (!body.active) {
            delete weights[directiveId];
          } else {
            weights[directiveId] = body.weight ?? 5;
          }
        }
        if (body.weight !== undefined && body.active !== false) {
          weights[directiveId] = body.weight;
        }

        await this.prisma.strategy.update({
          where: { id: strategyId },
          data: {
            config: { ...config, weights },
            updatedAt: new Date(),
          },
        });
      }

      return { success: true, directiveId, strategyId, ...body };
    } catch (err) {
      this.logger.error(`Failed to update directive ${directiveId}: ${(err as Error).message}`);
      return { error: 'Update failed' };
    }
  }
}
