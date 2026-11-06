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

/**
 * The resolved size for ONE instrument, and why it is that number.
 *
 * ⚠️ WHY THIS TYPE EXISTS (#835). A single global `signals.manualTrade.size` cannot be correct,
 * because the broker's volume floor is a property of BROKER × INSTRUMENT: measured 2026-09-15,
 * every index reports `volumeMin 0.1` while FX/metals report `0.01`. So one number is either
 * impossible for indices or 10× too big for FX — and both directions were observed live:
 * 0.01 made every index manual trade impossible, and 0.1 multiplied FX risk by 10×.
 *
 * The floor is NOT guessed from an asset class; it comes from the broker's own `volumeMin`, which
 * is why `resolveSize()` takes the floor as an argument rather than looking one up. A second
 * lookup here would drift from `ExecutionFeasibilityService`'s, and the two would eventually
 * disagree about what is tradeable.
 */
export interface ResolvedTradeSize {
  /** Size to place, in lots: the request raised to the broker floor when it was below it. */
  placed: number;
  /** What was asked for — the caller's explicit size, or the global default. */
  requested: number;
  /** The broker's floor, or `null` when it could not be established. */
  floor: number | null;
  /** True only when `placed > requested` BECAUSE of the floor. Never true on a guess. */
  raised: boolean;
  /** Where `requested` came from, so "why is this 0.01?" is answerable at the point of trade. */
  source: 'caller' | 'setting' | 'fallback';
}

/**
 * resolveTradeSize — the per-instrument size rule for manual trades.
 *
 * ── DECISION (2026-11-06, #835) ──
 * WHAT:      The placed size is `max(requested, brokerFloor)`, with the floor taken from the
 *            `size-below-minimum` blocker's own `params` — never re-derived here.
 * WHY:       One global manual size cannot be right when the floor is per BROKER x INSTRUMENT
 *            (measured 2026-09-15: every index 0.1 lots, FX/metals 0.01). At 0.01 no index manual
 *            trade can fill; at 0.1 every FX manual trade is 10x the intended risk. Both observed.
 * INSTEAD OF: Asking the operator to read the refusal message and retype a number in Settings —
 *            the stopgap the issue itself calls "not the fix".
 * REVERSE BY: Returning `{ placed: requested }` unconditionally, and restoring the old hint-only
 *            behaviour of `size-below-minimum`.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 150
 * GUARD:     nest/src/modules/signals/manual-trade-size.spec.ts (6 cases, canaried both ways)
 *
 * ⚠️ Pure on purpose: no I/O, so it is exhaustively testable and cannot acquire a hidden dependency
 * on the database. The asymmetry matters — an UNKNOWN floor (`null`) must pass the request through
 * UNCHANGED, because "we could not ask the broker" is not evidence that the size is wrong, and
 * silently enlarging an order on missing information is the worst possible failure here.
 */
export function resolveTradeSize(
  requested: number,
  floor: number | null | undefined,
  source: ResolvedTradeSize['source'] = 'setting',
): ResolvedTradeSize {
  const known = typeof floor === 'number' && Number.isFinite(floor) && floor > 0 ? floor : null;
  if (known != null && requested < known) {
    return { placed: known, requested, floor: known, raised: true, source };
  }
  return { placed: requested, requested, floor: known, raised: false, source };
}

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
