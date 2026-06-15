import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface CalibrationEntry {
  symbol: string;
  directiveId: string;
  weightMultiplier: number;
  reason: string;
  decayModifier?: number | null;
  volatilityAdjustment?: number | null;
}

@Injectable()
export class CalibrationService implements OnModuleInit {
  private readonly logger = new Logger(CalibrationService.name);
  private cache: Map<string, CalibrationEntry[]> = new Map();
  private flatCache: Map<string, number> = new Map(); // "symbol:directiveId" → multiplier

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.loadCalibrations();
  }

  async loadCalibrations(): Promise<void> {
    if (!this.prisma.isAvailable) return;

    try {
      const rows = await this.prisma.symbolCalibration.findMany();
      this.cache.clear();
      this.flatCache.clear();

      for (const row of rows) {
        const key = row.symbol.toUpperCase();
        if (!this.cache.has(key)) this.cache.set(key, []);
        this.cache.get(key)!.push({
          symbol: row.symbol,
          directiveId: row.directiveId,
          weightMultiplier: row.weightMultiplier,
          reason: row.reason,
          decayModifier: row.decayModifier,
          volatilityAdjustment: row.volatilityAdjustment,
        });
        this.flatCache.set(`${key}:${row.directiveId}`, row.weightMultiplier);
      }

      this.logger.log(`Loaded ${rows.length} symbol calibrations for ${this.cache.size} symbols`);
    } catch (err) {
      this.logger.warn(`Failed to load calibrations: ${(err as Error).message}`);
    }
  }

  getCalibration(symbol: string, directiveId: string): number {
    const key = `${symbol.toUpperCase()}:${directiveId}`;
    return this.flatCache.get(key) ?? 1.0;
  }

  getSymbolOverrides(symbol: string): CalibrationEntry[] {
    return this.cache.get(symbol.toUpperCase()) ?? [];
  }

  hasCalibrations(symbol: string): boolean {
    return this.cache.has(symbol.toUpperCase());
  }

  applyCalibrations(
    symbol: string,
    results: Map<string, { score: number }>,
  ): { adjustedScores: Map<string, number>; applied: Array<{ directiveId: string; multiplier: number; reason: string }> } {
    const adjustedScores = new Map<string, number>();
    const applied: Array<{ directiveId: string; multiplier: number; reason: string }> = [];

    for (const [directiveId, result] of results) {
      const multiplier = this.getCalibration(symbol, directiveId);
      const adjusted = Math.round(result.score * multiplier);
      adjustedScores.set(directiveId, Math.min(100, adjusted));

      if (multiplier !== 1.0) {
        const overrides = this.getSymbolOverrides(symbol);
        const entry = overrides.find((o) => o.directiveId === directiveId);
        applied.push({
          directiveId,
          multiplier,
          reason: entry?.reason ?? 'Symbol calibration',
        });
      }
    }

    return { adjustedScores, applied };
  }

  async getAllCalibrations(): Promise<CalibrationEntry[]> {
    const all: CalibrationEntry[] = [];
    for (const [, entries] of this.cache) {
      all.push(...entries);
    }
    return all.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  async upsertCalibration(entry: CalibrationEntry): Promise<void> {
    if (!this.prisma.isAvailable) return;

    await this.prisma.symbolCalibration.upsert({
      where: {
        symbol_directiveId: {
          symbol: entry.symbol.toUpperCase(),
          directiveId: entry.directiveId,
        },
      },
      create: {
        symbol: entry.symbol.toUpperCase(),
        directiveId: entry.directiveId,
        weightMultiplier: entry.weightMultiplier,
        reason: entry.reason,
        decayModifier: entry.decayModifier ?? null,
        volatilityAdjustment: entry.volatilityAdjustment ?? null,
      },
      update: {
        weightMultiplier: entry.weightMultiplier,
        reason: entry.reason,
        decayModifier: entry.decayModifier ?? null,
        volatilityAdjustment: entry.volatilityAdjustment ?? null,
      },
    });

    await this.loadCalibrations();
  }

  async deleteCalibration(symbol: string, directiveId: string): Promise<void> {
    if (!this.prisma.isAvailable) return;

    await this.prisma.symbolCalibration.deleteMany({
      where: { symbol: symbol.toUpperCase(), directiveId },
    });

    await this.loadCalibrations();
  }
}
