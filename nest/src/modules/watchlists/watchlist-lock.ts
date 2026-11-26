/**
 * watchlist-lock.ts — WHICH live positions make a watchlist unsafe to delete (#1349).
 *
 * ── THE DEFECT THIS REPLACES ──────────────────────────────────────────────────────────────────────
 * The lock check asked `position.count({ where: { protocolId } })` — on a table with **no such
 * column**. It compiled only because the client was cast (`(this.prisma as any).position`), so
 * Prisma rejected the field at runtime, the surrounding `catch` returned `{ locked: false }`, and the
 * guard answered "safe to delete" for every watchlist. A guard that can never fire is a decoration.
 *
 * ── THE CHAIN, MEASURED 2026-11-26, NOT ASSUMED ───────────────────────────────────────────────────
 * A protocol is not stored on a position. Attribution runs:
 *
 *     position.magic  →  trading_strategy.magic  →  trading_strategy.protocolId
 *
 * and `trading_strategy.protocolId` holds a **slug** in every row on this install (0 of 82 held a
 * UUID), while `scoring_strategy.protocolId` — which is what the watchlist is linked through — holds
 * a slug too. Slugs are matched exactly, and the protocol's UUID is accepted as well, because #801
 * records that the column is slug-or-UUID and a matcher that handled one shape would report "no
 * positions" for the other.
 *
 * ── ⚠️ WHAT THE MEASUREMENT ALSO FOUND, AND WHY THERE IS A SECOND SOURCE ─────────────────────────
 * **All 13 `position` rows carry `magic: NULL`** (5 mt5, 8 trading212) while `trade` holds 7 open rows
 * of which 5 carry a magic. So a lock built on `position.magic` alone could not fire **today** — the
 * same decoration with better documentation. Both sources are therefore counted, and the answer is
 * still "locked" only on a DEFINITE match.
 *
 * ⚠️ UNATTRIBUTABLE IS A THIRD ANSWER, NOT A NO. A live row whose magic is null, or is the bridge
 * default `234000`, cannot be assigned to any protocol. It is REPORTED so the reader knows the count
 * is not the whole book — but it does not lock the watchlist, because blocking every deletion on
 * installs where attribution is incomplete is a rule that over-fires, and an over-firing guard is
 * one people learn to bypass.
 *
 * Pure: no Prisma, no clock. The caller supplies the rows.
 */
import { isAttributableMagic } from '../../common/trading/attribution-magic';

/** One live position, as much of it as the lock decision needs. */
export interface LivePositionRef {
  magic: number | null;
  /** `position.id` or `trade.id` — only used so the caller can name what blocked the deletion. */
  ref?: string;
}

export interface LockInput {
  /** `scoring_strategy.protocolId` for the strategies that use this watchlist — slugs. */
  protocolIds: ReadonlyArray<string | null | undefined>;
  /** `protocol.slug → protocol.id`, so a slug-or-UUID `trading_strategy.protocolId` both match. */
  protocolIdBySlug?: Readonly<Record<string, string>>;
  /** `trading_strategy` rows: their `protocolId` and `magic`. */
  strategies: ReadonlyArray<{ protocolId?: string | null; magic?: number | null }>;
  /** Live `position` rows (`quantity > 0`). */
  positions?: ReadonlyArray<LivePositionRef>;
  /** Open `trade` rows. Counted because `position.magic` is measured to be unusable — see the header. */
  openTrades?: ReadonlyArray<LivePositionRef>;
}

export interface LockVerdict {
  /** TRUE only on a DEFINITE match — never because attribution was unavailable. */
  locked: boolean;
  /** The magics that belong to the watchlist's protocols. Empty means no bot could own a position. */
  magics: number[];
  /** How many live rows matched one of those magics. */
  attributedCount: number;
  /** Live rows that belong to NO protocol we can name. Reported, never used to lock. */
  unattributableCount: number;
  /**
   * TRUE when the watchlist is linked to a protocol for which **no bot declares a magic**. The
   * deletion is still allowed (there is no provable dependency) but the reader is told that the
   * answer rests on configuration rather than on evidence.
   */
  protocolWithoutBotMagic: boolean;
}

/**
 * resolveWatchlistLock() — the whole decision, as a pure function.
 */
export function resolveWatchlistLock(input: LockInput): LockVerdict {
  const wanted = new Set<string>();
  for (const p of input.protocolIds) {
    const trimmed = typeof p === 'string' ? p.trim() : '';
    if (!trimmed) continue;
    wanted.add(trimmed);
    const uuid = input.protocolIdBySlug?.[trimmed];
    if (uuid) wanted.add(uuid);
  }

  // ⚠️ EVERY candidate protocol is counted, including one whose strategies are absent from the
  // passed rows — otherwise a caller that filters too narrowly silently narrows the lock.
  const magics = new Set<number>();
  let linkedProtocolsWithBot = 0;
  for (const s of input.strategies) {
    const id = typeof s.protocolId === 'string' ? s.protocolId.trim() : '';
    if (!id || !wanted.has(id)) continue;
    if (isAttributableMagic(s.magic)) {
      magics.add(s.magic);
      linkedProtocolsWithBot += 1;
    }
  }

  const live = [...(input.positions ?? []), ...(input.openTrades ?? [])];
  let attributedCount = 0;
  let unattributableCount = 0;
  for (const row of live) {
    if (!isAttributableMagic(row.magic)) {
      unattributableCount += 1;
      continue;
    }
    if (magics.has(row.magic)) attributedCount += 1;
  }

  return {
    locked: attributedCount > 0,
    magics: [...magics].sort((a, b) => a - b),
    attributedCount,
    unattributableCount,
    // The watchlist names protocols, and none of their bots can own a position: the "not locked"
    // answer is then a fact about CONFIGURATION, and saying so is the difference between a measured
    // answer and an absence of evidence.
    protocolWithoutBotMagic: wanted.size > 0 && linkedProtocolsWithBot === 0,
  };
}
