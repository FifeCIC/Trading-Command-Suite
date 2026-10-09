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
    symbolProtocolAssignment: { findFirst: jest.fn(async () => null) },
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
    prisma.symbolProtocolAssignment.findFirst = jest.fn(async () => ({
      protocol: { slug: 'xau-speed-v1', active: true },
    }));
    expect(await resolveProtocolForSymbol('XAUUSD', prisma)).toEqual({ slug: 'xau-speed-v1', active: true });
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
