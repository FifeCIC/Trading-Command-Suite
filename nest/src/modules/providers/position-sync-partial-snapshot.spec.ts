import { PositionSyncService } from './position-sync.service';

/**
 * #1058 — a NON-EMPTY but INCOMPLETE snapshot must close NOTHING.
 *
 * WHY THIS SUITE EXISTS, AND WHY IT IS THE MISSING ONE
 * ----------------------------------------------------
 * The authority decision (`authoritativeFromSnapshot`) is guarded in
 * `automation-loop-snapshot-authority.spec.ts`. What was NOT covered is the contract at the SERVICE
 * boundary — and that is the half the defect actually defeated.
 *
 * `position-sync.service.ts` has always refused a NON-authoritative snapshot:
 *     if (!authoritative) { … closure detection skipped … }
 * with the standing comment *"Empty arrays caused by outages must never liquidate the local
 * projection."* That guard is correct. The caller was passing `authoritative: true` for a snapshot
 * that was non-empty merely because a DIFFERENT bridge had answered.
 *
 * ⚠️ The existing specs only ever passed `authoritative: false` with an EMPTY list
 * (`position-sync.service.spec.ts:50`). That case was never broken — an empty list is skipped by
 * the `length > 0` fallback anyway. The unprotected case is **non-empty AND incomplete**, which is
 * exactly the state at 17:39:09 on 2026-10-01, and the state in which nine live trades were closed.
 *
 * CANARY — BOTH DIRECTIONS
 * ------------------------
 * Flip the call to `{ authoritative: true }` and this suite fails on
 * `expect(closedCalls).toHaveLength(0)`. That is #1058 reproduced in miniature: one bridge's row
 * making a partial snapshot authoritative, and the absent bridge's book being closed.
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
const adapterFactory = { create: jest.fn(() => ({ getDeals: jest.fn(async () => []) })) };
let service: PositionSyncService;

const ACCOUNT = '10011309743';

/** The position the SURVIVING bridge reports — broker 3's one row, as on 2026-10-01. */
const SURVIVING_ROW = {
  symbol: 'US500', brokerTicket: '92811315', side: 'buy' as const,
  quantity: 0.1, avgPrice: 7667.2, currentPrice: 7670.3, pnl: 0.31,
  sl: 7452.3, tp: null, comment: 'TCS US SPY Speed', openedAt: new Date('2026-10-01T13:43:20Z'),
  accountId: ACCOUNT,
};

/** A position held by the bridge that did NOT answer. Absent from the snapshot — not closed. */
const DB_ROW = {
  id: 'pos-xauusd', symbol: 'XAUUSD', provider: 'mt5', brokerTicket: '152710812706',
  accountId: ACCOUNT, side: 'buy' as const, quantity: 0.01, avgPrice: 4184.04,
  currentPrice: 4176.6, pnl: -11.28, openedAt: new Date('2026-10-01T12:43:16Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  balance.upsert.mockResolvedValue({});
  balance.delete.mockResolvedValue({});
  trade.findMany.mockResolvedValue([]);
  trade.create.mockResolvedValue({ id: 'created' });
  trade.update.mockResolvedValue({});
  trade.updateMany.mockResolvedValue({ count: 0 });
  service = new PositionSyncService(prisma as any, adapterFactory as any);
});

describe('PositionSyncService — a partial snapshot closes nothing (#1058)', () => {
  it('⭐ NON-EMPTY but NOT authoritative → zero closures', async () => {
    // The book the surviving bridge cannot see. It is REAL and it is ABSENT from this snapshot.
    balance.findMany.mockResolvedValue([DB_ROW]);
    trade.findFirst.mockResolvedValue({ id: 't-xauusd', symbol: 'XAUUSD', status: 'open', accountId: ACCOUNT });
    trade.findMany.mockResolvedValue([{
      id: 't-xauusd', symbol: 'XAUUSD', openedAt: new Date('2026-10-01T12:43:16Z'),
      brokerTicket: '152710812706', side: 'buy', pnl: 0, exitPrice: null, accountId: ACCOUNT,
    }]);

    const result = await service.syncPositions('mt5', [SURVIVING_ROW as any], {
      // ⚠️ THE CANARY VALUE. This is what a partial snapshot is. The `||` made it `true`.
      authoritative: false, accountId: ACCOUNT,
    });

    const closedCalls = trade.update.mock.calls.filter((c: any) => c[0]?.data?.status === 'closed');
    expect(closedCalls).toHaveLength(0);
    expect(result.closed).toBe(0);
    // The surviving position is still recorded — refusing to close is not refusing to sync.
    expect(balance.upsert).toHaveBeenCalled();
  });

  it('⚠️ CANARY — the SAME snapshot marked authoritative DOES close it', async () => {
    // ⚠️ This test asserts the DANGEROUS behaviour deliberately, so the suite proves the distinction
    // is real rather than assuming the flag is read. Without it, a `syncPositions()` that ignored
    // `authoritative` entirely would pass the test above and look correct.
    balance.findMany.mockResolvedValue([DB_ROW]);
    trade.findFirst.mockResolvedValue({ id: 't-xauusd', symbol: 'XAUUSD', status: 'open', accountId: ACCOUNT });
    trade.findMany.mockResolvedValue([{
      id: 't-xauusd', symbol: 'XAUUSD', openedAt: new Date('2026-10-01T12:43:16Z'),
      brokerTicket: '152710812706', side: 'buy', pnl: 0, exitPrice: null, accountId: ACCOUNT,
    }]);

    await service.syncPositions('mt5', [SURVIVING_ROW as any], {
      authoritative: true, accountId: ACCOUNT,
    });

    const closedCalls = trade.update.mock.calls.filter((c: any) => c[0]?.data?.status === 'closed');
    expect(closedCalls.length).toBeGreaterThan(0);
  });
});
