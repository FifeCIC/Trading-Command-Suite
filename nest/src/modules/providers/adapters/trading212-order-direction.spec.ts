/**
 * trading212-order-direction.spec.ts — a SELL must reach Trading212 as a negative quantity (#1256).
 *
 * THE DEFECT THIS PINS
 * ────────────────────
 * `placeMarketOrder()` sent `{ ticker, quantity: params.quantity }` and used `params.side` for
 * LOGGING ONLY. Trading212 has no `side` field — direction is the SIGN of quantity (negative =
 * sell) — so a sell request arrived as a POSITIVE quantity and the broker executed a **BUY**.
 *
 * The worst case was not a no-op. `validatePreTrade()` checked the position existed and that the
 * quantity was available, so it PASSED, and the request then bought MORE of the stock the caller
 * asked to sell. The response was a success.
 *
 * ⚠️ Both directions are asserted. A guard that only proves "sell is negative" would also pass if
 * BUYS became negative and every buy silently became a sell — the opposite catastrophe.
 *
 * ⚠️ Asserted on the REQUEST BODY, not on the response. Stubbing a 200 proves the parsing works, not
 * that the broker would accept the request. The body is where the wrongness lived.
 */
import { Trading212Adapter } from './trading212.adapter';

describe('Trading212Adapter — order DIRECTION (#1256)', () => {
  const realFetch = global.fetch;
  const savedEnv = { ...process.env };

  const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body }) as any;

  beforeEach(() => {
    // Credentials must exist for the order path to run at all.
    process.env.TRADING212_DEMO_API_KEY = 'k3y';
    process.env.TRADING212_DEMO_API_SECRET = 's3cr3t';
    process.env.TRADING212_DEMO_BASE_URL = 'https://demo.trading212.com/api/v0';
  });

  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...savedEnv };
  });

  const bodyOf = (fetchMock: jest.Mock) => JSON.parse(fetchMock.mock.calls[0][1].body);

  it('signedQuantity: sell is NEGATIVE, buy is POSITIVE', () => {
    expect(Trading212Adapter.signedQuantity('sell', 8.17064553)).toBe(-8.17064553);
    expect(Trading212Adapter.signedQuantity('buy', 8.17064553)).toBe(8.17064553);
  });

  it('a sell whose magnitude is already negative is not double-negated into a buy', () => {
    expect(Trading212Adapter.signedQuantity('sell', -5)).toBe(-5);
    expect(Trading212Adapter.signedQuantity('buy', -5)).toBe(5);
  });

  it('market SELL sends a NEGATIVE quantity', async () => {
    const fetchMock = jest.fn().mockResolvedValue(ok({ id: 1, filledQuantity: -8.17, status: 'FILLED' }));
    global.fetch = fetchMock as any;

    const res = await new Trading212Adapter().placeMarketOrder({ ticker: 'RBLX', quantity: 8.17, side: 'sell' });

    expect(res.success).toBe(true);
    expect(bodyOf(fetchMock).quantity).toBe(-8.17);
    expect(fetchMock.mock.calls[0][0]).toBe('https://demo.trading212.com/api/v0/equity/orders/market');
  });

  it('market BUY sends a POSITIVE quantity', async () => {
    const fetchMock = jest.fn().mockResolvedValue(ok({ id: 2, filledQuantity: 1, status: 'FILLED' }));
    global.fetch = fetchMock as any;

    await new Trading212Adapter().placeMarketOrder({ ticker: 'RBLX', quantity: 1, side: 'buy' });

    expect(bodyOf(fetchMock).quantity).toBe(1);
  });

  it('limit SELL sends a NEGATIVE quantity, and BUY a positive one', async () => {
    let fetchMock = jest.fn().mockResolvedValue(ok({ id: 3 }));
    global.fetch = fetchMock as any;
    await new Trading212Adapter().placeLimitOrder({ ticker: 'RBLX', quantity: 2, side: 'sell', limitPrice: 50 });
    expect(bodyOf(fetchMock).quantity).toBe(-2);

    fetchMock = jest.fn().mockResolvedValue(ok({ id: 4 }));
    global.fetch = fetchMock as any;
    await new Trading212Adapter().placeLimitOrder({ ticker: 'RBLX', quantity: 2, side: 'buy', limitPrice: 50 });
    expect(bodyOf(fetchMock).quantity).toBe(2);
  });

  it('reports the filled quantity as a MAGNITUDE, so a sell does not read as a negative holding', async () => {
    global.fetch = jest.fn().mockResolvedValue(ok({ id: 5, filledQuantity: -8.17, status: 'FILLED' })) as any;
    const res = await new Trading212Adapter().placeMarketOrder({ ticker: 'RBLX', quantity: 8.17, side: 'sell' });
    expect(res.filledQuantity).toBe(8.17);
  });

  it('refuses a zero-quantity order rather than sending it', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    const res = await new Trading212Adapter().placeMarketOrder({ ticker: 'RBLX', quantity: 0, side: 'sell' });
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('ZERO_QUANTITY');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * #1256 second half — a LIVE order must not happen just because a key exists.
 *
 * Same precedent as the adapter constructor's own #24 guard: "a live key without an explicit live
 * mode must NOT trade live". Real money needs a switch somebody deliberately flipped.
 */
describe('Trading212Adapter — live orders are off unless switched on (#1256)', () => {
  const realFetch = global.fetch;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env.TRADING212_ISA_API_KEY = 'isa-key';
    process.env.TRADING212_ISA_API_SECRET = 'isa-secret';
    process.env.TRADING212_ISA_BASE_URL = 'https://live.trading212.com/api/v0';
  });

  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...savedEnv };
  });

  it('refuses an ISA order when TRADING212_ALLOW_LIVE_ORDERS is not "true"', async () => {
    delete process.env.TRADING212_ALLOW_LIVE_ORDERS;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    const res = await new Trading212Adapter().placeMarketOrder({
      ticker: 'RBLX', quantity: 1, side: 'sell', accountType: 'isa',
    });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('LIVE_ORDERS_DISABLED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Direction check: a DEMO order is not blocked by this switch, or the rail would be unusable.
  it('does NOT block a demo order', async () => {
    delete process.env.TRADING212_ALLOW_LIVE_ORDERS;
    process.env.TRADING212_DEMO_API_KEY = 'demo-key';
    process.env.TRADING212_DEMO_BASE_URL = 'https://demo.trading212.com/api/v0';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => '{"id":1}', json: async () => ({ id: 1 }),
    }) as any;
    global.fetch = fetchMock as any;

    const res = await new Trading212Adapter().placeMarketOrder({
      ticker: 'RBLX', quantity: 1, side: 'sell', accountType: 'demo',
    });

    expect(res.success).toBe(true);
  });

  // And the switch must actually work, or it would be a rail nobody can pass.
  it('sends the ISA order when the switch IS on, to the ISA endpoint', async () => {
    process.env.TRADING212_ALLOW_LIVE_ORDERS = 'true';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => '{"id":9,"filledQuantity":-1}', json: async () => ({ id: 9 }),
    }) as any;
    global.fetch = fetchMock as any;

    const res = await new Trading212Adapter().placeMarketOrder({
      ticker: 'RBLX', quantity: 1, side: 'sell', accountType: 'isa',
    });

    expect(res.success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://live.trading212.com/api/v0/equity/orders/market');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).quantity).toBe(-1);
  });

  // An account with no credentials must REFUSE, never fall back to the mode's account.
  it('refuses an ISA order when the ISA key is absent, rather than using another account', async () => {
    delete process.env.TRADING212_ISA_API_KEY;
    process.env.TRADING212_ALLOW_LIVE_ORDERS = 'true';
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    const res = await new Trading212Adapter().placeMarketOrder({
      ticker: 'RBLX', quantity: 1, side: 'sell', accountType: 'isa',
    });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('NO_ACCOUNT');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
