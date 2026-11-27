/**
 * #1359 — an accepted order is not necessarily a filled order.
 *
 * The adapter used to default `status` to `'filled'` when the broker sent none, so a market order
 * queued for the next open was recorded as an open position. These cases pin the strict rule, at
 * BOTH levels: the pure decision, and the adapter's own default when a response carries no status.
 *
 * ⚠️ The second block is the canary for the default itself. With `status: data?.status || 'filled'`
 * the first case returns `'filled'` and fails — which is the state this change exists to remove.
 */
import { Trading212Adapter } from './trading212.adapter';

describe('Trading212Adapter.orderFilled (#1359)', () => {
  it('counts a fill price as evidence of a fill', () => {
    expect(Trading212Adapter.orderFilled({ success: true, status: 'UNCONFIRMED', filledPrice: 12.34 })).toBe(true);
  });

  it('counts an explicit FILLED status as evidence of a fill', () => {
    expect(Trading212Adapter.orderFilled({ success: true, status: 'FILLED' })).toBe(true);
    expect(Trading212Adapter.orderFilled({ success: true, status: 'filled' })).toBe(true);
  });

  it('does NOT claim a fill for an accepted order the broker did not confirm', () => {
    expect(Trading212Adapter.orderFilled({ success: true, status: 'UNCONFIRMED' })).toBe(false);
    expect(Trading212Adapter.orderFilled({ success: true, status: 'NEW' })).toBe(false);
    expect(Trading212Adapter.orderFilled({ success: true })).toBe(false);
  });

  it('never counts a failed order as filled, whatever status it carries', () => {
    expect(Trading212Adapter.orderFilled({ success: false, status: 'FILLED', filledPrice: 1 })).toBe(false);
    expect(Trading212Adapter.orderFilled(null)).toBe(false);
    expect(Trading212Adapter.orderFilled(undefined)).toBe(false);
  });
});

describe('Trading212Adapter.placeMarketOrder — no fabricated fill status (#1359)', () => {
  const realFetch = global.fetch;
  const savedEnv = { ...process.env };
  const ok = (body: unknown) =>
    ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body }) as any;

  beforeEach(() => {
    process.env.TRADING212_DEMO_API_KEY = 'k3y';
    process.env.TRADING212_DEMO_API_SECRET = '<test-secret>';
    process.env.TRADING212_DEMO_BASE_URL = 'https://demo.trading212.com/api/v0';
  });

  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...savedEnv };
  });

  it('reports UNCONFIRMED, not "filled", when the broker sends an id but no status or fill price', async () => {
    global.fetch = jest.fn().mockResolvedValue(ok({ id: 99 })) as any;

    const res = await new Trading212Adapter().placeMarketOrder({ ticker: 'AAPL', quantity: 1, side: 'buy' });

    expect(res.success).toBe(true);
    expect(res.status).toBe('UNCONFIRMED');
    expect(Trading212Adapter.orderFilled(res)).toBe(false);
  });

  it("passes the broker's own status through when it does send one", async () => {
    global.fetch = jest.fn().mockResolvedValue(ok({ id: 99, status: 'FILLED', fillPrice: 12.5 })) as any;

    const res = await new Trading212Adapter().placeMarketOrder({ ticker: 'AAPL', quantity: 1, side: 'buy' });

    expect(res.status).toBe('FILLED');
    expect(Trading212Adapter.orderFilled(res)).toBe(true);
  });
});
