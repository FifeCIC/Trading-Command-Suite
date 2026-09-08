import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * ManualTradeDefaultsService — persisted defaults for Signals manual trades
 * (#720). The Signals card places orders with no per-trade parameters, so
 * these ARE the parameters. Stored in `global_setting` (backup-safe, not
 * hardcoded) with the original inline values as the seed: 0.01 lots, 2% SL,
 * 4% TP, 1 pyramid tier.
 *
 * Keys (single source of truth — read at order time so Settings edits apply
 * without restart):
 *   signals.manualTrade.size
 *   signals.manualTrade.slPct
 *   signals.manualTrade.tpPct
 *   signals.manualTrade.maxPyramidTiers   ← mirrors TradingStrategy.maxPyramidTiers (#721)
 */
export interface ManualTradeDefaults {
  /** Position size in lots. */
  size: number;
  /** Stop-loss distance from entry, as a percent. */
  slPct: number;
  /** Take-profit distance from entry, as a percent. */
  tpPct: number;
  /** Max scale-in tiers for manual trades with no matching bot (#721). */
  maxPyramidTiers: number;
}

export const DEFAULT_MANUAL_TRADE: ManualTradeDefaults = { size: 0.01, slPct: 2, tpPct: 4, maxPyramidTiers: 1 };

const KEYS = {
  size: 'signals.manualTrade.size',
  slPct: 'signals.manualTrade.slPct',
  tpPct: 'signals.manualTrade.tpPct',
  maxPyramidTiers: 'signals.manualTrade.maxPyramidTiers',
} as const;

const LIMITS: Record<keyof ManualTradeDefaults, { min: number; max: number }> = {
  size: { min: 0.001, max: 100 },
  slPct: { min: 0, max: 50 },
  tpPct: { min: 0, max: 100 },
  maxPyramidTiers: { min: 1, max: 20 },
};

@Injectable()
export class ManualTradeDefaultsService {
  private readonly logger = new Logger(ManualTradeDefaultsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Read the persisted defaults, merged over the seeded fallback. */
  async getDefaults(): Promise<ManualTradeDefaults> {
    const merged = { ...DEFAULT_MANUAL_TRADE };
    if (!this.prisma.isAvailable) return merged;
    try {
      const rows = await this.prisma.globalSetting.findMany({
        where: { key: { in: [KEYS.size, KEYS.slPct, KEYS.tpPct, KEYS.maxPyramidTiers] } },
      });
      for (const r of rows) {
        const v = parseFloat(r.value);
        if (!Number.isFinite(v)) continue;
        if (r.key === KEYS.size) merged.size = v;
        else if (r.key === KEYS.slPct) merged.slPct = v;
        else if (r.key === KEYS.tpPct) merged.tpPct = v;
        else if (r.key === KEYS.maxPyramidTiers) merged.maxPyramidTiers = Math.round(v);
      }
    } catch (err) {
      this.logger.warn(`getDefaults fell back to seeded values: ${(err as Error).message}`);
    }
    return merged;
  }

  /** Persist the given fields (validated + clamped). Returns the merged state. */
  async setDefaults(patch: Partial<ManualTradeDefaults>): Promise<ManualTradeDefaults> {
    const entries: Array<[key: keyof ManualTradeDefaults, value: number]> = [];
    if (patch.size !== undefined) entries.push(['size', patch.size]);
    if (patch.slPct !== undefined) entries.push(['slPct', patch.slPct]);
    if (patch.tpPct !== undefined) entries.push(['tpPct', patch.tpPct]);
    if (patch.maxPyramidTiers !== undefined) entries.push(['maxPyramidTiers', Math.round(patch.maxPyramidTiers)]);

    if (entries.length === 0) {
      throw new BadRequestException('Provide at least one of: size, slPct, tpPct, maxPyramidTiers');
    }

    for (const [field, value] of entries) {
      const lim = LIMITS[field];
      if (!Number.isFinite(value) || value < lim.min || value > lim.max) {
        throw new BadRequestException(
          `${field} must be between ${lim.min} and ${lim.max} (got ${value})`,
        );
      }
    }

    for (const [field, value] of entries) {
      const key = KEYS[field];
      await this.prisma.globalSetting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
    }
    this.logger.log(`Manual-trade defaults updated: ${entries.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    return this.getDefaults();
  }
}
