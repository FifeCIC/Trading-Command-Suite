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
// #1242 — the position filter, the tier arithmetic and the blockers are the shared decision; this
// service keeps only the IO (which bot, and the policy lookup). The TYPES are re-exported rather than
// redeclared: one definition, so the core and this service cannot describe different position shapes.
import {
  filterOwnPositions,
  pyramidVerdict,
  type PyramidPosition,
  type PyramidBlockerOut,
} from '../../common/trading/exit-guardian/pyramid-decision';

export type PyramidOpenPosition = PyramidPosition;
export type PyramidBlocker = PyramidBlockerOut;

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
    /**
     * #1079 — the account the INCOMING order will trade on. When given, a position whose own
     * `accountId` is a DIFFERENT non-empty account is not this account's position and does not
     * block. Rows with no accountId still block (unknown must never read as "no position").
     */
    accountId?: string | null;
    /**
     * The bot that is about to trade. Given, the policy resolves ITS `maxPyramidTiers`/`baseSize`
     * rather than guessing from the symbol, and — on a hedging account — it only counts positions
     * that THIS bot opened.
     *
     * ⚠️ ADDED 2026-11-04. Two defects made this necessary:
     *   1. `resolvePolicy()` looked the bot up by SYMBOL (`active: true, symbol`, newest first), so
     *      with two bots on one symbol it could read the WRONG bot's tier limit — the policy that
     *      decides scale-in was not the trading bot's policy.
     *   2. The open-position filter matched symbol + account only, so Bot B was blocked by Bot A's
     *      position. That is correct on a netting account (a second order would MERGE into A's
     *      position) and wrong on a hedging one (it opens its own).
     */
    strategyId?: string | null;
    /** The ACCOUNT's position model — only `hedging` allows a second position on one symbol. */
    positionModel?: string | null;
    /** The incoming bot's magic; required before another bot's position can be ignored. */
    incomingMagic?: number | null;
  }): Promise<PyramidDecision> {
    const { symbol, side, brokerId } = params;
    const ticker = symbol.toUpperCase();

    // #1242 — the position filter is the shared decision. Its two historical defects (a null magic
    // reading as another bot's, and symbol-only matching) are asserted in
    // `common/trading/exit-guardian/pyramid-and-atr.spec.ts` so this call site cannot regress.
    const open = filterOwnPositions({
      positions: params.positions ?? [],
      symbol,
      accountId: params.accountId,
      positionModel: params.positionModel,
      incomingMagic: params.incomingMagic,
    }) as PyramidOpenPosition[];

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
    const { maxTiers, baseSize, source } = await this.resolvePolicy(ticker, params.strategyId);

    // #1242 — tier arithmetic and the four blockers are the shared decision, so the live path and any
    // future caller (the backtest, when pyramiding is modelled) cannot disagree about them.
    const verdict = pyramidVerdict({
      symbol,
      side,
      brokerId,
      open,
      maxTiers,
      baseSize,
    });

    return this.decide(
      ticker,
      true,
      verdict.tier,
      verdict.nextTier,
      verdict.maxTiers,
      baseSize,
      source,
      verdict.blockers as PyramidBlocker[],
    );
  }

  /** Resolve the policy knob from the bot strategy, else the #720 default. */
  async resolvePolicy(symbol: string, strategyId?: string | null): Promise<{ maxTiers: number; baseSize: number; source: 'bot' | 'default'; botName?: string; pyramidEnabled?: boolean }> {
    try {
      // ⚠️ BY ID FIRST (2026-11-04). The lookup used to be by SYMBOL alone
      // (`active: true, symbol`, newest `updatedAt` first), so with two bots on one symbol it could
      // read the WRONG bot's `maxPyramidTiers` — the limit that allows or refuses scale-in was not
      // the trading bot's limit. The symbol lookup is kept as the fallback because the manual path
      // and older callers do not pass an id.
      const bot: any = strategyId
        ? await this.prisma.tradingStrategy.findUnique({ where: { id: strategyId } })
        : await this.prisma.tradingStrategy.findFirst({
            where: { active: true, symbol: symbol.toUpperCase() },
            orderBy: { updatedAt: 'desc' },
          });
      if (bot) {
        const maxTiers = Number(bot.maxPyramidTiers ?? 1) || 1;
        return {
          maxTiers,
          baseSize: Number(bot.baseSize ?? DEFAULT_BASE_SIZE) || DEFAULT_BASE_SIZE,
          source: 'bot',
          botName: bot.name,
          // Pyramid is an OPTIONAL mechanism a bot can be built with — `maxPyramidTiers > 1` is
          // what turns scale-in on, and it is part of what makes one strategy distinct from
          // another. Reported so the rule views can show it rather than leave it buried.
          pyramidEnabled: maxTiers > 1,
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
