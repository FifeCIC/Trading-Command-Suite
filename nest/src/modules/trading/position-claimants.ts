/**
 * position-claimants.ts — WHO BUILT THIS POSITION, derived from the broker's own deals.
 * ==============================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * A netting MT5 account holds **one position per symbol**, so several bots' orders MERGE into a
 * single position. The broker reports only the net — it never says the position has more than one
 * author. Measured 2026-09-30 on ticket `152703882760`: ten fills, ONE `positionId`, orders from
 * **three different bots** (`Gold Position 4H (copy)`, `AB-A`, `AB-B`), closed for **−322.67**.
 *
 * The guardian could not establish an owner for it, so it managed nothing, for **2 h 20 m** — 26
 * warnings into a log. "No single owner" was treated as "no owner", and those are different things.
 *
 * ⚠️ THE APP CANNOT NAME A POSITION DIRECTLY. `trade.brokerTicket` holds the **ORDER** ticket, and
 * MT5 gives each order a different id from the position it opens. Measured against the broker's own
 * deals: of 10 real incident rows, **9 resolved as an `orderId` and 0 as a `positionId`**. So a
 * direct join on `brokerTicket` returns nothing, silently — the defect class this repo names
 * repeatedly. The position is reachable only through the deals, which carry **both** ids.
 *
 * ⚠️ THIS MODULE IS PURE AND HAS NO I/O, DELIBERATELY.
 *   1. It is the ONE implementation of the derivation. `getPositionsManaged()` and the guardian
 *      (#1041) both need it, and two copies drift with only one getting the next fix — this repo's
 *      own most expensive kind of debt.
 *   2. It can be tested against the REAL incident ids without a database, a bridge, or a mock of
 *      either. `position-claimants.spec.ts` is that test.
 */

/** A deal as the MT5 bridge actually sends it — measured 2026-09-30, not from the MT5 docs. */
export interface DealLike {
  orderId?: unknown;
  order_id?: unknown;
  positionId?: unknown;
  position_id?: unknown;
}

/** The only columns of `trade` this derivation reads. */
export interface AppOrderRow {
  brokerTicket?: unknown;
  scoringStrategyId?: unknown;
}

/**
 * `orderId → positionId`, from the deal history.
 *
 * ⚠️ A clean function, not a heuristic: one order belongs to exactly one position. Measured — 207
 * deals produced 207 distinct `orderId`s across 103 `positionId`s.
 *
 * ⚠️ Both key spellings are read. The bridge sends `positionId`/`orderId` (camelCase) today; the
 * snake_case names are MT5's own field names and a bridge change must not silently empty this map.
 * An empty map is indistinguishable from "no deals", which is why the caller reports a gap when the
 * deal read fails rather than treating an absence of claimants as an absence of authors.
 */
export function buildOrderToPosition(deals: readonly DealLike[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of deals) {
    const oid = d?.orderId ?? d?.order_id;
    const pid = d?.positionId ?? d?.position_id;
    if (oid == null || pid == null) continue;
    map.set(String(oid), String(pid));
  }
  return map;
}

/**
 * How a bot is NAMED on screen. Falls back to a truncated id rather than dropping the row: an
 * unidentified order is still **evidence of a second writer**, and hiding it would conceal exactly
 * the case this module exists to expose.
 */
export function claimantLabel(botId: string, botNameById: ReadonlyMap<string, string>): string {
  if (!botId) return 'unattributed order';
  return botNameById.get(botId) ?? `bot ${botId.slice(0, 8)}…`;
}

/**
 * `positionId → [distinct bot names]`, the set of bots whose orders compose each position.
 *
 * ⚠️ IDENTITY IS THE BOT (`scoringStrategyId` → `trading_strategy.name`), NEVER the free-text
 * `trade.strategy` column. That column carries the MT5 comment body — mutable text that a later
 * order can overwrite, which is precisely what made the original attribution fail: on the incident
 * the same ticket read `AB-B` at 12:32 and `AB-A` from 12:42.
 *
 * ⚠️ A row with NO resolvable bot still counts as its own claimant. Two unidentified orders are one
 * claimant ("we do not know who"), not two — so the label is used as the identity, which collapses
 * them correctly and still refuses to pretend the position has a single known author.
 */
export function buildClaimants(
  appOrderRows: readonly AppOrderRow[],
  orderToPosition: ReadonlyMap<string, string>,
  botNameById: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const sets = new Map<string, Set<string>>();
  for (const r of appOrderRows) {
    const pid = orderToPosition.get(String(r?.brokerTicket ?? ''));
    if (!pid) continue;
    const label = claimantLabel(String(r?.scoringStrategyId ?? ''), botNameById);
    if (!sets.has(pid)) sets.set(pid, new Set());
    sets.get(pid)!.add(label);
  }
  const out = new Map<string, string[]>();
  for (const [pid, set] of sets) out.set(pid, [...set]);
  return out;
}

/**
 * Does this position have more than one author?
 *
 * ⚠️ `> 1`, and the boundary is the decision — not an implementation detail. ONE claimant is a
 * normal position that can be attributed and managed. TWO OR MORE means no single bot's rules can be
 * said to be managing it, which is a state the system must name rather than resolve by picking.
 * The owner's ruling, 2026-09-30 (R31): a contested position is **managed, by its strictest
 * claimant** — so it is protected soonest rather than by whichever bot is looked at first.
 */
export function isContested(claimants: readonly string[] | undefined | null): boolean {
  return (claimants?.length ?? 0) > 1;
}
