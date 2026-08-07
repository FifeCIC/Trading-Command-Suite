/**
 * ScoringStrategyService — CRUD for scoring strategies.
 * ======================================================
 * Scoring strategies sit between protocols and trading strategies.
 * They define HOW a protocol's scores are used: which directive groups
 * act as gates, at what threshold, and with what weighting strategy.
 *
 * Chain: Protocol → ScoringStrategy → TradingStrategy
 */
import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DEFAULT_SCORING_STRATEGIES, SeedScoringStrategy } from './scoring-strategy-seed';

export interface CreateScoringStrategyDto {
  name: string;
  protocolId: string;
  watchlistName?: string;
  watchlistId?: string;
  brokerId?: string;
  mode?: string;
  enabled?: boolean;
  tradeThreshold?: number;
  baseSize?: number;
  slPct?: number;
  tpPct?: number;
  weightStrategy?: string;
  gateConfig?: Record<string, { enabled: boolean; threshold: number }>;
}

@Injectable()
export class ScoringStrategyService implements OnModuleInit {
  private readonly logger = new Logger(ScoringStrategyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Seed defaults after DB is available
    setTimeout(() => this.seedDefaults().catch(() => {}), 3000);
  }

  async findAll() {
    if (!this.prisma.isAvailable) return [];
    const rows = await (this.prisma as any).scoringStrategy.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows;
  }

  async findById(id: string) {
    if (!this.prisma.isAvailable) throw new NotFoundException('Database unavailable');
    const row = await (this.prisma as any).scoringStrategy.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Scoring strategy ${id} not found`);
    return row;
  }

  async create(dto: CreateScoringStrategyDto) {
    if (!this.prisma.isAvailable) throw new Error('Database unavailable');
    if (!dto.name || !dto.protocolId) throw new Error('name and protocolId are required');

    const existing = await (this.prisma as any).scoringStrategy.findFirst({
      where: { name: dto.name, protocolId: dto.protocolId },
    });
    if (existing) {
      // Update gate config if provided
      if (dto.gateConfig) {
        await (this.prisma as any).scoringStrategy.update({
          where: { id: existing.id },
          data: { gateConfig: dto.gateConfig },
        });
        existing.gateConfig = dto.gateConfig;
      }
      return existing;
    }

    const created = await (this.prisma as any).scoringStrategy.create({
      data: {
        name: dto.name,
        protocolId: dto.protocolId,
        watchlistName: dto.watchlistName || 'default',
        watchlistId: dto.watchlistId || null,
        brokerId: dto.brokerId || 'mt5',
        mode: dto.mode || 'score',
        tradeThreshold: dto.tradeThreshold ?? 60,
        baseSize: dto.baseSize ?? 0.01,
        slPct: dto.slPct ?? 1.0,
        tpPct: dto.tpPct ?? 1.0,
        weightStrategy: dto.weightStrategy || 'group-weighted',
        gateConfig: dto.gateConfig || null,
        enabled: true,
      },
    });

    this.logger.log(`Created scoring strategy "${dto.name}" (${created.id})`);
    return created;
  }

  async update(id: string, dto: Partial<CreateScoringStrategyDto>) {
    if (!this.prisma.isAvailable) throw new Error('Database unavailable');
    const existing = await this.findById(id);
    return (this.prisma as any).scoringStrategy.update({
      where: { id: existing.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.tradeThreshold !== undefined && { tradeThreshold: dto.tradeThreshold }),
        ...(dto.gateConfig !== undefined && { gateConfig: dto.gateConfig }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      },
    });
  }

  /** Seed default scoring strategies — idempotent, skips existing by name+protocolId. */
  async seedDefaults(): Promise<{ created: number; skipped: number }> {
    if (!this.prisma.isAvailable) return { created: 0, skipped: DEFAULT_SCORING_STRATEGIES.length };
    let created = 0, skipped = 0;
    for (const s of DEFAULT_SCORING_STRATEGIES) {
      const existing = await (this.prisma as any).scoringStrategy.findFirst({
        where: { name: s.name, protocolId: s.protocolId },
      });
      if (existing) { skipped++; continue; }
      await this.create(s);
      created++;
    }
    this.logger.log(`Scoring strategy seed: ${created} created, ${skipped} skipped`);
    return { created, skipped };
  }
}
