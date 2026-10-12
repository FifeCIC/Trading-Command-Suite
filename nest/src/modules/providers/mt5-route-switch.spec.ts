/**
 * mt5-route-switch.spec.ts — POST /api/providers/mt5/routes/:symbol/switch (#703-adjacent, 2026-10-11).
 *
 * WHY THE REFUSALS ARE THE TEST. The endpoint exists so an operator can move a bot's orders to a
 * different account when the one it routes to is gone (measured: broker 3's demo expired, 8 bots
 * stranded). The dangerous outcomes are not "the switch did not happen" — they are:
 *
 *   1. switching ONTO a broker whose own symbol list says `tradeMode=0` (#1002) — the route is
 *      created, orders refuse at dispatch, and the operator is sent looking at the broker;
 *   2. switching ONTO a broker id that is not an active bridge (#914) — the route points at a
 *      port nothing listens on;
 *   3. a HALF-APPLIED switch — old row disabled but new row not enabled — which reads as
 *      "no route" and silently falls back to the primary broker.
 *
 * (3) is why the write is ONE `$transaction`, and this spec asserts the transaction shape: the
 * disable and the enable travel together, and the old row's NOTE survives (disable-not-delete is
 * the whole point — those notes record why the route existed).
 */

import { Mt5Controller } from './mt5.controller';

function build(opts: {
  activeIds?: number[];
  canTrade?: boolean | undefined;
  currentBrokerId?: number;
  /** The (symbol, target-broker) row, if one exists — carries the broker-native name (#1112). */
  targetRow?: { brokerSymbol: string | null } | null;
}) {
  const updateMany = jest.fn(async () => ({ count: 1 }));
  const upsert = jest.fn(async () => ({}));
  const $transaction = jest.fn(async (ops: any[]) => Promise.all(ops));
  const count = jest.fn(async () => 2);
  const findFirst = jest.fn(async () => (opts.targetRow === undefined ? null : opts.targetRow));
  const ctrl: any = Object.create(Mt5Controller.prototype);
  ctrl.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  ctrl.prisma = {
    symbolRoute: { updateMany, upsert, findFirst },
    tradingStrategy: { count },
    $transaction,
  };
  ctrl.mt5Connection = { getBrokerIds: () => opts.activeIds ?? [2, 3] };
  ctrl.symbolRouter = {
    resolve: jest.fn(() => ({
      brokerId: opts.currentBrokerId ?? 3,
      explicit: true,
      url: 'http://localhost:5001',
      brokerSymbol: 'XAGUSD',
      mt5: true,
      provider: 'mt5',
    })),
    canTradeOn: jest.fn(() => opts.canTrade),
    invalidate: jest.fn(),
    refresh: jest.fn(),
  };
  return { ctrl, updateMany, upsert, $transaction };
}

describe('switchRoute — re-select the broker for a symbol', () => {
  it('verified target: one transaction, old row DISABLED (note preserved), new row enabled as mt5', async () => {
    const { ctrl, updateMany, upsert, $transaction } = build({ canTrade: true, currentBrokerId: 3 });

    const res = await ctrl.switchRoute('xagusd', { brokerId: 2 });

    expect(res.ok).toBe(true);
    expect(res.after).toEqual({ brokerId: 2 });
    expect(res.capability).toBe('verified');
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { symbol: 'XAGUSD', enabled: true },
      data: { enabled: false },
    });
    const upsertArgs = upsert.mock.calls[0][0];
    expect(upsertArgs.update).toEqual({ enabled: true, priority: 0 });
    // ⚠️ The update must NOT touch note/brokerSymbol — those are the row's hand-verified record.
    expect(upsertArgs.update).not.toHaveProperty('note');
    expect(upsertArgs.update).not.toHaveProperty('brokerSymbol');
    expect(upsertArgs.create.provider).toBe('mt5');
    expect(ctrl.symbolRouter.invalidate).toHaveBeenCalledWith('XAGUSD');
  });

  it('REFUSES a target whose own symbol list says tradeMode=0 (#1002) — and writes NOTHING', async () => {
    const { ctrl, $transaction } = build({ canTrade: false });

    const res = await ctrl.switchRoute('VIX', { brokerId: 2 });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('tradeMode=0');
    expect($transaction).not.toHaveBeenCalled();
  });

  it('REFUSES a broker that is not an active bridge (#914) — and writes NOTHING', async () => {
    const { ctrl, $transaction } = build({ activeIds: [2, 3] });

    const res = await ctrl.switchRoute('XAGUSD', { brokerId: 9 });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('not an active MT5 bridge');
    expect(res.error).toContain('2, 3');
    expect($transaction).not.toHaveBeenCalled();
  });

  it('REFUSES a non-integer brokerId before touching anything', async () => {
    const { ctrl, $transaction } = build({});

    const res = await ctrl.switchRoute('XAGUSD', { brokerId: '2' as any });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('integer');
    expect($transaction).not.toHaveBeenCalled();
    expect(ctrl.symbolRouter.resolve).not.toHaveBeenCalled();
  });

  it('capability UNKNOWN (never synced) is allowed, and reported as unverified — not as false', async () => {
    const { ctrl } = build({ canTrade: undefined });

    const res = await ctrl.switchRoute('XAGUSD', { brokerId: 2 });

    expect(res.ok).toBe(true);
    expect(res.capability).toContain('unverified');
  });

  it('asks with the TARGET\'S broker-native name (#1112) — USTEC exists as NAS100 on broker 3', async () => {
    // Without this, the guard asks `canTradeOn(3, 'USTEC')`, `broker_symbol` holds `NAS100` under
    // that broker, the ask returns a DEFINITE false, and the RETURN LEG of a switch (3→2→3) is
    // refused on a route that trades fine. The row is read regardless of `enabled`.
    const { ctrl } = build({ canTrade: true, targetRow: { brokerSymbol: 'NAS100' } });

    const res = await ctrl.switchRoute('ustec', { brokerId: 3 });

    expect(res.ok).toBe(true);
    expect(ctrl.symbolRouter.canTradeOn).toHaveBeenCalledWith(3, 'USTEC', 'NAS100');
  });
});

describe('resolveRoute — the panel payload', () => {
  it('maps capability UNKNOWN to null (never to false) and counts active bots on the symbol', async () => {
    const { ctrl } = build({});
    ctrl.mt5Connection.getAllBrokerHealths = jest.fn(async () => [
      { brokerId: 2, server: 'MetaQuotes-Demo', url: 'http://localhost:5000', reachable: true, health: { connected: true, account: '10011309743' }, connectionState: 'ok' },
      { brokerId: 3, server: '?', url: 'http://localhost:5001', reachable: false, health: null, connectionState: 'terminal-down' },
    ]);
    ctrl.symbolRouter.canTradeOn = jest.fn(() => undefined);

    const res = await ctrl.resolveRoute('xagusd');

    expect(res.symbol).toBe('XAGUSD');
    expect(res.botsOnSymbol).toBe(2);
    expect(res.brokers).toHaveLength(2);
    expect(res.brokers[0].canTrade).toBeNull(); // unknown ≠ cannot trade
    expect(res.brokers[0].account).toBe('10011309743'); // identification is visible
    expect(res.brokers[1].account).toBeNull(); // unreachable → no fabricated number
    expect(res.brokers[1].current).toBe(true); // route resolves to broker 3 in the base mock
    expect(res.brokers[1].reachable).toBe(false);
  });

  it('a failed bot count is null — "cannot count" must not render as zero', async () => {
    const { ctrl } = build({});
    ctrl.mt5Connection.getAllBrokerHealths = jest.fn(async () => []);
    ctrl.prisma.tradingStrategy.count = jest.fn(async () => {
      throw new Error('db down');
    });

    const res = await ctrl.resolveRoute('XAGUSD');

    expect(res.botsOnSymbol).toBeNull();
  });
});
