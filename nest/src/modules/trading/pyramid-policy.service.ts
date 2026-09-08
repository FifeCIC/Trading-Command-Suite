/**
 * PyramidPolicyService — the SINGLE scale-in / pyramid decision library (#721).
 * =============================================================================
 * The trading bot owns the execution-policy library. Manual trades are just
 * another caller of the SAME functions — never a separate implementation.
 *
 * Policy knob (one place): `TradingStrategy.maxPyramidTiers`.
 *   - = 1  → one-per-symbol (today's behaviour) — any open position blocks.
 *   - > 1  → scale-in allowed ONLY when: existing position is green AND its
 *            broker SL is actually set at breakeven-or-better AND the tier
 *            limit is not reached. Symmetric for SHORT.
 *   - No matching bot → fall back to the #720 manual-trade default
 *     `signals.manualTrade.maxPyramidTiers` (global_setting), mirroring the
 *     SAME field. Never a separate manual-policy table.
 *
 * Scale-in is opt-in per bot/symbol — NEVER automatic. The bot only scales
 * when its own strategy declares maxPyramidTiers > 1.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface PyramidOpenPosition {
  symbol?: string;
  ticket?: string | number | null;
  brokerTicket?: string | null;
  volume?: number;
  quantity?: number;
  sl?: number | null;
  stopLoss?: number | null;
  entryPrice?: number;
  avgCost?: number;
  currentPrice?: number;
  profit?: number;
  unrealizedPnl?: number;
}

export interface PyramidBlocker {
  key: 'duplicate-position' | 'scale-in-not-green' | 'scale-in-not-locked' | 'max-tier';
  message: string;
  hint: string;
}

export interface PyramidDecision {
  hasOpenPosition: boolean;
  allowed: boolean;
  /** Existing tier count (open positions / volume ÷ baseSize). */
  tier: number;
  /** Tier the new order would occupy. */
  nextTier: number;
  maxTiers: number;
  baseSize: number;
  /** Where the policy was resolved from — bot strategy or manual default. */
  source: 'bot' | 'default';
  blockers: PyramidBlocker[];
}

const MANUAL_MAX_TIERS_KEY = 'signals.manualTrade.maxPyramidTiers';
const DEFAULT_MAX_TIERS = 1;
const DEFAULT_BASE_SIZE = 0.01;

@Injectable()
export class PyramidPolicyService {
  private readonly logger = new Logger(PyramidPolicyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Decide whether a new order on `symbol` may be added on top of the given
   * open positions. `positions` is the set of open broker positions for the
   * symbol (caller pre-fetches; empty = fresh entry).
   *
   * Follow-up orders MUST carry a broker SL at order time (#721 decision 5) —
   * both callers always attach SL from their defaults, so that invariant is
   * enforced at order-building, not re-checked here.
   */
  async evaluate(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    brokerId: string;
    positions: PyramidOpenPosition[];
  }): Promise<PyramidDecision> {
    const { symbol, side, brokerId } = params;
    const ticker = symbol.toUpperCase();
    const blockers: PyramidBlocker[] = [];

    const open = (params.positions ?? []).filter(p =>
      String(p.symbol ?? '').toUpperCase() === ticker,
    );

    if (open.length === 0) {
      return {
        hasOpenPosition: false,
        allowed: true,
        tier: 0,
        nextTier: 1,
        maxTiers: 0,
        baseSize: DEFAULT_BASE_SIZE,
        source: 'default',
        blockers: [],
      };
    }

    // ── Resolve the policy knob (one place) ──
    const { maxTiers, baseSize, source } = await this.resolvePolicy(ticker);

    // Existing tier count = max(position count, volume ÷ baseSize) — the
    // retired logic; volume-over-base captures averaged entries on stock.
    const totalVolume = open.reduce((s, p) => s + Number(p.volume ?? p.quantity ?? 0), 0);
    const tier = Math.max(open.length, Math.ceil(totalVolume / baseSize));
    const nextTier = tier + 1;

    if (maxTiers <= 1) {
      blockers.push({
        key: 'duplicate-position',
        message: `Duplicate blocked for ${ticker}: ${open.length} open position(s) on ${brokerId.toUpperCase()}. Close existing or wait for cooldown.`,
        hint: `Close ${open.map(p => (p.ticket ?? p.brokerTicket ? `#${p.ticket ?? p.brokerTicket}` : '')).filter(Boolean).join(', ') || 'the existing position'} — or set maxPyramidTiers > 1 on the bot to allow scale-in`,
      });
      return this.decide(ticker, true, tier, nextTier, maxTiers, baseSize, source, blockers);
    }

    // ── Scale-in conditions (symmetric for SHORT) ──
    const totalProfit = open.reduce(
      (s, p) => s + Number(p.profit ?? p.unrealizedPnl ?? 0),
      0,
    );

    // Profit locked in: broker SL actually set AND at breakeven-or-better
    // relative to ENTRY (≥ entry for BUY, ≤ entry for SELL) — #721 decision 2.
    const entry = this.entryOf(open[0]);
    const sl = this.slOf(open[0]);
    const lockedIn = sl != null && sl > 0 && entry != null && (
      side === 'BUY' ? sl >= entry : sl <= entry
    );

    if (totalProfit <= 0) {
      blockers.push({
        key: 'scale-in-not-green',
        message: `Scale-in blocked for ${ticker}: existing position is not in profit`,
        hint: 'Close the losing position first — scaling into a loser is not allowed',
      });
    } else if (!lockedIn) {
      blockers.push({
        key: 'scale-in-not-locked',
        message: `Scale-in blocked for ${ticker}: existing position's profit is not locked in`,
        hint: 'Set a broker SL at breakeven-or-better on the open position',
      });
    } else if (nextTier > maxTiers) {
      blockers.push({
        key: 'max-tier',
        message: `Pyramid tier limit reached (${tier}/${maxTiers})`,
        hint: 'Raise maxPyramidTiers on the bot or wait for the position to close',
      });
    }
    // otherwise: allowed — falls through.

    return this.decide(ticker, true, tier, nextTier, maxTiers, baseSize, source, blockers);
  }

  /** Resolve the policy knob from the bot strategy, else the #720 default. */
  async resolvePolicy(symbol: string): Promise<{ maxTiers: number; baseSize: number; source: 'bot' | 'default' }> {
    try {
      const bot: any = await this.prisma.tradingStrategy.findFirst({
        where: { active: true, symbol: symbol.toUpperCase() },
        orderBy: { updatedAt: 'desc' },
      });
      if (bot) {
        return {
          maxTiers: Number(bot.maxPyramidTiers ?? 1) || 1,
          baseSize: Number(bot.baseSize ?? DEFAULT_BASE_SIZE) || DEFAULT_BASE_SIZE,
          source: 'bot',
        };
      }
    } catch (err) {
      this.logger.warn(`Pyramid policy: bot lookup failed for ${symbol}: ${(err as Error).message}`);
    }

    // Fallback to the #720 manual-trade default — mirror the SAME field.
    try {
      const row = await this.prisma.globalSetting.findUnique({ where: { key: MANUAL_MAX_TIERS_KEY } });
      const v = row ? parseInt(row.value, 10) : NaN;
      if (Number.isFinite(v) && v >= 1) {
        return { maxTiers: v, baseSize: DEFAULT_BASE_SIZE, source: 'default' };
      }
    } catch { /* fall through to hard default */ }

    return { maxTiers: DEFAULT_MAX_TIERS, baseSize: DEFAULT_BASE_SIZE, source: 'default' };
  }

  private entryOf(p: PyramidOpenPosition): number | null {
    const v = Number(p.entryPrice ?? p.avgCost ?? NaN);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  private slOf(p: PyramidOpenPosition): number | null {
    const v = Number(p.sl ?? p.stopLoss ?? NaN);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  private decide(
    _symbol: string,
    hasOpenPosition: boolean,
    tier: number,
    nextTier: number,
    maxTiers: number,
    baseSize: number,
    source: 'bot' | 'default',
    blockers: PyramidBlocker[],
  ): PyramidDecision {
    return { hasOpenPosition, allowed: blockers.length === 0, tier, nextTier, maxTiers, baseSize, source, blockers };
  }
}
