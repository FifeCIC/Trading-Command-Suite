/**
 * pnl-split.ts — distribute ONE position's realized P&L across the trade rows that built it (#1014).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 *
 * MT5 has TWO ticket namespaces, and they do not intersect:
 *
 *   `deal.orderId`    — the ticket for ONE order (what a scale-in returns)
 *   `deal.positionId` — the ticket for the POSITION (what the reconciler matches on)
 *
 * `position-sync.service.ts` looks up closing deals by `deal.positionId === trade.brokerTicket`.
 * The primary open path stores the POSITION id and reconciles. **The scale-in path stored the ORDER
 * id**, so `byPosition` came back empty, `exitDeals` was empty, `exitPrice` stayed null, and the row
 * was finalised as `position vanished` — a message that is a *label for "closed with no computable
 * result"*, not an observation. Measured 2026-09-28: **13 rows falsely closed** that way, while the
 * real position closed profitably on a trailed stop.
 *
 * ── AND WHY THE OBVIOUS FIX IS UNSAFE ON ITS OWN ────────────────────────────────────────────
 *
 * Storing `positionId` at the scale-in write sites looks like the whole fix. It is not, because the
 * account is **NETTING**: every order on a symbol merges into ONE position, so one real position
 * became N trade rows — and the reconciler books the position's ENTIRE net to whichever row it is
 * reconciling. N rows carrying one `positionId` would EACH claim the full P&L: a 4x overstatement on
 * a 4-order scale-in, with plausible numbers and no error anywhere.
 *
 * That is why the write sites still store the order ticket, and why `position-sync.service.ts`
 * carries a DECISION marker whose `REVERSE BY:` line names this split. This module is that reversal.
 *
 * ── THE SPLIT ───────────────────────────────────────────────────────────────────────────────
 *
 *   share        = row.quantity / sum(OPENING deal volume for that positionId)
 *   realizedPnl  = share × net of the position's closing deals
 *
 * ⚠️ IT REFUSES WHEN IT CANNOT COMPUTE A SHARE, RATHER THAN GUESSING. If several rows share the
 * position and the opening volume is unknown (0, missing, or the deals were not returned), the
 * answer is `null` — never the whole net, which is the overstatement this exists to prevent, and
 * never 0, which would claim a break-even. A caller that gets `null` writes no P&L and records why.
 *
 * ⚠️ THE DECISION MARKER CLAIMED THIS WAS "NOT VERIFIABLE YET" because no multi-row position
 * existed. That is true of the END-TO-END behaviour and false of the ARITHMETIC — the split is a
 * pure function over deal rows, so it is canaried here with synthetic deals, exactly as the Stop
 * Guardian's helpers are ("without a bridge, a position or a clock"). What remains unverifiable is
 * the live path, and that is stated in the handoff rather than glossed.
 */

/** The MT5 deal fields this depends on. All optional because brokers vary. */
export interface PnlDeal {
  side?: string;
  volume?: number | string | null;
  price?: number | string | null;
  profit?: number | string | null;
  commission?: number | string | null;
  swap?: number | string | null;
  fee?: number | string | null;
  positionId?: string | number | null;
  orderId?: string | number | null;
}

export interface PnlShareResult {
  /** `rowQuantity / openingVolume`, in 0–1. 1 when this row owns the position alone. */
  share: number;
  /** The position's whole net across its closing deals, before the split. */
  netTotal: number;
  /** `share × netTotal` — what THIS row may book. */
  realizedPnl: number;
  /** Why the share is what it is, so a reader never has to infer it. */
  basis: 'sole-owner' | 'volume-split';
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * openingVolume() — the denominator of the split.
 *
 * ⚠️ Openings are deals whose side is the OPPOSITE of the closing side. Passing the closing side in
 * would sum the exits and produce a share that is always 1, silently disabling the split while
 * appearing to work.
 */
export function openingVolume(openings: PnlDeal[] | null | undefined): number {
  return (openings ?? []).reduce((sum, d) => sum + Math.abs(num(d.volume)), 0);
}

/** netOf() — a position's whole result: profit + the three cost components, as MT5 reports them. */
export function netOf(closingDeals: PnlDeal[] | null | undefined): number {
  return (closingDeals ?? []).reduce(
    (sum, d) => sum + num(d.profit) + num(d.commission) + num(d.swap) + num(d.fee),
    0,
  );
}

/**
 * splitPnlByVolume() — the one derivation of what a row may book.
 *
 * @param closingDeals  the deals that CLOSED the position (the side opposite the row's own)
 * @param openings      the deals that OPENED the position — the split denominator
 * @param rowQuantity   this row's own volume
 * @param rowsSharing   how many `trade` rows carry this `positionId`
 */
export function splitPnlByVolume(params: {
  closingDeals: PnlDeal[];
  openings: PnlDeal[];
  rowQuantity: number | string | null | undefined;
  rowsSharing: number;
}): PnlShareResult | null {
  const { closingDeals, openings, rowsSharing } = params;
  const netTotal = netOf(closingDeals);

  // Nothing closed the position → there is no result to book. NOT zero.
  if (closingDeals.length === 0) return null;

  // One row owns the position: the whole net is that row's, and no split is needed. This is the
  // behaviour that was already correct for every primary open, and it is preserved exactly.
  if (rowsSharing <= 1) {
    return { share: 1, netTotal, realizedPnl: netTotal, basis: 'sole-owner' };
  }

  const denom = openingVolume(openings);
  // Several rows share the position and the denominator is unknown. Any number invented here is
  // the overstatement this module exists to prevent, so it refuses.
  if (denom <= 0) return null;

  const qty = Math.abs(num(params.rowQuantity));
  if (qty <= 0) return null;

  // ⚠️ A share above 1 is clamped rather than passed through. It means the row's quantity exceeds
  // the recorded opening volume — a data fault (a missing or partial opening deal), and booking
  // MORE than the position earned is the one direction that must never happen silently. The clamp
  // is deliberately to 1, not to a scaled-down value, so the fault shows up as an over-booked row
  // rather than being smoothed into a plausible number.
  const share = Math.min(1, qty / denom);
  return { share, netTotal, realizedPnl: share * netTotal, basis: 'volume-split' };
}

/**
 * countRowsSharingPosition() — how many rows carry this position id.
 *
 * ⚠️ Counted, not assumed. The whole safety argument rests on knowing whether more than one row
 * shares the position, and a caller that hardcodes `1` reintroduces the overstatement.
 */
export function countRowsSharingPosition(tickets: Array<string | null | undefined>, positionId: string): number {
  const id = String(positionId);
  return tickets.filter((t) => t != null && String(t) === id).length;
}
