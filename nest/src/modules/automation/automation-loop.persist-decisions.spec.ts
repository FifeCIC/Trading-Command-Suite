import { AutomationLoopService } from './automation-loop.service';

/**
 * AutomationLoopService.persistDecisions — order rows are ATTEMPTS, not decisions (#885).
 *
 * ⚠️ THE REGRESSION THESE TESTS GUARD. This writer logged 'EXECUTED' AND 'FAILED' decisions to
 * the `order` table, the latter as `rejected`. FAILED covers everything that stopped a trade
 * BEFORE an order existed (signal below threshold, market closed, position cap, bridge
 * unreachable) — so the table read `rejected 79, filled 16` against a bridge journal of
 * `order_placed 8, order_failed 0`. `WHERE status='rejected'` could not answer "is the broker
 * refusing our orders?" because it was mostly the loop narrating its own skips.
 *
 * The contract now:
 *   • EXECUTED → one `order` row, status 'filled';
 *   • FAILED / BLOCKED / anything else → decision_log ONLY (where every FAILED row is kept).
 *
 * Harness note: `persistDecisions` is fire-and-forget and touches only `prisma`, `logger`,
 * `state` and `lastDecisionWrite` — the prototype is borrowed and those four are stubbed.
 */
describe('AutomationLoopService.persistDecisions — order rows are attempts (#885)', () => {
  function make() {
    const svc = Object.create(AutomationLoopService.prototype) as AutomationLoopService;
    const orderCreate = jest.fn(async () => ({}));
    const decisionCreateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    (svc as any).prisma = {
      isAvailable: true,
      order: { create: orderCreate },
      decisionLog: { createMany: decisionCreateMany },
    };
    (svc as any).logger = { debug: jest.fn(), warn: jest.fn(), log: jest.fn() };
    (svc as any).state = { decisionLogSuppressed: 0, decisionLogPersisted: 0 };
    (svc as any).lastDecisionWrite = new Map();
    return { svc, orderCreate, decisionCreateMany };
  }

  const flush = () => new Promise((r) => setImmediate(r));

  const decision = (over: any) => ({
    timestamp: new Date().toISOString(),
    strategyId: 'bot-1',
    symbol: 'XAUUSD',
    decision: 'FAILED',
    reason: 'Signal below 7% (6.5%) [style Position]',
    // #909 — the queue path's unit is the PERCENTAGE; the raw score is a different column.
    compositePct: 6.5,
    signal: 'BUY',
    brokerId: 'mt5',
    ...over,
  });

  it('writes FAILED decisions to decision_log and NOT to the order table', async () => {
    const { svc, orderCreate, decisionCreateMany } = make();
    (svc as any).persistDecisions([decision({})], 7);
    await flush();

    expect(decisionCreateMany).toHaveBeenCalled();
    const persisted = decisionCreateMany.mock.calls[0][0].data;
    expect(persisted[0].decision).toBe('FAILED');
    expect(persisted[0].reason).toContain('Signal below 7%');

    // ⚠️ THE FIX: a decision that never became an order gets no order-audit row.
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('writes an EXECUTED decision to the order table as filled (restore direction)', async () => {
    const { svc, orderCreate } = make();
    (svc as any).persistDecisions(
      [decision({ decision: 'EXECUTED', ticket: 152239905341, quantity: 0.1, price: 2410 })],
      7,
    );
    await flush();

    expect(orderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'filled',
          providerId: '152239905341',
          quantity: 0.1,
        }),
      }),
    );
  });

  it('a FAILED decision alongside an EXECUTED one produces exactly ONE order row', async () => {
    const { svc, orderCreate } = make();
    (svc as any).persistDecisions(
      [
        decision({}),
        decision({ decision: 'EXECUTED', symbol: 'EURUSD', ticket: 999, signal: 'SELL' }),
      ],
      7,
    );
    await flush();

    expect(orderCreate).toHaveBeenCalledTimes(1);
    expect(orderCreate.mock.calls[0][0].data.symbol).toBe('EURUSD');
  });
});

/**
 * #909 — the unit lives in the COLUMN.
 * ====================================
 * `decision_log.composite` held BOTH a raw additive score (envelope ladder, A/B) and a 0-100
 * percentage (queue path) under one name, so any average or colour threshold silently mixed two
 * quantities — and the same bot could read as "clears its bar ten times over" (raw 165 vs bar 8)
 * or "blocked at 7 < 8", depending on which writer the row came from.
 *
 * These tests pin the split in both directions, because a one-directional assertion cannot tell
 * "the mapping works" from "the mapping is never exercised":
 *   • a percentage row lands in `compositePct` and NOT in `compositeRaw`;
 *   • a raw row lands in `compositeRaw` and NOT in `compositePct`;
 *   • neither writes the legacy `composite` column — new rows must leave it NULL, since its
 *     historical rows cannot be classified and a written value would re-create the ambiguity.
 */
describe('AutomationLoopService.persistDecisions — unit-explicit scores (#909)', () => {
  function make() {
    const svc = Object.create(AutomationLoopService.prototype) as AutomationLoopService;
    const decisionCreateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    (svc as any).prisma = {
      isAvailable: true,
      order: { create: jest.fn(async () => ({})) },
      decisionLog: { createMany: decisionCreateMany },
    };
    (svc as any).logger = { debug: jest.fn(), warn: jest.fn(), log: jest.fn() };
    (svc as any).state = { decisionLogSuppressed: 0, decisionLogPersisted: 0 };
    (svc as any).lastDecisionWrite = new Map();
    return { svc, decisionCreateMany };
  }

  const flush = () => new Promise((r) => setImmediate(r));

  it('a queue-path (percentage) decision writes compositePct and leaves compositeRaw null', async () => {
    const { svc, decisionCreateMany } = make();
    (svc as any).persistDecisions([{
      timestamp: new Date().toISOString(), strategyId: 'bot-1', symbol: 'XAUUSD',
      brokerId: 'mt5', decision: 'SKIP',
      reason: '[QueueBot] XAUUSD composite 7 < minComposite 8 — stays queued',
      compositePct: 7, signal: 'BUY',
    }], 9);
    await flush();

    const row = decisionCreateMany.mock.calls[0][0].data[0];
    expect(row.compositePct).toBe(7);
    expect(row.compositeRaw).toBeNull();
    // ⚠️ The canary: the legacy column is not written by new rows.
    expect(row).not.toHaveProperty('composite');
  });

  it('a ladder (raw) decision writes compositeRaw and leaves compositePct null', async () => {
    const { svc, decisionCreateMany } = make();
    (svc as any).persistDecisions([{
      timestamp: new Date().toISOString(), strategyId: '', symbol: 'BTC',
      brokerId: 'mt5', decision: 'SCORED',
      reason: 'btc-speed-v1: composite=178 signal=STRONG_BUY',
      compositeRaw: 178, signal: 'STRONG_BUY',
    }], 9);
    await flush();

    const row = decisionCreateMany.mock.calls[0][0].data[0];
    expect(row.compositeRaw).toBe(178);
    expect(row.compositePct).toBeNull();
    expect(row).not.toHaveProperty('composite');
  });

  it('a decision with NO trustworthy score writes null in BOTH — never 0', async () => {
    const { svc, decisionCreateMany } = make();
    (svc as any).persistDecisions([{
      timestamp: new Date().toISOString(), strategyId: 'bot-2', symbol: 'EURUSD',
      brokerId: 'mt5', decision: 'BLOCKED',
      reason: '[QueueBot] invalid score lineage or percentage unit',
      compositePct: null, signal: 'BUY',
    }], 9);
    await flush();

    const row = decisionCreateMany.mock.calls[0][0].data[0];
    // A 0 would read as a real measurement in either unit; absence is the honest value.
    expect(row.compositeRaw).toBeNull();
    expect(row.compositePct).toBeNull();
  });
});
