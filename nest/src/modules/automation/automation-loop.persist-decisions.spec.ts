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
    composite: 6.5,
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
