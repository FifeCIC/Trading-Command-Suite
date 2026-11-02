import { ProtocolGatingService } from './protocol-gating.service';
import { resolveProtocolForSymbol } from './speed-scan.service';

/**
 * #803 — ONE scoring path: `active = 0` is a kill switch.
 *
 * ⚠️ THE DEFECT THESE TESTS PIN (measured 2026-10-09): `usdcad-oil-v1` and `oil-supply-v1` —
 * both `active = 0`, one with no bot and no symbol assignment — were writing score rows every
 * few minutes (newest 22:10 that day). Two causes, both closed here:
 *
 *   1. `speed-scan.service.ts` fell back to a hardcoded symbol→protocol map and returned
 *      `active: true` unconditionally — a claim nobody verified. The fallback now asks the
 *      database, and refuses when it cannot.
 *   2. Even the flag the scan HAD read was only used to label the result for the frontend —
 *      scoring continued regardless. The scan now skips before scoring.
 *
 * And the class-closer: `storeSnapshot()` — the ONE write point for `score` + `score_snapshot`
 * — refuses writes for an inactive protocol, so a future path that forgets the check still
 * cannot persist for a retired protocol.
 */
describe('#803 — single scoring path / active = 0 kill switch', () => {
  // ── resolveProtocolForSymbol: the fallback must stop lying ──
  const prismaWith = (
    opts: { active?: boolean; missing?: boolean; available?: boolean } = {},
  ) => ({
    isAvailable: opts.available !== false,
    symbolProtocolAssignment: { findMany: jest.fn(async () => []) },
    protocol: {
      findFirst: jest.fn(async () => (opts.missing ? null : { active: opts.active ?? true })),
    },
  });

  it('the hardcoded fallback reports the DATABASE active flag — never a hardcoded true (#803)', async () => {
    const res = await resolveProtocolForSymbol('USDCAD', prismaWith({ active: false }));
    expect(res).toEqual({ slug: 'usdcad-oil-v1', active: false });
  });

  it('a fallback slug with no protocol row is refused (#803)', async () => {
    expect(await resolveProtocolForSymbol('USDCAD', prismaWith({ missing: true }))).toBeNull();
  });

  it('cannot verify (DB unavailable) → refused; unknown must not read as active (#803)', async () => {
    expect(await resolveProtocolForSymbol('USDCAD', prismaWith({ available: false }))).toBeNull();
  });

  it('the DB assignment path still wins and carries its own active flag (#803 control)', async () => {
    const prisma = prismaWith();
    prisma.symbolProtocolAssignment.findMany = jest.fn(async () => [
      { protocol: { slug: 'xau-speed-v1', active: true } },
    ]);
    expect(await resolveProtocolForSymbol('XAUUSD', prisma)).toEqual({ slug: 'xau-speed-v1', active: true });
  });

  // ── #1181 — `priority` alone does not ORDER, and an inactive winner SKIPS the symbol ──
  /**
   * ⚠️ THE DEFECT THESE TESTS PIN (measured 2026-11-02, #1181).
   *
   * `symbol_protocol_assignment` is unique on `(symbol, protocolId)`, NOT on `(symbol, priority)`,
   * so two protocols can claim one symbol at the same priority. Measured: EURUSD
   * (`probe-1dir-v1` + `forex-session-v1`) and XAGUSD (`probe-1dir-rsi` + `xau-speed-v1`, the
   * latter INACTIVE), all at `priority = 0`.
   *
   * Two separate faults followed:
   *   1. Ordering by `priority` alone left the winner to physical row order. It was STABLE in
   *      practice (25/25 identical calls) — which is exactly why it needed a guard: a
   *      stable-but-undefined answer passes review, then changes on a rebuild with no error.
   *   2. Because the caller SKIPS a symbol whose resolved protocol is inactive, a symbol with a
   *      perfectly good ACTIVE protocol assigned could vanish from the screener. On XAGUSD the
   *      right answer was only reached because `probe-…` sorts before `xau-…` — alphabetical luck.
   *
   * The resolver now orders by `priority` then `protocolId` AND prefers an active protocol.
   *
   * ⚠️ CANARY (measured): dropping `{ protocolId: 'asc' }` fails the determinism assertion;
   * dropping the `find(active)` preference fails the preference assertion. Restores verified
   * byte-identical.
   */
  const tiedPrisma = (
    rows: Array<{ slug: string; active: boolean | number; protocolId?: string; priority?: number }>,
  ) => {
    const findMany = jest.fn(async () =>
      rows.map((r) => ({
        protocolId: r.protocolId ?? r.slug,
        priority: r.priority ?? 0,
        protocol: { slug: r.slug, active: r.active },
      })),
    );
    return { isAvailable: true, symbolProtocolAssignment: { findMany }, findMany };
  };

  it('orders by priority AND a unique key — priority alone is not unique (#1181)', async () => {
    const prisma = tiedPrisma([{ slug: 'probe-1dir-v1', active: true }]);
    await resolveProtocolForSymbol('EURUSD', prisma as any);
    const args = prisma.findMany.mock.calls[0][0];
    expect(Array.isArray(args.orderBy)).toBe(true);
    expect(args.orderBy.length).toBeGreaterThanOrEqual(2);
    expect(args.orderBy[0]).toEqual({ priority: 'asc' });
  });

  it('the second sort key is a UNIQUE column, so the tie cannot fall through (#1181)', async () => {
    const prisma = tiedPrisma([{ slug: 'probe-1dir-v1', active: true }]);
    await resolveProtocolForSymbol('EURUSD', prisma as any);
    const second = prisma.findMany.mock.calls[0][0].orderBy[1];
    // Unique-or-near-unique identifiers only. A non-unique column (e.g. `symbol`) would leave the
    // same tie in place while looking like it had been fixed.
    expect(Object.keys(second)).toHaveLength(1);
    expect(['id', 'protocolId']).toContain(Object.keys(second)[0]);
  });

  it('the same query shape is used on every call — no per-call variation (#1181)', async () => {
    const prisma = tiedPrisma([{ slug: 'probe-1dir-v1', active: true }]);
    await resolveProtocolForSymbol('EURUSD', prisma as any);
    await resolveProtocolForSymbol('EURUSD', prisma as any);
    expect(prisma.findMany.mock.calls[0][0]).toEqual(prisma.findMany.mock.calls[1][0]);
  });

  it('PREFERS the active protocol when a tie would otherwise pick the inactive one (#1181)', async () => {
    // The real XAGUSD shape, in the order `priority, protocolId` returns it: the inactive one first.
    const prisma = tiedPrisma([
      { slug: 'xau-speed-v1', active: 0 },
      { slug: 'probe-1dir-rsi', active: 1 },
    ]);
    expect(await resolveProtocolForSymbol('XAGUSD', prisma)).toEqual({
      slug: 'probe-1dir-rsi',
      active: true,
    });
  });

  it('prefers active EVEN when the inactive protocol has the better priority (#1181)', async () => {
    // An inactive protocol can never score, so honouring its priority only produces a silent skip.
    const prisma = tiedPrisma([
      { slug: 'retired-v1', active: false, priority: 0 },
      { slug: 'live-v1', active: true, priority: 5 },
    ]);
    expect(await resolveProtocolForSymbol('XAGUSD', prisma)).toEqual({ slug: 'live-v1', active: true });
  });

  it('falls back to the inactive entry when NOTHING is active, so the skip stays visible (#1181)', async () => {
    // Returning null here would read as "no protocol assigned" — a different, wrong diagnosis.
    const prisma = tiedPrisma([{ slug: 'retired-v1', active: false }]);
    expect(await resolveProtocolForSymbol('XAGUSD', prisma)).toEqual({ slug: 'retired-v1', active: false });
  });

  it('ignores a row whose protocol relation is missing, rather than crashing (#1181)', async () => {
    const prisma = {
      isAvailable: true,
      symbolProtocolAssignment: {
        findMany: jest.fn(async () => [{ protocolId: 'x', priority: 0, protocol: null }]),
      },
    };
    // No resolvable row → falls through to the hardcoded map / null, never a TypeError.
    expect(await resolveProtocolForSymbol('UNKNOWN_SYMBOL_XYZ', prisma as any)).toBeNull();
  });

  // ── storeSnapshot: the write point refuses inactive protocols ──
  const breakdown = {
    subScores: {}, subRawTotals: {}, subMaxTotals: {}, breakouts: {},
    riskMultiplier: 1, directionMode: 'long',
    readinessGate: { ready: true, blockers: [] },
    marketStatus: { open: true, asOf: null },
    opportunityScore: 0, opportunityMax: 0, opportunityPct: 0,
    compositePct: 50, configuredSignalMax: 100,
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  function makeGating(active: boolean) {
    const svc = Object.create(ProtocolGatingService.prototype) as ProtocolGatingService;
    // ⚠️ Object.create does NOT run class-field initializers — the real class relies on them for
    // its TTL caches. Miss this and the IIFE throws on `undefined.get()` before any guard runs,
    // which reads as "the guard works" while nothing was ever tested.
    (svc as any).resolvedSymbolCache = new Map();
    (svc as any).protocolActiveCache = new Map();
    const scoreCreate = jest.fn(async () => ({}));
    const snapshotCreate = jest.fn(async () => ({}));
    (svc as any).logger = { warn: jest.fn(), log: jest.fn(), debug: jest.fn() };
    (svc as any).protocolDb = { resolveSymbols: jest.fn(async () => ['USDCAD', 'XAUUSD']) };
    (svc as any).prisma = {
      protocol: { findFirst: jest.fn(async () => ({ active })) },
      symbol: { findFirst: jest.fn(async () => ({ id: 'sym-1' })) },
      score: { create: scoreCreate },
      scoreSnapshot: { create: snapshotCreate },
      $executeRawUnsafe: jest.fn(async () => 1),
      isAvailable: true,
    };
    return { svc, scoreCreate, snapshotCreate };
  }

  it('an inactive protocol writes NOTHING — neither score nor snapshot (#803)', async () => {
    const { svc, scoreCreate, snapshotCreate } = makeGating(false);
    (svc as any).storeSnapshot('usdcad-oil-v1', 'USDCAD', 85, 'HOLD', null, breakdown);
    await flush(); await flush();
    expect(scoreCreate).not.toHaveBeenCalled();
    expect(snapshotCreate).not.toHaveBeenCalled();
    // The refusal is VISIBLE — a silent refusal is indistinguishable from a broken write path.
    const warned = ((svc as any).logger.warn as jest.Mock).mock.calls;
    expect(warned.some((c) => String(c[0]).includes('REFUSED'))).toBe(true);
  });

  it('the ACTIVE direction still writes both tables (#803 control)', async () => {
    const { svc, scoreCreate, snapshotCreate } = makeGating(true);
    (svc as any).storeSnapshot('xau-speed-v1', 'XAUUSD', 85, 'BUY', null, breakdown);
    await flush(); await flush();
    expect(snapshotCreate).toHaveBeenCalledTimes(1);
    expect(scoreCreate).toHaveBeenCalledTimes(1);
  });
});
