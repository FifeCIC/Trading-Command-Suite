/**
 * mt5-adapter-breaker-isolation.spec.ts — #846.
 *
 * THE DEFECT THIS PINS DOWN
 * -------------------------
 * The circuit breaker was a single global boolean on the adapter, while every call carries
 * its own `brokerId` and bridge URL. So 10 consecutive failures against ONE bridge skipped
 * requests to ALL of them.
 *
 * Observed live 2026-09-16: MetaQuotes-Demo (:5000, broker 2) had its terminal
 * disconnected while PepperstoneUK-Demo (:5001, broker 3) was healthy. A VIX order —
 * routed to broker 3 — was refused with "Bridge unreachable (circuit breaker active)",
 * and every `bridge_event` trip row named broker 2's account. A working broker was gagged
 * by an unrelated one and nothing reached the market.
 *
 * ⚠️ WHY THERE IS A CONTROL TEST
 * ------------------------------
 * The isolation test alone would pass against an adapter with NO breaker at all — which is
 * not the property we want. "Broker 3 still works" is only meaningful alongside "broker 2
 * is genuinely blocked". The control is what makes the pair evidence rather than a
 * one-directional assertion.
 *
 * ⚠️ WHAT WOULD MAKE THIS SUITE FAIL (the canary direction)
 * --------------------------------------------------------
 * Reverting any of these to the global field makes the isolation test fail:
 *   - `breakers` -> a single `tripped` boolean / `consecutiveErrors` counter
 *   - `isTripped(route.brokerId)` -> `this.tripped`
 *   - `breakerFor(brokerId)` -> a shared state object
 *
 * Verified by actually reverting `isTripped` to the global getter and observing this file
 * fail — a guard that has never been seen to fail is a decoration.
 */
import { Mt5Adapter } from './mt5.adapter';

const BROKER_2_URL = 'http://localhost:5000';
const BROKER_3_URL = 'http://localhost:5001';

/** Routes EURUSD to broker 2 (:5000) and VIX to broker 3 (:5001), mirroring production. */
function routerStub() {
  const routeFor = (symbol: string, brokerId: number, url: string) => ({
    brokerId,
    url,
    brokerSymbol: symbol,
    explicit: true,
    // #914 — both ids are ACTIVE MT5 bridges; the field is required by ResolvedSymbolRoute.
    mt5: true,
    provider: 'mt5',
  });
  /** ONE definition, shared by `resolve` and `resolveForOrder` (#1002) so the stub cannot drift from itself. */
  const resolveOne = (symbol: string) =>
    (symbol || '').toUpperCase() === 'VIX'
      ? routeFor(symbol, 3, BROKER_3_URL)
      : routeFor(symbol, 2, BROKER_2_URL);
  return {
    resolve: resolveOne,
    // #1002 — the ORDER path calls `resolveForOrder`, not `resolve`. A stub missing it fails as
    // "resolveForOrder is not a function", which reads like a production bug rather than a stale
    // test. Defined ONCE above so the two entries cannot drift apart from each other.
    resolveForOrder: resolveOne,
    // UNKNOWN capability on purpose: this spec is about circuit-breaker isolation, and it also
    // proves the route check does not refuse when capability has not loaded.
    canTradeOn: () => undefined,
    primaryBrokerId: () => 2,
    routeForBroker: (id: number) =>
      routeFor('', id, id === 3 ? BROKER_3_URL : BROKER_2_URL),
  } as any;
}

/** A non-OK response. 500 (not 4xx) is what increments the counter — see classifyBridgeError. */
const failing = (status = 500) =>
  ({
    ok: false,
    status,
    text: jest.fn().mockResolvedValue('{"error":"terminal not connected"}'),
    json: jest.fn().mockResolvedValue({}),
  }) as any;

const ok200 = (body: unknown) =>
  ({ ok: true, status: 200, text: jest.fn().mockResolvedValue(''), json: jest.fn().mockResolvedValue(body) }) as any;

/**
 * Drive N failing calls against ONE broker, so that broker's counter reaches the trip
 * threshold.
 *
 * ⚠️ Uses `getSymbols(brokerId)`, not `getPositionSnapshot()`. The latter calls
 * `bridgeGet('/positions')` with NO route, so its breaker key is `0` ("default") rather
 * than a broker id — observed in the first run of this file, which logged
 * `[broker default]` and tripped key 0 while asserting about broker 2. A test that trips
 * the wrong key proves nothing about per-broker isolation.
 */
async function tripBroker(adapter: Mt5Adapter, brokerId: number, times = 10) {
  for (let i = 0; i < times; i++) {
    global.fetch = jest.fn().mockResolvedValue(failing()) as any;
    await adapter.getSymbols(brokerId);
  }
}

describe('Mt5Adapter circuit breaker — per-broker isolation (#846)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does NOT skip a healthy broker after another broker trips', async () => {
    const adapter = new Mt5Adapter(undefined, undefined, undefined, routerStub());

    // 1. Trip broker 2 only, by hammering its bridge with 500s.
    await tripBroker(adapter, 2, 10);
    expect(adapter.tripped).toBe(true); // aggregate view: SOME broker is tripped

    // 2. A VIX order routes to broker 3. It MUST still reach the bridge.
    const fetchMock = jest.fn().mockResolvedValue(
      ok200({ success: true, ticket: 4242, price: 14.5 }),
    );
    global.fetch = fetchMock as any;

    const result = await adapter.placeOrder({ symbol: 'VIX', side: 'BUY', quantity: 0.1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain(BROKER_3_URL);
    expect(result).toMatchObject({ success: true, ticket: 4242 });
  });

  it('CONTROL — the tripped broker IS still blocked', async () => {
    const adapter = new Mt5Adapter(undefined, undefined, undefined, routerStub());
    await tripBroker(adapter, 2, 10);

    // A EURUSD order routes to broker 2, which is tripped: no request should be made.
    const fetchMock = jest.fn().mockResolvedValue(ok200({ success: true }));
    global.fetch = fetchMock as any;

    const result = await adapter.placeOrder({ symbol: 'EURUSD', side: 'BUY', quantity: 0.1 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, status: 'UNKNOWN' });
    // The reason must name the broker, so the message cannot be read as a global outage.
    expect(String(result.error)).toContain('broker 2');
  });

  it('reports the tripped broker in the notice code, not an unrelated one', async () => {
    const adapter = new Mt5Adapter(undefined, undefined, undefined, routerStub());
    await tripBroker(adapter, 2, 10);

    global.fetch = jest.fn().mockResolvedValue(ok200({ success: true })) as any;
    const result = await adapter.placeOrder({ symbol: 'EURUSD', side: 'BUY', quantity: 0.1 });

    // TCS-INTEG-002 = "circuit breaker open" (vs -001 "not connected"). The adaptor must pick
    // this from the TRIPPED broker's state, not from a global flag.
    expect(result.code).toBe('TCS-INTEG-002');
  });

  /**
   * ⚠️ The same guard exists in BOTH transport methods (`bridgeGet` and `bridgePost`), and the
   * canary proved they must be checked independently: reverting `isTripped` alone did NOT fail
   * this suite, because `isTripped` only shapes the MESSAGE while the BLOCKING lives in
   * `breakerFor(brokerId)` inside each transport method. Covering only the POST path would
   * leave half the class unguarded — every read (quotes, candles, positions, symbols) travels
   * the GET path.
   */
  it('does NOT skip a healthy broker on the GET path either', async () => {
    const adapter = new Mt5Adapter(undefined, undefined, undefined, routerStub());
    await tripBroker(adapter, 2, 10);

    const fetchMock = jest.fn().mockResolvedValue(
      ok200({ symbol: 'VIX', bid: 14.1, ask: 14.2, last: 14.15, timestamp: new Date().toISOString() }),
    );
    global.fetch = fetchMock as any;

    const quote = await adapter.getQuote('VIX');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(BROKER_3_URL);
    expect(quote).toMatchObject({ symbol: 'VIX', bid: 14.1 });
  });

  it('resetCircuitBreaker(undefined) clears every broker', async () => {
    const adapter = new Mt5Adapter(undefined, undefined, undefined, routerStub());
    await tripBroker(adapter, 2, 10);
    expect(adapter.tripped).toBe(true);

    adapter.resetCircuitBreaker();

    expect(adapter.tripped).toBe(false);
    expect(adapter.consecutiveErrors).toBe(0);
  });

  it('resetCircuitBreaker(id) clears only that broker', async () => {
    const adapter = new Mt5Adapter(undefined, undefined, undefined, routerStub());
    await tripBroker(adapter, 2, 10);

    adapter.resetCircuitBreaker(3); // broker 3 was never tripped
    expect(adapter.tripped).toBe(true); // broker 2 still is

    adapter.resetCircuitBreaker(2);
    expect(adapter.tripped).toBe(false);
  });

  it('a single successful call resets only its own broker', async () => {
    const adapter = new Mt5Adapter(undefined, undefined, undefined, routerStub());

    // Broker 2 accumulates half the errors needed, then succeeds — clearing its counter.
    for (let i = 0; i < 5; i++) {
      global.fetch = jest.fn().mockResolvedValue(failing()) as any;
      await adapter.getSymbols(2);
    }
    global.fetch = jest.fn().mockResolvedValue(ok200({ symbols: [{ name: 'EURUSD' }] })) as any;
    await adapter.getSymbols(2);

    expect(adapter.tripped).toBe(false);
    expect(adapter.consecutiveErrors).toBe(0);
  });

  /**
   * ⚠️ #866 — a bridge that is GONE must trip the breaker; it must not be exempted as "transient".
   *
   * Measured 2026-09-17: the counter stayed at 1 across ~10 consecutive connect-refused
   * failures, so a bridge with no process behind it was polled at full rate indefinitely. A
   * breaker that cannot trip on its own failure mode is a decoration — and a refusal is the
   * MOST COMMON outage, not an exception to the rule. Transience is handled by the RESET
   * (one success clears the streak — asserted above), not by excusing the failure.
   *
   * Drives REJECTED fetches specifically: the 500-response path already counted, so only this
   * transport-level failure proves the exemption is gone.
   */
  it('counts connect-refused failures toward the trip threshold (#866)', async () => {
    const adapter = new Mt5Adapter(undefined, undefined, undefined, routerStub());

    for (let i = 0; i < 10; i++) {
      global.fetch = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5000')) as any;
      await adapter.getSymbols(2);
    }

    expect(adapter.consecutiveErrors).toBe(10);
    expect(adapter.tripped).toBe(true);
  });
});
