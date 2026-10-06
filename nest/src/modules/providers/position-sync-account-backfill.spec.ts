import { PositionSyncService } from './position-sync.service';

/**
 * #889 follow-up (2026-10-06) — app-opened trades must acquire their ACCOUNT.
 *
 * WHAT WAS MEASURED. Every trade row created by `TradeRecorder` on the dispatch path carried
 * `accountId = NULL` (19 of 19 rows for one live bot) while `syncPositions()` knew the account on
 * every pass — the 2a (ticket match) update wrote sl/tp/comment and never the column, so rows
 * stayed anonymous forever. Only rows created BY the sync (2c, externally-opened) ever got one,
 * which is why the gap was invisible: the column was demonstrably populated on *some* rows.
 *
 * WHY IT MATTERS NOW. With `MT5_ACTIVE_BROKERS=2,3` two broker accounts sit behind ONE provider id
 * (`mt5`), and `accountId` is the identity that makes account-scoped reconciliation expressible at
 * all (#883/#889). A NULL account is judged by every scoped snapshot — the "dangerous case" the
 * broker-scope suite documents.
 *
 * THE RULE PINNED HERE — FILL-ONLY. `byTicket.accountId ?? pos.accountId`:
 *   - a known account is NEVER overwritten (a ticket collision across the two `mt5` accounts must
 *     not reassign a row);
 *   - NULL on both sides stays NULL rather than becoming a fabricated value.
 *
 * CANARY: removing the `accountId` field from the 2a update fails the first test below (observed
 * during this change — see the handoff).
 */
describe('PositionSyncService — accountId backfill (#889 follow-up)', () => {
  const position = {
    upsert: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(),
    create: jest.fn(), update: jest.fn(), delete: jest.fn(), updateMany: jest.fn(),
  };
  const trade = {
    findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(),
    update: jest.fn(), updateMany: jest.fn(),
  };
  const prisma = { isAvailable: true, position, trade };
  const adapter = { getDeals: jest.fn() };
  const adapterFactory = { create: jest.fn(() => adapter) };
  let service: PositionSyncService;

  const ACCOUNT = '10011309743'; // MetaQuotes (broker 2)
  const TICKET = '152730926765';

  const POS = {
    symbol: 'EURJPY', brokerTicket: TICKET, side: 'buy', quantity: 0.01,
    avgPrice: 178.073, currentPrice: 178.11, pnl: 0, accountId: ACCOUNT,
    sl: 176.288, tp: 179.85, comment: 'TCS Tokyo EURJPY Session',
    openedAt: new Date('2026-10-06T17:29:20Z'),
  };
  const POSITION_ROW = {
    id: 'p-1', symbol: 'EURJPY', provider: 'mt5', brokerTicket: TICKET,
    accountId: ACCOUNT, side: 'buy', quantity: 0.01, avgPrice: 178.073, currentPrice: 178.11,
    pnl: 0, openedAt: POS.openedAt,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    position.upsert.mockResolvedValue({});
    position.findFirst.mockResolvedValue(null);
    position.findMany.mockResolvedValue([POSITION_ROW]);
    trade.findFirst.mockResolvedValue(null);
    trade.findMany.mockResolvedValue([]);
    trade.create.mockResolvedValue({ id: 'created' });
    trade.update.mockResolvedValue({});
    trade.updateMany.mockResolvedValue({ count: 0 });
    adapter.getDeals.mockResolvedValue([]);
    service = new PositionSyncService(prisma as any, adapterFactory as any);
  });

  it('fills accountId on the ticket-matched row that the dispatch path left NULL', async () => {
    trade.findFirst.mockResolvedValue({
      id: 't-1', accountId: null, sl: null, tp: null, brokerComment: 'TCS Tokyo EURJPY Session',
    });

    await service.syncPositions('mt5', [POS as any], { authoritative: true, accountId: ACCOUNT });

    const update = trade.update.mock.calls.find((c: any) => c[0]?.where?.id === 't-1');
    expect(update).toBeTruthy();
    expect(update[0].data.accountId).toBe(ACCOUNT);
    // The other fields still behave as before (fill-if-present).
    expect(update[0].data.sl).toBe(176.288);
    expect(update[0].data.tp).toBe(179.85);
  });

  it('NEVER overwrites a known account — fill-only', async () => {
    trade.findFirst.mockResolvedValue({
      id: 't-2', accountId: '99999999', sl: null, tp: null, brokerComment: null,
    });

    await service.syncPositions('mt5', [POS as any], { authoritative: true, accountId: ACCOUNT });

    const update = trade.update.mock.calls.find((c: any) => c[0]?.where?.id === 't-2');
    expect(update).toBeTruthy();
    expect(update[0].data.accountId).toBe('99999999');
    expect(trade.update.mock.calls.some((c: any) => c[0]?.data?.accountId === ACCOUNT)).toBe(false);
  });
});
