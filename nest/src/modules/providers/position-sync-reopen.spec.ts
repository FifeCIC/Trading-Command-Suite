import { Logger } from '@nestjs/common';
import { PositionSyncService } from './position-sync.service';

/**
 * #1057 — a ticket the broker reports OPEN, whose Trade row is CLOSED, must be REOPENED, not
 * duplicated.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * `reconcileTrade()` matched on `{ provider, status: 'open', brokerTicket }`. A CLOSED row for the
 * same ticket is invisible to that predicate, so the code fell through to `2c` and tried to
 * `create` a second row — and the unique index `Trade_provider_brokerTicket_key` is on
 * `(provider, brokerTicket)` and is **NOT status-scoped**, so the create could only ever raise.
 *
 * MEASURED 2026-10-01: **56** occurrences across **8** symbols in one ~20-minute process lifetime —
 * and those 8 symbols were exactly the 8 rows closed by the partial-snapshot defect (#1058). So the
 * noise was the SOUND of #1058, and this is the write path that had no way to say so.
 *
 * ⚠️ CANARY — BOTH DIRECTIONS
 * --------------------------
 * Delete the reopen block in `reconcileTrade()` and the first test fails on
 * `expect(trade.create).not.toHaveBeenCalled()`: the code returns to raising a constraint violation
 * every cycle. Restore it and the suite passes. A guard that has never been observed to fail is a
 * decoration.
 *
 * ⚠️ The decision to REOPEN rather than merely report is registered in `docs/SETTLED-DECISIONS.md`
 * and marked at the code site. It is a money-path write, so it is asserted rather than assumed.
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

const TICKET = '152710812706'; // XAUUSD — one of the three still open at the broker

/** The position as the bridge reports it: OPEN, with a live stop. */
const BROKER_ROW = {
  symbol: 'XAUUSD', brokerTicket: TICKET, side: 'buy' as const,
  quantity: 0.01, avgPrice: 4184.04, currentPrice: 4176.6, pnl: -11.28,
  sl: 4123.12, tp: null, comment: 'TCS Gold Swing 1H', openedAt: new Date('2026-10-01T12:43:16Z'),
  accountId: '10011309743',
};

/** The row the partial-snapshot defect left behind. */
const CLOSED_ROW = {
  id: 'trade-xauusd', symbol: 'XAUUSD', provider: 'mt5', status: 'closed',
  brokerTicket: TICKET, closeReason: 'broker:unknown', closedAt: new Date('2026-10-01T17:39:15Z'),
  exitPrice: null, pnl: 0, pnlInvalid: 1, sl: 4123.12, tp: null, brokerComment: 'TCS Gold Swing 1H',
};

beforeEach(() => {
  jest.clearAllMocks();
  balance.upsert.mockResolvedValue({});
  balance.findMany.mockResolvedValue([]);
  balance.delete.mockResolvedValue({});
  trade.findMany.mockResolvedValue([]);
  trade.create.mockResolvedValue({ id: 'created' });
  trade.update.mockResolvedValue({});
  trade.updateMany.mockResolvedValue({ count: 0 });
  service = new PositionSyncService(prisma as any, adapterFactory as any);
});

describe('PositionSyncService — a closed row for a live ticket (#1057)', () => {
  it('⭐ REOPENS it instead of attempting a create that must collide', async () => {
    // 1st findFirst: the status:'open' lookup → nothing (the row is closed).
    // 2nd findFirst: the status-agnostic lookup → the closed row.
    trade.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(CLOSED_ROW);

    await service.syncPositions('mt5', [BROKER_ROW as any], {
      authoritative: true, accountId: '10011309743',
    });

    // ⚠️ THE CANARY ASSERTION. Without the reopen block this is 1 — the 56-a-day storm.
    expect(trade.create).not.toHaveBeenCalled();

    const reopen = trade.update.mock.calls.find((c: any) => c[0]?.data?.status === 'open');
    expect(reopen).toBeDefined();
    expect(reopen![0].where).toEqual({ id: 'trade-xauusd' });
    // The close artefacts go with it — a reopened row that still says when it closed is a row that
    // lies in a new way.
    expect(reopen![0].data).toMatchObject({
      status: 'open', closedAt: null, closeReason: null, pnlInvalid: 0, pnlInvalidReason: null,
    });
  });

  it('⭐ NAMES the disagreement rather than repairing it silently', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    trade.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(CLOSED_ROW);

    await service.syncPositions('mt5', [BROKER_ROW as any], {
      authoritative: true, accountId: '10011309743',
    });

    const said = warn.mock.calls.map((c: any) => String(c[0])).join('\n');
    expect(said).toContain('DISAGREEMENT');
    expect(said).toContain(TICKET);
    // The reason it is safe to reopen is stated in the line, not left to the reader.
    expect(said).toContain('broker reports it OPEN');
    warn.mockRestore();
  });

  it('does NOT touch the row when the position is already open (the normal path)', async () => {
    trade.findFirst.mockResolvedValueOnce({ ...CLOSED_ROW, status: 'open', closedAt: null });

    await service.syncPositions('mt5', [BROKER_ROW as any], {
      authoritative: true, accountId: '10011309743',
    });

    // The ordinary path updates sl/tp/comment and must not be disturbed by the reopen branch.
    const statuses = trade.update.mock.calls
      .map((c: any) => c[0]?.data?.status)
      .filter(Boolean);
    expect(statuses).toEqual([]);
  });

  it('still CREATES a row for a genuinely unknown ticket (the fix must not disable 2c)', async () => {
    // Both lookups miss — this position really was opened outside the app.
    trade.findFirst.mockResolvedValue(null);

    await service.syncPositions('mt5', [BROKER_ROW as any], {
      authoritative: true, accountId: '10011309743',
    });

    expect(trade.create).toHaveBeenCalledTimes(1);
    expect(trade.create.mock.calls[0][0].data).toMatchObject({
      symbol: 'XAUUSD', status: 'open', origin: 'external', brokerTicket: TICKET,
    });
  });
});
