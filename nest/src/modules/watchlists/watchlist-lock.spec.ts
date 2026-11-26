/**
 * watchlist-lock.spec.ts — the lock must fire on a DEFINITE match and must not fire on ignorance
 * (#1349).
 *
 * ── THE TWO WAYS A LOCK GOES WRONG ───────────────────────────────────────────────────────────────
 *   1. **It cannot fire.** The defect this replaces: a query against a column that does not exist,
 *      swallowed by a `catch`, answering `locked: false` for every watchlist. A guard that has never
 *      been observed to refuse is a decoration, so the first tests below make it refuse.
 *   2. **It fires on everything.** If "cannot attribute this row" were treated as "locked", an
 *      install where attribution is incomplete (measured 2026-11-26: **all 13 position rows carry
 *      magic NULL**) would block every deletion — a rule that over-fires is one people route around.
 *
 * ⚠️ CANARY BOTH WAYS. Change `locked` to `magics.size > 0` and the "no live position" test fails;
 * change it to `live.length > 0` and the unattributable test fails.
 */
import { resolveWatchlistLock } from './watchlist-lock';

const UUID_XAU = 'c52d57be-f9c9-49cd-bc37-6994b743bdc8';

describe('resolveWatchlistLock() — a definite match locks; ignorance does not', () => {
  it('LOCKS when a live position carries the magic of a bot on this watchlist protocol', () => {
    const v = resolveWatchlistLock({
      protocolIds: ['xau-speed-v1-long'],
      strategies: [{ protocolId: 'xau-speed-v1-long', magic: 234141 }],
      positions: [{ magic: 234141, ref: 'pos-1' }],
    });
    expect(v.locked).toBe(true);
    expect(v.attributedCount).toBe(1);
    expect(v.magics).toEqual([234141]);
  });

  it('does NOT lock when the live position belongs to a different protocol', () => {
    const v = resolveWatchlistLock({
      protocolIds: ['xau-speed-v1-long'],
      strategies: [{ protocolId: 'xau-speed-v1-long', magic: 234141 }],
      positions: [{ magic: 234199 }],
    });
    expect(v.locked).toBe(false);
    expect(v.attributedCount).toBe(0);
  });

  it('does NOT lock on a protocol that exists but has no live position', () => {
    const v = resolveWatchlistLock({
      protocolIds: ['xau-speed-v1-long'],
      strategies: [{ protocolId: 'xau-speed-v1-long', magic: 234141 }],
      positions: [],
      openTrades: [],
    });
    expect(v.locked).toBe(false);
    expect(v.magics).toEqual([234141]);
  });

  it('counts an OPEN TRADE, because position.magic is measured to be null on every row', () => {
    // The measurement that forces two sources: 13/13 position rows have magic NULL, while 5 of 7
    // open trades carry one. A lock reading only `position` could not fire today.
    const v = resolveWatchlistLock({
      protocolIds: ['xau-speed-v1-long'],
      strategies: [{ protocolId: 'xau-speed-v1-long', magic: 234141 }],
      positions: [{ magic: null }, { magic: null }],
      openTrades: [{ magic: 234141 }],
    });
    expect(v.locked).toBe(true);
    expect(v.attributedCount).toBe(1);
    expect(v.unattributableCount).toBe(2);
  });

  it('REPORTS unattributable rows instead of locking on them', () => {
    const v = resolveWatchlistLock({
      protocolIds: ['xau-speed-v1-long'],
      strategies: [{ protocolId: 'xau-speed-v1-long', magic: 234141 }],
      positions: [{ magic: null }, { magic: 234000 /* bridge default */ }],
    });
    expect(v.locked).toBe(false);
    expect(v.unattributableCount).toBe(2);
  });

  it('the bridge default 234000 can never match a bot magic, even if a bot row holds it', () => {
    // A `trading_strategy` seeded with 234000 would be indistinguishable from "no bot", so it must
    // not produce a magic the lock can match on.
    const v = resolveWatchlistLock({
      protocolIds: ['xau-speed-v1-long'],
      strategies: [{ protocolId: 'xau-speed-v1-long', magic: 234000 }],
      positions: [{ magic: 234000 }],
    });
    expect(v.locked).toBe(false);
    expect(v.magics).toEqual([]);
    expect(v.protocolWithoutBotMagic).toBe(true);
  });

  it('matches a trading_strategy whose protocolId is the UUID, not the slug (#801)', () => {
    const v = resolveWatchlistLock({
      protocolIds: ['xau-speed-v1-long'],
      protocolIdBySlug: { 'xau-speed-v1-long': UUID_XAU },
      strategies: [{ protocolId: UUID_XAU, magic: 234141 }],
      positions: [{ magic: 234141 }],
    });
    expect(v.locked).toBe(true);
  });

  it('says so when the watchlist names a protocol and NO bot declares a magic for it', () => {
    const v = resolveWatchlistLock({
      protocolIds: ['xau-speed-v1-long'],
      strategies: [{ protocolId: 'xau-speed-v1-long', magic: null }],
      positions: [{ magic: 234141 }],
    });
    expect(v.locked).toBe(false);
    // ⚠️ The "not locked" answer here is a fact about CONFIGURATION, and the caller is told that.
    expect(v.protocolWithoutBotMagic).toBe(true);
  });

  it('does not claim a configuration gap when the watchlist names no protocol at all', () => {
    const v = resolveWatchlistLock({ protocolIds: [null, undefined, '  '], strategies: [], positions: [] });
    expect(v.locked).toBe(false);
    expect(v.protocolWithoutBotMagic).toBe(false);
  });

  it('ignores strategies that belong to ANOTHER watchlist protocol', () => {
    const v = resolveWatchlistLock({
      protocolIds: ['xau-speed-v1-long'],
      strategies: [
        { protocolId: 'vix-spike-v1-short', magic: 234999 },
        { protocolId: 'xau-speed-v1-long', magic: 234141 },
      ],
      positions: [{ magic: 234999 }],
    });
    expect(v.locked).toBe(false);
    expect(v.magics).toEqual([234141]);
  });
});
