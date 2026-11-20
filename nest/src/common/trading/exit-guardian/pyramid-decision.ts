/**
 * pyramid-decision.ts — the scale-in decision, split from the policy that reads it.
 *
 * ── WHY IT IS EXTRACTED ────────────────────────────────────────────────────────────────────────
 * `PyramidPolicyService.evaluate()` mixes three things: which positions belong to THIS bot
 * (account + magic scoping), a database lookup for the tier limit, and the tier arithmetic. Only the
 * middle one is IO. The other two are the parts that produce wrong answers silently — measured
 * 2026-11-04: `Number(null)` is `0`, so a position with no magic was silently treated as "not ours".
 *
 * ⚠️ `filterOwnPositions` IS EXTRACTED FOR THAT REASON, not for tidiness. Unknown values keep
 * BLOCKING: a row with no account id, or no magic, is treated as this bot's position. Being wrong
 * the other way means scaling into a position we do not own.
 *
 * ⚠️ THIS IS NOT WIRED INTO THE BACKTEST YET, DELIBERATELY. Modelling pyramiding changes the trade
 * population (one position with a blended entry instead of N trades), which is a maths change needing
 * a copied configuration and a side-by-side run. The decision is extracted and tested first so that
 * landing is one call site.
 */

export interface PyramidPosition {
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
  magic?: number | null;
  accountId?: string | null;
}

export type PyramidBlockerKey =
  | 'duplicate-position'
  | 'scale-in-not-green'
  | 'scale-in-not-locked'
  | 'max-tier';

export interface PyramidBlockerOut {
  key: PyramidBlockerKey;
  message: string;
  hint: string;
}

const upper = (v: unknown) => String(v ?? '').toUpperCase();

/**
 * The positions on this symbol that THIS order must be measured against.
 *
 * Order of rules matters and is asserted: symbol, then account, then per-bot magic on a hedging
 * account. Any unknown keeps blocking.
 */
export function filterOwnPositions(input: {
  positions: readonly PyramidPosition[];
  symbol: string;
  accountId?: string | null;
  positionModel?: string | null;
  incomingMagic?: number | null;
}): PyramidPosition[] {
  const ticker = upper(input.symbol);
  const hedging = String(input.positionModel || '').toLowerCase() === 'hedging';

  return (input.positions ?? []).filter((p) => {
    if (upper(p.symbol) !== ticker) return false;

    // Cross-account isolation: one provider id spans several accounts, and a position on another
    // account is not a duplicate of this order. A row WITHOUT an accountId is unknown → blocks.
    if (input.accountId && p.accountId && String(p.accountId) !== String(input.accountId)) return false;

    // Per-bot scoping on a hedging account: another bot's position is a different strategy holding
    // the same instrument. Requires ALL THREE — hedging, an incoming magic, and a magic on the row.
    // ⚠️ `!= null` BEFORE `Number()`. `Number(null)` is 0, which is finite and would compare unequal
    // to any real magic, so a position with NO magic would be silently treated as "not ours".
    if (hedging && input.incomingMagic != null) {
      const rawMagic = p.magic;
      if (rawMagic != null) {
        const rowMagic = Number(rawMagic);
        if (Number.isFinite(rowMagic) && rowMagic !== Number(input.incomingMagic)) return false;
      }
    }
    return true;
  });
}

/** Existing tier count: the larger of the position count and volume ÷ baseSize. */
export function pyramidTier(positions: readonly PyramidPosition[], baseSize: number): number {
  const totalVolume = positions.reduce((s, p) => s + Number(p.volume ?? p.quantity ?? 0), 0);
  const perBase = baseSize > 0 ? Math.ceil(totalVolume / baseSize) : 0;
  return Math.max(positions.length, perBase);
}

export interface PyramidVerdict {
  allowed: boolean;
  tier: number;
  nextTier: number;
  maxTiers: number;
  blockers: PyramidBlockerOut[];
}

/**
 * May this order be added on top of these positions?
 *
 * ⚠️ `maxTiers <= 1` IS THE DEFAULT AND IT BLOCKS. "One position per symbol" is the shipped
 * behaviour; scaling in is opt-in per bot and must never be inferred from an absent value.
 */
export function pyramidVerdict(input: {
  symbol: string;
  side: 'BUY' | 'SELL';
  brokerId: string;
  open: readonly PyramidPosition[];
  maxTiers: number;
  baseSize: number;
}): PyramidVerdict {
  const ticker = upper(input.symbol);
  const baseSize = input.baseSize > 0 ? input.baseSize : 0;
  const tier = pyramidTier(input.open, baseSize || 1);
  const nextTier = tier + 1;
  const maxTiers = Number(input.maxTiers) || 0;

  if (maxTiers <= 1) {
    return {
      allowed: false,
      tier,
      nextTier,
      maxTiers,
      blockers: [{
        key: 'duplicate-position',
        message: `Duplicate blocked for ${ticker}: ${input.open.length} open position(s) on ${upper(input.brokerId)}. Close existing or wait for cooldown.`,
        hint: `Close ${input.open.map((p) => (p.ticket ?? p.brokerTicket ? `#${p.ticket ?? p.brokerTicket}` : '')).filter(Boolean).join(', ') || 'the existing position'} — or set maxPyramidTiers > 1 on the bot to allow scale-in`,
      }],
    };
  }

  const totalProfit = input.open.reduce(
    (s, p) => s + Number(p.profit ?? p.unrealizedPnl ?? 0),
    0,
  );

  // Profit locked in: the broker SL is set AND at breakeven-or-better relative to ENTRY.
  const first = input.open[0];
  const entry = Number(first?.entryPrice ?? first?.avgCost ?? NaN);
  const sl = Number(first?.sl ?? first?.stopLoss ?? NaN);
  const lockedIn = Number.isFinite(sl) && sl > 0 && Number.isFinite(entry) &&
    (input.side === 'BUY' ? sl >= entry : sl <= entry);

  const blockers: PyramidBlockerOut[] = [];
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

  return { allowed: blockers.length === 0, tier, nextTier, maxTiers, blockers };
}
