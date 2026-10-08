import { PositionSyncService } from './position-sync.service';

/**
 * #871 — TICKETED open trades that neither reconciler can reach.
 *
 * Kept as its own suite rather than appended to `position-sync.service.spec.ts` because it tests a
 * distinct branch with its own safety argument, and because the older file's shared `beforeEach`
 * carries implementations between tests — see the mock note below.
 *
 * ⚠️ THE GAP THIS CLOSES
 *
 * `position` and `trade` are reconciled by two paths, and a Trade **with a ticket** whose Position
 * row was gone fell through BOTH:
 *
 *   1. `finalizeClosedPosition()` is driven by rows still present in `position` — so if the Position
 *      row had already been cleaned, the Trade was never visited.
 *   2. `reapStrandedTrades()` explicitly filtered `brokerTicket: null` — so a ticketed row was never
 *      even a candidate.
 *
 * Result: `status='open'` forever, with no broker counterpart.
 *
 * Measured 2026-09-18: **5** such rows against 5 live broker positions (10 open trades in total) —
 * and growing. The issue recorded 3; two further VIX orphans appeared the same day it was written,
 * which is the argument for closing the class rather than the rows.
 *
 * ⚠️ WHY THE TICKETED CASE IS NOT CLOSED THE SAME WAY AS THE UNTICKETED ONE
 *
 * An unticketed row is a phantom that never existed at the broker, so `pnl: 0` is the TRUTH.
 * A ticketed row genuinely existed — the ticket is proof — so `pnl: 0` would be a fabricated
 * figure in the ledger. The ticketed branch therefore routes through `finalizeClosedPosition()`,
 * which resolves the real exit price and realised P&L from broker deal history.
 */

const basePosition = {
  symbol: 'EURUSD', brokerTicket: '152654644455', side: 'buy' as const, quantity: 0.1,
  avgPrice: 1.148, currentPrice: 1.14834, pnl: 0, sl: null, tp: null,
  comment: '', openedAt: new Date('2026-09-18T17:22:45Z'),
};

describe('PositionSyncService — ticketed orphans (#871)', () => {
  const position = {
    upsert: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(),
    create: jest.fn(), update: jest.fn(), delete: jest.fn(),
  };
  const trade = {
    findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(),
    update: jest.fn(), updateMany: jest.fn(),
    /** ⚠️ Required for #1014 — the reconciler counts rows sharing a position before booking P&L.
     *  See the longer note in `position-sync.service.spec.ts`; the same false-pass argument applies
     *  here: an unmocked Prisma method throws, the reconciler refuses to book, and a test asserting
     *  a P&L then fails for a reason unrelated to what it is testing. */
    count: jest.fn(),
  };
  const prisma = { isAvailable: true, position, trade };
  const adapter = { getDeals: jest.fn() };
  const adapterFactory = { create: jest.fn(() => adapter) };
  let service: PositionSyncService;

  beforeEach(() => {
    jest.clearAllMocks();
    position.upsert.mockResolvedValue({});
    position.findMany.mockResolvedValue([]);
    /**
     * ⚠️ `position.delete` MIRRORS PRISMA, AND THAT IS THE POINT (#1014).
     *
     * It used to be `mockResolvedValue({})` — a mock that accepts ANY argument. `finalizeClosedPosition`
     * ends with `position.delete({ where: { id: dbPos.id } })`, and on the REAP path `dbPos` is
     * synthesised from a `trade` row, so `dbPos.id` is `undefined`. Real Prisma REJECTS that
     * (`needs at least one of id or provider_brokerTicket`) and throws — after the trade update — so
     * the reaper closed a row, swallowed the throw via `.catch(() => 0)`, and reported **"0 reaped"**.
     *
     * The lenient mock is precisely why this suite passed while the behaviour was broken: it
     * certified a call shape Prisma does not accept. A mock that cannot fail for the right reason is
     * the same defect as a guard that cannot fail for the right reason.
     */
    position.delete.mockImplementation(({ where }: any) => {
      if (where?.id == null) {
        return Promise.reject(new Error(
          'Argument `where` of type PositionWhereUniqueInput needs at least one of `id` or ' +
          '`provider_brokerTicket` arguments.',
        ));
      }
      return Promise.resolve({});
    });

    trade.update.mockResolvedValue({});
    trade.updateMany.mockResolvedValue({ count: 0 });
    trade.findMany.mockResolvedValue([]);
    trade.findFirst.mockResolvedValue(null);
    trade.count.mockResolvedValue(1);
    /**
     * ⚠️ `trade.create` MUST be mocked, and leaving it out is a FALSE-PASS generator, not an
     * omission. `reconcileTrade()` calls `trade.create()` whenever a broker position has no
     * matching Trade row. Unmocked it returns `undefined`, so the `.catch()` chained onto it
     * throws, the outer catch swallows the error, and `syncPositions()` returns its all-zero
     * result — meaning a test asserting `reaped === 0` goes GREEN WITHOUT THE REAPER EVER RUNNING.
     *
     * Observed live while writing this suite: the "NEVER touches a ticketed Trade" guard passed
     * while the log read `Position sync failed: Cannot read properties of undefined`. A guard
     * that cannot fail for the right reason is not a guard — and this one was hiding the very
     * behaviour it claimed to prove.
     */
    trade.create.mockResolvedValue({ id: 'created-trade' });
    adapter.getDeals.mockResolvedValue([]);

    service = new PositionSyncService(prisma as any, adapterFactory as any);
  });

  it('finalises a TICKETED open Trade the broker no longer reports', async () => {
    trade.findMany.mockResolvedValue([{
      id: 'orphan-1', symbol: 'GER40', openedAt: new Date('2026-09-15T19:28:37Z'),
      brokerTicket: '89649760', side: 'buy', pnl: 0, exitPrice: null,
    }]);
    trade.findFirst.mockResolvedValue({ id: 'orphan-1', symbol: 'GER40', side: 'buy' });
    // Long opened @23700, closed @23500 for -200 less -3 commission and -1 swap.
    adapter.getDeals.mockResolvedValue([
      { positionId: '89649760', symbol: 'GER40', side: 'buy', volume: 0.1, price: 23700, profit: 0, commission: 0, swap: 0, time: new Date('2026-09-15T19:28:37Z') },
      { positionId: '89649760', symbol: 'GER40', side: 'sell', volume: 0.1, price: 23500, profit: -200, commission: -3, swap: -1, time: new Date('2026-09-16T09:00:00Z') },
    ]);

    const result = await service.syncPositions('mt5', [], { authoritative: true });

    expect(result.reaped).toBe(1);
    const updateArg: any = trade.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe('closed');
    // ⚠️ The whole point: a REAL exit, not a fabricated zero.
    expect(updateArg.data.exitPrice).toBe(23500);
    expect(updateArg.data.pnl).toBeCloseTo(-204, 2);
    // ⚠️ #1044 — and the flag must move WITH the evidence: a real exit means a usable result.
    // Without this assertion a future fix could latch `pnlInvalid: 1` on and silently hide every
    // good number behind it (the #1014 "repair looks half-done" shape).
    expect(updateArg.data.pnlInvalid).toBe(0);
    expect(updateArg.data.pnlInvalidReason).toBeNull();
  });

  /**
   * #1044 — the writer, measured live.
   *
   * Every Trade is CREATED with `pnl: 0`, so a close that captured no exit price still carried a
   * non-null `pnl`. `pnlUnknown` was derived from `pnlValue == null`, so those rows were written
   * `pnlInvalid: 0` — a placeholder zero recorded as a VALID break-even result.
   *
   * Measured 2026-10-01: **21 such rows**, the newest written that morning. They are invisible to
   * a `pnlInvalid`-only filter, which is why two consumers of the same table disagreed about its
   * size (264 rows vs 243) and neither reported an error.
   */
  it('⚠️ flags a close with NO exit price even when pnl is a stale 0 from creation (#1044)', async () => {
    trade.findMany.mockResolvedValue([{
      id: 'phantom-zero', symbol: 'US500', openedAt: new Date('2026-09-29T12:59:22Z'),
      brokerTicket: '92271505', side: 'buy', pnl: 0, exitPrice: null, quantity: 0.1,
    }]);
    trade.findFirst.mockResolvedValue({
      id: 'phantom-zero', symbol: 'US500', side: 'buy',
      // ⚠️ The finaliser reads THE ROW IT RESOLVED, and the stale `pnl: 0` it was CREATED with is
      // what defeated the old test (`pnlValue == null` was false because 0 is not null).
      pnl: 0, exitPrice: null,
    });
    // No deal history → no exit price can be derived.
    adapter.getDeals.mockResolvedValue([]);

    const result = await service.syncPositions('mt5', [], { authoritative: true });

    expect(result.reaped).toBe(1);
    const data: any = trade.update.mock.calls[0][0].data;
    expect(data.exitPrice).toBeNull();
    expect(data.pnl).toBe(0);
    // The zero is still there — this fix does NOT blank data — but it is now FLAGGED, so a
    // reader filtering on `pnlInvalid` gets the right answer.
    expect(data.pnlInvalid).toBe(1);
    expect(String(data.pnlInvalidReason)).toContain('placeholder');
  });

  /**
   * The SYNTHESISED `dbPos` path — the one no test covered (#1014).
   *
   * `reapStrandedTrades()` builds its `dbPos` from a `trade` row rather than reading a `position`
   * row, so it must supply every field the finaliser reads. It supplied five and NOT `quantity` —
   * which is the split's NUMERATOR. Live, that produced the hardest result to notice: the exit price
   * was repaired correctly and the P&L stayed NULL, so the repair looked half-done.
   *
   * ⚠️ A jest mock cannot catch a missing argument — it accepts whatever it is given. Only an
   * assertion on the RESULT can, which is what this is.
   */
  it('prices a stranded row whose ticket is an ORDER id, by splitting the position (#1014)', async () => {
    trade.findMany.mockResolvedValue([{
      id: 'order-ticketed', symbol: 'XAUUSD', openedAt: new Date('2026-09-28T08:52:17Z'),
      brokerTicket: '152690940846', side: 'buy', pnl: null, exitPrice: null, quantity: 0.01,
    }]);
    trade.findFirst.mockResolvedValue({
      id: 'order-ticketed', symbol: 'XAUUSD', side: 'buy', quantity: 0.01,
    });
    adapter.getDeals.mockResolvedValue([
      // The stored ticket is an ORDER id, and it maps to the POSITION both scale-ins joined.
      { positionId: '152690675067', orderId: '152690940846', side: 'buy', volume: 0.02, price: 4146.30, profit: 0, time: new Date('2026-09-28T08:52:17Z') },
      { positionId: '152690675067', orderId: '152690940848', side: 'buy', volume: 0.02, price: 4145.83, profit: 0, time: new Date('2026-09-28T09:35:55Z') },
      { positionId: '152690675067', orderId: '152690988172', side: 'sell', volume: 0.04, price: 4157.11, profit: 40, time: new Date('2026-09-28T12:28:00Z') },
    ]);

    const result = await service.syncPositions('mt5', [], { authoritative: true });

    expect(result.reaped).toBe(1);
    const updateArg: any = trade.update.mock.calls[0][0];
    expect(updateArg.data.exitPrice).toBe(4157.11);
    // A QUARTER of the net (0.01 of 0.04 opened) — not 40, and NOT null. `null` is what the missing
    // `quantity` produced live, and it is the assertion that fails when the numerator is dropped.
    expect(updateArg.data.pnl).toBe(10);
  });

  it('⚠️ NEVER touches a ticketed Trade the broker still reports — a ticket is proof of life', async () => {    // THE safety test. Widening the reaper is only acceptable because a ticket present in the
    // snapshot is an absolute stop. If this fails, an ordinary sync pass is closing LIVE trades.
    trade.findMany.mockResolvedValue([{
      id: 'live-trade', symbol: 'EURUSD', openedAt: new Date('2026-09-18T17:22:45Z'),
      brokerTicket: '152654644455', side: 'buy', pnl: 5, exitPrice: null,
    }]);

    const result = await service.syncPositions('mt5', [{ ...basePosition }], { authoritative: true });

    expect(result.reaped).toBe(0);
    // Assert on CLOSURE specifically, not `update` generally: reconcileTrade() legitimately
    // refreshes sl/tp on a live trade, so a blanket not.toHaveBeenCalled() would fail for the
    // wrong reason and hide whether the guard actually held.
    const closed = trade.update.mock.calls.filter((c: any) => c[0]?.data?.status === 'closed');
    expect(closed).toHaveLength(0);
    expect(trade.updateMany).not.toHaveBeenCalled();
  });

  it('does not consider ANY Trade row from a non-authoritative snapshot', async () => {
    // The reaper now looks at MORE rows than before, so this guard matters more, not less.
    // An outage must never be mistaken for "everything closed".
    const result = await service.syncPositions('mt5', [], { authoritative: false });

    expect(result).toEqual({ synced: 0, created: 0, closed: 0, reaped: 0 });
    expect(trade.findMany).not.toHaveBeenCalled();
    expect(trade.updateMany).not.toHaveBeenCalled();
  });

  it('finalises SEVERAL ticketed orphans in one pass — the count grows, so the fix must scale', async () => {
    // The measured set, verbatim. A fix that handled one row would not have held for a week.
    trade.findMany.mockResolvedValue([
      { id: 'o1', symbol: 'GER40', openedAt: new Date('2026-09-15T19:28:37Z'), brokerTicket: '89649760', side: 'buy', pnl: 0, exitPrice: null },
      { id: 'o2', symbol: 'VIX', openedAt: new Date('2026-09-15T19:59:33Z'), brokerTicket: '89657501', side: 'buy', pnl: 0, exitPrice: null },
      { id: 'o3', symbol: 'XAUUSD', openedAt: new Date('2026-09-17T12:14:44Z'), brokerTicket: '152646338241', side: 'buy', pnl: 0, exitPrice: null },
      { id: 'o4', symbol: 'VIX', openedAt: new Date('2026-09-18T16:58:01Z'), brokerTicket: '90555750', side: 'buy', pnl: 0, exitPrice: null },
      { id: 'o5', symbol: 'VIX', openedAt: new Date('2026-09-18T17:39:14Z'), brokerTicket: '90563535', side: 'buy', pnl: 0, exitPrice: null },
    ]);
    trade.findFirst.mockResolvedValue({ id: 'x', symbol: 'X', side: 'buy' });

    const result = await service.syncPositions('mt5', [], { authoritative: true });

    expect(result.reaped).toBe(5);
  });

  it('closes ONLY the orphan when the broker still reports other live positions', async () => {
    // The realistic shape: live positions and orphans in the same snapshot. The live one survives.
    trade.findMany.mockResolvedValue([
      { id: 'live-eur', symbol: 'EURUSD', openedAt: new Date('2026-09-18T17:22:45Z'), brokerTicket: '152654644455', side: 'buy', pnl: 0, exitPrice: null },
      { id: 'orphan-vix', symbol: 'VIX', openedAt: new Date('2026-09-18T16:58:01Z'), brokerTicket: '90555750', side: 'buy', pnl: 0, exitPrice: null },
    ]);
    trade.findFirst.mockResolvedValue({ id: 'orphan-vix', symbol: 'VIX', side: 'buy' });

    const result = await service.syncPositions('mt5', [{ ...basePosition }], { authoritative: true });

    expect(result.reaped).toBe(1);
    const closedIds = trade.update.mock.calls
      .filter((c: any) => c[0]?.data?.status === 'closed')
      .map((c: any) => c[0]?.where?.id);
    expect(closedIds).toEqual(['orphan-vix']);
  });

  it('still reaps an UNTICKETED phantom at pnl 0 — the 2026-09-10 behaviour is intact', async () => {
    // Regression on the older fix. An unticketed row never existed at the broker, so a zero here
    // is the truth — which is exactly why the ticketed branch must NOT take this path.
    trade.findMany.mockResolvedValue([
      { id: 'phantom', symbol: 'USDCAD', openedAt: new Date('2026-07-24T18:41:05Z'), brokerTicket: null },
    ]);
    trade.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.syncPositions('mt5', [], { authoritative: true });

    expect(result.reaped).toBe(1);
    expect(trade.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'phantom', status: 'open', brokerTicket: null }),
      data: expect.objectContaining({ status: 'closed', pnl: 0 }),
    }));
    // ⚠️ #1044 — and the FLAG IS SET AT THE WRITE, not by a later sweep. Before this, the flag came
    // only from `quarantine-phantom-closes.cjs`, so a row reaped between sweeps carried
    // `pnlInvalid = 0` and was counted as a break-even trade. A two-step invariant fails silently
    // whenever the second step is skipped.
    const written: any = trade.updateMany.mock.calls[0][0].data;
    expect(written.pnlInvalid).toBe(1);
    expect(String(written.pnlInvalidReason)).toContain('#1044');
  });

  /**
   * #1089 (2026-10-08) — THE REPAIR PASS MUST NOT MOVE A CLOSE DATE.
   *
   * `finalizeClosedPosition` wrote `closedAt: closedAt ?? new Date()`. For a LIVE close that is
   * correct — the row has no value yet. For the #1014 repair pass it is damage: the row was closed
   * long ago, and when its deal cannot be re-read the RUN TIME was stamped over the real close
   * date. Measured live during the #1089 repair: one run moved **50** rows' close dates to
   * "today" — every one restored from a pre-run snapshot (`logs/restore-1089-closedat.ps1`), which
   * is evidence the behaviour was real and not hypothetical.
   *
   * The fix under test: `closedAt ?? trade.closedAt ?? new Date()`.
   */
  it('⚠️ the repair pass KEEPS the row\'s existing closedAt when no deal resolves (#1089)', async () => {
    const CLOSED_AT = new Date('2026-09-25T10:00:00.000Z');
    trade.findMany.mockResolvedValue([{
      id: 'repair-1', symbol: 'GER40', openedAt: new Date('2026-09-25T08:00:00Z'),
      brokerTicket: '89649760', side: 'buy', pnl: null, exitPrice: null,
      accountId: '10011309743', quantity: 0.1,
    }]);
    trade.findFirst.mockResolvedValue({
      id: 'repair-1', symbol: 'GER40', side: 'buy', closeReason: null, closedAt: CLOSED_AT,
    });
    // The deal is NOT re-readable — the path that used to stamp the run time over the real date.
    adapter.getDeals.mockResolvedValue([]);

    const out = await service.repairClosedTradesWithUnknownPnl('mt5', null, 10);

    expect(out.examined).toBe(1);
    const updateArg: any = trade.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'repair-1' });
    // ⚠️ THE CANARY ASSERTION. With `closedAt ?? new Date()` this is the RUN TIME and the test
    // FAILS — which is exactly what happened to 50 rows on 2026-10-08.
    expect(updateArg.data.closedAt).toEqual(CLOSED_AT);
  });

  /**
   * #1093 (2026-10-08) — the repair path RE-DERIVES `broker:unknown` when a deal becomes readable.
   *
   * `broker:unknown` is the ABSENCE of evidence, not evidence — and the repair pass itself writes
   * it back for any row it cannot price, so without this rule a later recovery could never
   * overwrite it (measured shaping of the #1089 staging, which had to clear the reason by SQL).
   * Every OTHER reason stays sacred; the second case below proves it is NOT a blanket re-derive.
   */
  it('⭐ the repair pass RE-DERIVES broker:unknown when the closing deal is now readable (#1093)', async () => {
    trade.findMany.mockResolvedValue([{
      id: 'rederive-1', symbol: 'GER40', openedAt: new Date('2026-09-15T19:28:37Z'),
      brokerTicket: '89649760', side: 'buy', pnl: null, exitPrice: null,
      accountId: '62148195', quantity: 0.1,
    }]);
    trade.findFirst.mockResolvedValue({
      id: 'rederive-1', symbol: 'GER40', side: 'buy',
      closeReason: 'broker:unknown', closedAt: new Date('2026-09-16T09:00:00Z'),
    });
    adapter.getDeals.mockResolvedValue([
      { positionId: '89649760', symbol: 'GER40', side: 'buy', volume: 0.1, price: 23700, profit: 0, commission: 0, swap: 0, time: new Date('2026-09-15T19:28:37Z') },
      { positionId: '89649760', symbol: 'GER40', side: 'sell', volume: 0.1, price: 23500, profit: -200, commission: -3, swap: -1, reason: 4, comment: '[sl 23500]', time: new Date('2026-09-16T09:00:00Z') },
    ]);

    await service.repairClosedTradesWithUnknownPnl('mt5', null, 10);

    const updateArg: any = trade.update.mock.calls[0][0];
    // The deal says reason 4 — a real stop fill the row can finally name.
    expect(updateArg.data.closeReason).toBe('broker:sl');
    expect(updateArg.data.exitPrice).toBe(23500);
  });

  it('does NOT re-derive a reason a mechanism named itself — only broker:unknown', async () => {
    trade.findMany.mockResolvedValue([{
      id: 'keep-1', symbol: 'GER40', openedAt: new Date('2026-09-15T19:28:37Z'),
      brokerTicket: '89649760', side: 'buy', pnl: null, exitPrice: null,
      accountId: '62148195', quantity: 0.1,
    }]);
    trade.findFirst.mockResolvedValue({
      id: 'keep-1', symbol: 'GER40', side: 'buy',
      closeReason: 'system:time-stop', closedAt: new Date('2026-09-16T09:00:00Z'),
    });
    adapter.getDeals.mockResolvedValue([
      { positionId: '89649760', symbol: 'GER40', side: 'sell', volume: 0.1, price: 23500, profit: -200, commission: -3, swap: -1, reason: 4, comment: '[sl 23500]', time: new Date('2026-09-16T09:00:00Z') },
    ]);

    await service.repairClosedTradesWithUnknownPnl('mt5', null, 10);

    const updateArg: any = trade.update.mock.calls[0][0];
    expect(updateArg.data.closeReason).toBe('system:time-stop');
  });
});
