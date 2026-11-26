/**
 * watchlists-lock-endpoint.spec.ts — the two WAYS a watchlist can be linked to a protocol (#1349).
 *
 * ── THE DEFECT, MEASURED ON THE LIVE API 2026-11-26 09:15 UTC ─────────────────────────────────────
 * `GET /api/watchlists/44f1bdb1…/lock-status` → `{"locked":false,"strategies":[]}` for `silver (B)`,
 * a watchlist whose OWN row declares `protocolId: "xau-speed-v1-long-copy"`. The endpoint read only
 * `scoring_strategy.watchlistId`, which that watchlist has no rows for, so it named no strategy and
 * could not have refused anything. Reading one of the two links is the same defect as reading a
 * column that does not exist: the guard answers, confidently, and is not doing its job.
 *
 * The two links, both measured:
 *   · `scoring_strategy.watchlistId` → `.protocolId`   (a SLUG)
 *   · `watchlist.protocolId`                            (a UUID on 20 rows, a slug on one)
 *
 * ⚠️ CANARY: delete the `declared` half of `evaluateLock` and "locks on the watchlist's OWN declared
 * protocol" fails. Delete the `linked` half and the `scoring_strategy` test fails.
 */
import { WatchlistsController } from './watchlists.controller';

const UUID_XAU = 'c52d57be-f9c9-49cd-bc37-6994b743bdc8';

function make(stub: {
  scoringStrategy?: unknown[];
  watchlistProtocolId?: string | null;
  protocols?: Array<{ id: string; slug: string }>;
  bots?: Array<{ protocolId: string; magic: number | null }>;
  positions?: Array<{ id: string; magic: number | null }>;
  trades?: Array<{ id: string; magic: number | null }>;
}) {
  const svc = Object.create(WatchlistsController.prototype) as WatchlistsController;
  (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  (svc as any).prisma = {
    scoringStrategy: { findMany: jest.fn(async () => stub.scoringStrategy ?? []) },
    watchlist: { findUnique: jest.fn(async () => ({ protocolId: stub.watchlistProtocolId ?? null })) },
    protocol: { findMany: jest.fn(async () => stub.protocols ?? []) },
    tradingStrategy: { findMany: jest.fn(async () => stub.bots ?? []) },
    position: { findMany: jest.fn(async () => stub.positions ?? []) },
    trade: { findMany: jest.fn(async () => stub.trades ?? []) },
  };
  (svc as any).t212 = {};
  return svc;
}

describe('GET /:id/lock-status — both protocol links are read', () => {
  it('locks on the watchlist’s OWN declared protocol, which has no scoring_strategy row', async () => {
    const svc = make({
      scoringStrategy: [],
      watchlistProtocolId: 'xau-speed-v1-long-copy',
      protocols: [{ id: UUID_XAU, slug: 'xau-speed-v1-long-copy' }],
      bots: [{ protocolId: 'xau-speed-v1-long-copy', magic: 234141 }],
      positions: [{ id: 'p1', magic: 234141 }],
    });
    const r = (await svc.getLockStatus('silver-b')) as Record<string, unknown>;
    expect(r.locked).toBe(true);
    expect(r.activePositions).toBe(1);
    expect(r.magics).toEqual([234141]);
  });

  it('locks through scoring_strategy when the watchlist itself declares no protocol', async () => {
    const svc = make({
      scoringStrategy: [{ id: 'ss-1', name: 'MT5 Technical Core', protocolId: 'mt5-technical-core-v1-long', enabled: true }],
      watchlistProtocolId: null,
      protocols: [{ id: 'e5aca9ce-ad37-11f1-951d-9c6b00b28963', slug: 'mt5-technical-core-v1-long' }],
      bots: [{ protocolId: 'mt5-technical-core-v1-long', magic: 234144 }],
      trades: [{ id: 't1', magic: 234144 }],
    });
    const r = (await svc.getLockStatus('forex-majors')) as Record<string, unknown>;
    expect(r.locked).toBe(true);
    expect(r.strategies).toEqual(['MT5 Technical Core']);
  });

  it('reports unattributable live rows WITHOUT locking — measured state is 13 of 13', async () => {
    const svc = make({
      scoringStrategy: [{ id: 'ss-1', name: 'Core', protocolId: 'mt5-technical-core-v1-long', enabled: true }],
      protocols: [{ id: UUID_XAU, slug: 'mt5-technical-core-v1-long' }],
      bots: [{ protocolId: 'mt5-technical-core-v1-long', magic: 234144 }],
      positions: [{ id: 'p1', magic: null }, { id: 'p2', magic: null }, { id: 'p3', magic: 234000 }],
    });
    const r = (await svc.getLockStatus('x')) as Record<string, unknown>;
    expect(r.locked).toBe(false);
    expect(r.unattributable).toBe(3);
  });

  it('says so when the protocol has no bot with a magic, instead of implying the book is empty', async () => {
    const svc = make({
      scoringStrategy: [],
      watchlistProtocolId: 'xau-speed-v1-long-copy',
      protocols: [{ id: UUID_XAU, slug: 'xau-speed-v1-long-copy' }],
      bots: [{ protocolId: 'xau-speed-v1-long-copy', magic: null }],
      positions: [{ id: 'p1', magic: 234141 }],
    });
    const r = (await svc.getLockStatus('silver-b')) as Record<string, unknown>;
    expect(r.locked).toBe(false);
    expect(r.protocolWithoutBotMagic).toBe(true);
  });

  it('answers `locked: null` when the read fails — never `false`, which reads as permission', async () => {
    const svc = make({});
    (svc as any).prisma.scoringStrategy.findMany = jest.fn(async () => {
      throw new Error('table unavailable');
    });
    const r = (await svc.getLockStatus('x')) as Record<string, unknown>;
    expect(r.locked).toBeNull();
    expect(String(r.error)).toContain('table unavailable');
  });

  it('DELETE refuses when the lock read fails, rather than deleting on an unreadable guard', async () => {
    const svc = make({});
    (svc as any).prisma.watchlist.findUnique = jest.fn(async () => ({ id: 'x', protocolId: null }));
    (svc as any).prisma.scoringStrategy.findMany = jest.fn(async () => {
      throw new Error('table unavailable');
    });
    await expect(svc.deleteWatchlist('x')).rejects.toThrow(/table unavailable/);
  });

  it('DELETE refuses with the magic named when a live position matches', async () => {
    const svc = make({
      scoringStrategy: [],
      watchlistProtocolId: 'xau-speed-v1-long-copy',
      protocols: [{ id: UUID_XAU, slug: 'xau-speed-v1-long-copy' }],
      bots: [{ protocolId: 'xau-speed-v1-long-copy', magic: 234141 }],
      positions: [{ id: 'p1', magic: 234141 }],
    });
    (svc as any).prisma.watchlist.findUnique = jest.fn(async () => ({ id: 'silver-b', protocolId: 'xau-speed-v1-long-copy' }));
    (svc as any).prisma.watchlist.delete = jest.fn(async () => ({}));
    await expect(svc.deleteWatchlist('silver-b')).rejects.toThrow(/locked/);
    expect((svc as any).prisma.watchlist.delete).not.toHaveBeenCalled();
  });
});
