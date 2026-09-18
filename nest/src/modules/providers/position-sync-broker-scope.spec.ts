import { PositionSyncService } from './position-sync.service';

/**
 * #889 — an account-scoped sync must not judge a trade it cannot see.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * `syncPositions()` reconciles by asking "is this trade's ticket in MY snapshot?" and treats
 * absence as closure. When one `provider` id covers several broker accounts — `MT5_ACTIVE_BROKERS=2,3`
 * runs MetaQuotes and Pepperstone under the single provider `mt5` — that question is only valid for
 * trades the sync can actually observe.
 *
 * On 2026-09-18 it was asked of trades it could not observe, and the answer "absent" was read as
 * "closed": two LIVE Pepperstone VIX positions were written `closed` with `exitPrice=NULL` while
 * the broker still held them. #883 fixed the specific path by making the snapshot complete; #889
 * adds the identity that makes the scope expressible at all.
 *
 * ⚠️ `accountId IS NULL` IS THE DANGEROUS CASE
 * -------------------------------------------
 * Legacy rows have no account. An account-scoped sync must NOT close them, because "I don't know
 * which broker this is" is not the same as "this broker says it's gone". Only an all-account
 * snapshot — where absence genuinely means closed — may judge them. That distinction is the whole
 * reason this column exists rather than a heuristic.
 */

const balance = {
  upsert: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(),
  create: jest.fn(), update: jest.fn(), delete: jest.fn(),
};
const trade = {
  findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(),
  update: jest.fn(), updateMany: jest.fn(),
};
const prisma = { isAvailable: true, position: balance, trade };
const adapter = { getDeals: jest.fn() };
const adapterFactory = { create: jest.fn(() => adapter) };
let service: PositionSyncService;

const ACCOUNT_A = '10011309743'; // MetaQuotes
const ACCOUNT_B = '62135531';    // Pepperstone

const ACCOUNT_A_ROW = {
  id: 'pos-a', symbol: 'EURGBP', provider: 'mt5', brokerTicket: '152648715111',
  accountId: ACCOUNT_A, side: 'buy' as const, quantity: 0.1, avgPrice: 0.86,
  currentPrice: 0.862, pnl: 1, openedAt: new Date('2026-09-17T17:54:41Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  balance.upsert.mockResolvedValue({});
  balance.findMany.mockResolvedValue([]);
  balance.delete.mockResolvedValue({});
  trade.findMany.mockResolvedValue([]);
  trade.findFirst.mockResolvedValue(null);
  trade.create.mockResolvedValue({ id: 'created' });
  trade.update.mockResolvedValue({});
  trade.updateMany.mockResolvedValue({ count: 0 });
  adapter.getDeals.mockResolvedValue([]);
  service = new PositionSyncService(prisma as any, adapterFactory as any);
});

describe('PositionSyncService — broker scope (#889)', () => {
  describe('⭐ the guard that stops cross-broker closure', () => {
    it('does NOT close a trade belonging to a DIFFERENT account', async () => {
      // Account A's sync sees only its own open position. The VIX trade below belongs to B and is
      // absent from A's snapshot — which is exactly the state that closed it on 2026-09-18.
      balance.findMany.mockResolvedValue([ACCOUNT_A_ROW]);
      trade.findFirst.mockResolvedValue({
        id: 'vix-b', symbol: 'VIX', side: 'buy', accountId: ACCOUNT_B,
      });
      trade.findMany.mockResolvedValue([{
        id: 'vix-b', symbol: 'VIX', openedAt: new Date('2026-09-18T16:58:01Z'),
        brokerTicket: '90555750', side: 'buy', pnl: 0, exitPrice: null, accountId: ACCOUNT_B,
      }]);

      const result = await service.syncPositions('mt5', [ACCOUNT_A_ROW as any], {
        authoritative: true, accountId: ACCOUNT_A,
      });

      const closed = trade.update.mock.calls.filter((c: any) => c[0]?.data?.status === 'closed');
      expect(closed).toHaveLength(0);
      expect(result.reaped).toBe(0);
    });

    it('⚠️ DOES judge a trade whose account is UNKNOWN — legacy rows must stay reconcilable', async () => {
      // ⚠️ THIS TEST ASSERTS THE OPPOSITE OF THE OBVIOUS-LOOKING DESIGN, and it is here because the
      // first version of the guard got it wrong.
      //
      // Blocking unknown-account trades LOOKS safer. It is strictly worse: the 2026-09-10
      // regression (`finalizes a legacy row (no ticket, no account) that is gone from the broker`)
      // exists because legacy `accountId IS NULL` position rows must still be reconciled. Refusing
      // them leaves a closed position sitting in `position` forever, which also keeps the duplicate
      // guard for that symbol shut.
      //
      // The safety for the unknown case comes from #883 — a COMPLETE snapshot, plus an
      // `authoritative` flag that requires every broker to answer — not from this guard. The guard
      // is defence-in-depth for accounts that are genuinely BOTH known.
      balance.findMany.mockResolvedValue([{ ...ACCOUNT_A_ROW, brokerTicket: '999' }]);
      trade.findFirst.mockResolvedValue({ id: 'legacy', symbol: 'EURGBP', accountId: null });

      const result = await service.syncPositions('mt5', [ACCOUNT_A_ROW as any], {
        authoritative: true, accountId: ACCOUNT_A,
      });

      expect(result.closed).toBe(1);
    });

    it('DOES close a trade in the SAME account when it is gone from the snapshot', async () => {
      // The guard must not disable the feature. A same-account disappearance is a real closure.
      balance.findMany.mockResolvedValue([{ ...ACCOUNT_A_ROW, brokerTicket: '999' }]);
      trade.findFirst.mockResolvedValue({
        id: 'gone-a', symbol: 'EURGBP', side: 'buy', accountId: ACCOUNT_A,
      });

      const result = await service.syncPositions('mt5', [ACCOUNT_A_ROW as any], {
        authoritative: true, accountId: ACCOUNT_A,
      });

      expect(result.closed).toBe(1);
    });

    it('an ALL-ACCOUNT sync may judge anything absent from the union', async () => {
      // accountId null = the merged snapshot of every broker, where absence really does mean
      // closed. This is the path the automation loop now uses after #883.
      balance.findMany.mockResolvedValue([{ ...ACCOUNT_A_ROW, brokerTicket: '999' }]);
      trade.findFirst.mockResolvedValue({ id: 'gone', symbol: 'EURGBP', accountId: ACCOUNT_A });

      const result = await service.syncPositions('mt5', [ACCOUNT_A_ROW as any], {
        authoritative: true, accountId: null,
      });

      expect(result.closed).toBe(1);
    });
  });

  describe('the reaper honours the same scope', () => {
    it('does NOT reap a ticketed trade from another account', async () => {
      trade.findMany.mockResolvedValue([{
        id: 'vix-b', symbol: 'VIX', openedAt: new Date('2026-09-18T16:58:01Z'),
        brokerTicket: '90555750', side: 'buy', pnl: 0, exitPrice: null, accountId: ACCOUNT_B,
      }]);
      // ⚠️ REQUIRED for this test to mean anything. Left unmocked, `findFirst` resolves null, so the
      // finaliser would find no trade and report 0 **whether or not the guard exists** — a green
      // test that proves nothing. Returning the closable row means: guard present → the finaliser is
      // never reached; guard absent → it closes and this fails.
      trade.findFirst.mockResolvedValue({
        id: 'vix-b', symbol: 'VIX', side: 'buy', accountId: ACCOUNT_B,
      });

      const result = await service.syncPositions('mt5', [], {
        authoritative: true, accountId: ACCOUNT_A,
      });

      expect(result.reaped).toBe(0);
      // The finaliser must not have been entered at all, not merely have failed to close.
      expect(trade.findFirst).not.toHaveBeenCalled();
      const closed = trade.update.mock.calls.filter((c: any) => c[0]?.data?.status === 'closed');
      expect(closed).toHaveLength(0);
    });

    it('does NOT reap an UNTICKETED trade from another account either', async () => {
      // The unticketed branch has its own path; the scope check must be before the branch, not
      // inside one of them, or half the leak survives.
      trade.findMany.mockResolvedValue([{
        id: 'legacy-b', symbol: 'USDCAD', openedAt: new Date('2026-07-24T18:41:05Z'),
        brokerTicket: null, accountId: ACCOUNT_B,
      }]);
      trade.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.syncPositions('mt5', [], {
        authoritative: true, accountId: ACCOUNT_A,
      });

      expect(result.reaped).toBe(0);
      expect(trade.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('new trades record their account', () => {
    it('stamps accountId on a trade created from a broker position', async () => {
      // Without this the created row joins the NULL pool and is visible to every broker's sync —
      // re-creating the leak for everything opened from now on.
      await service.syncPositions('mt5', [ACCOUNT_A_ROW as any], {
        authoritative: true, accountId: ACCOUNT_A,
      });

      expect(trade.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ accountId: ACCOUNT_A }),
      }));
    });
  });
});
