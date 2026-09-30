import { AbTestService } from './ab-test.service';

/**
 * #1039 — A REJECTED ORDER IS NOT A TRADE, AND MUST NOT REACH AN A/B ARM.
 *
 * ⚠️ THE DEFECT THIS LOCKS OUT. `dispatchSideTrade` wrote `abTestId` UNCONDITIONALLY:
 *
 *     status: result.success ? 'open' : 'rejected',
 *     abTestId: test.id,            // <- even when the broker refused the order
 *     abTestSide: side,
 *
 * and `computeResults` filtered only on `pnlInvalid`, never on `status`. So a refused order was
 * counted as a `trade` on an arm.
 *
 * Measured on the live database 2026-09-30, run `b50727ee`:
 *
 *     104 attributed rows = 91 `rejected` (44 A / 47 B) + 13 `closed` (8 A / 5 B)
 *
 * **75% of every attributed row in the system was an order that never traded.** The verdict's own
 * sample bar (`>= 30 closed per side`) was therefore measured against an inflated denominator, and
 * arm B summed to exactly £0.00 over 52 rows because `rejected` rows carry no P&L and dominated it.
 *
 * ⚠️ CANARY FOR THE FIX (run before trusting this file). Revert `computeResults` to filter
 * `trades` instead of `counted`, or restore an unconditional `abTestSide: side` in the `record()`
 * payload, and the affected test fails.
 *
 * ⚠️ THE SECOND TEST IS A CANARY FOR `abTestId`/`abTestSide` — the FIRST test is the canary for a
 * DIFFERENT bug the fix initially had: two `abTestSide` keys in one object literal, where the LAST
 * wins. A test that only asserted "the rejected row has no side" would have been satisfied by the
 * conditional key while the unconditional one quietly overwrote it. The assertion has to be on what
 * `record()` ACTUALLY RECEIVED, which is what these tests do.
 */

const TEST = { id: 'ab1', name: 'XAU M15 comparison', symbols: ['XAUUSD'] } as any;

const dispatchArgs = (extra: Record<string, unknown> = {}) => ({
  test: TEST,
  side: 'A' as const,
  symbol: 'XAUUSD',
  brokerId: 'mt5',
  sideDir: 'BUY' as const,
  quantity: 0.01,
  slPct: 1,
  tpPct: 2,
  entryPrice: 2000,
  tradeMode: 'auto',
  ...extra,
});

function make(opts: { placeOrderResult?: any; trades?: any[] } = {}) {
  const svc = Object.create(AbTestService.prototype) as AbTestService;

  const adapter = {
    placeOrder: jest.fn(async () =>
      opts.placeOrderResult ?? { success: true, ticket: 987654, price: 2013.5 }),
    getPositionsRaw: jest.fn(async () => []),
  };

  const recorded: any[] = [];
  (svc as any).adapterFactory = { create: jest.fn(() => adapter) };
  (svc as any).tradeRecorder = {
    record: jest.fn(async (a: any) => { recorded.push(a); return a; }),
  };
  (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  (svc as any).prisma = {
    trade: { findMany: jest.fn(async () => opts.trades ?? []) },
    metaStackSnapshot: {
      findUnique: jest.fn(async (args: any) => ({
        id: args.where.id,
        scoringStrategyId: 'ss-gold',
        version: '1.0.1',
        snapshot: { tradeThreshold: 10 },
      })),
    },
  };

  return { svc, adapter, recorded };
}

describe('AbTestService — a rejected order is not an arm (#1039)', () => {
  it('does NOT attribute a REJECTED order to either arm', async () => {
    const { svc, recorded } = make({
      placeOrderResult: { success: false, error: 'market closed' },
    });

    await (svc as any).dispatchSideTrade(dispatchArgs());

    const row = recorded[0];
    expect(row).toBeDefined();
    // The order attempt is still RECORDED — that is a fact worth keeping (#1014 traceability).
    expect(row.status).toBe('rejected');
    // ⚠️ But it makes no claim about which arm it belonged to. Nothing traded.
    expect(row.abTestId).toBeUndefined();
    expect(row.abTestSide).toBeUndefined();
    // The record is still findable by test, via the strategy label.
    expect(row.strategy).toContain('XAU M15 comparison');
  });

  it('DOES attribute a FILLED order — the fix is a condition, not a removal', async () => {
    const { svc, recorded } = make({ placeOrderResult: { success: true, ticket: 111, price: 2010 } });

    await (svc as any).dispatchSideTrade(dispatchArgs());

    expect(recorded[0].status).toBe('open');
    expect(recorded[0].abTestId).toBe('ab1');
    expect(recorded[0].abTestSide).toBe('A');
  });

  it('records the side on a rejection as undefined EVEN THOUGH a later key could overwrite it', async () => {
    // Regression guard for the duplicate-key bug: if an unconditional `abTestSide` is reintroduced
    // anywhere in the same object literal, it wins (last key wins) and this fails with 'A'.
    const { svc, recorded } = make({ placeOrderResult: { success: false, error: 'rejected' } });

    await (svc as any).dispatchSideTrade(dispatchArgs());

    expect(recorded[0].abTestSide).not.toBe('A');
    expect(recorded[0].abTestId).not.toBe('ab1');
  });
});

describe('AbTestService — the verdict excludes rejected rows and states both counts (#1039)', () => {
  const tradeRow = (over: Record<string, unknown>) => ({
    id: 't', abTestSide: 'A', status: 'open', pnl: null, pnlInvalid: 0, ...over,
  });

  it('counts only rows that actually traded, and reports what it excluded', async () => {
    const { svc } = make({
      trades: [
        tradeRow({ id: 'a1', abTestSide: 'A', status: 'closed', pnl: 10 }),
        tradeRow({ id: 'a2', abTestSide: 'A', status: 'closed', pnl: -4 }),
        tradeRow({ id: 'b1', abTestSide: 'B', status: 'closed', pnl: 6 }),
        // The 91-row class: tagged, never traded.
        tradeRow({ id: 'r1', abTestSide: 'A', status: 'rejected', pnl: null }),
        tradeRow({ id: 'r2', abTestSide: 'B', status: 'rejected', pnl: null }),
        tradeRow({ id: 'r3', abTestSide: 'B', status: 'rejected', pnl: null }),
      ],
    });

    const res: any = await (svc as any).computeResults(TEST);

    // Two arms, each counting ONLY its traded rows.
    expect(res.control.trades).toBe(2);
    expect(res.variant.trades).toBe(1);
    // ⚠️ The measured defect in one line: without the filter these were 4 and 4.
    expect(res.attribution.excludedRejected).toBe(3);
    expect(res.attribution.counted).toBe(3);
    expect(res.attribution.attributed).toBe(6);
    // P&L is computed from trades, so the rejection cannot move it.
    expect(res.control.realizedPnl).toBe(6);
    expect(res.variant.realizedPnl).toBe(6);
  });

  it('leaves a run with NO rejections completely unchanged (the other direction)', async () => {
    const { svc } = make({
      trades: [
        tradeRow({ id: 'a1', abTestSide: 'A', status: 'closed', pnl: 10 }),
        tradeRow({ id: 'b1', abTestSide: 'B', status: 'closed', pnl: 6 }),
      ],
    });

    const res: any = await (svc as any).computeResults(TEST);

    expect(res.control.trades).toBe(1);
    expect(res.variant.trades).toBe(1);
    expect(res.attribution.excludedRejected).toBe(0);
    expect(res.attribution.attributed).toBe(2);
    expect(res.attribution.counted).toBe(2);
  });
});
