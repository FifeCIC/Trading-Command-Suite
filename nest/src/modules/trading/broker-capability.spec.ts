import { BrokerCapabilityService } from './broker-capability.service';

/**
 * These tests exist to pin ONE property: the capability answers come from the ADAPTER
 * OBJECT, not from a table of strings. A test that only asserted "mt5 can trade" would
 * pass just as happily against a hardcoded map — so every case below injects a fake
 * adapter whose METHODS differ and asserts the answer follows the methods.
 */

function build(opts: {
  configs?: any[];
  registrations?: any[];
  adapters?: Record<string, any>;
  degradation?: Array<{ providerId: string; status: string; reason?: string }>;
  throwOnCreate?: string[];
}) {
  const brokerConfig = { findAll: async () => opts.configs ?? [] } as any;
  const adapterFactory = {
    listAdapters: () => opts.registrations ?? [],
    create: (id: string) => {
      if ((opts.throwOnCreate ?? []).includes(id)) throw new Error(`create(${id}) exploded`);
      return opts.adapters?.[id] ?? null;
    },
    hasCredentials: () => true,
  } as any;
  const degradation = { getAll: () => opts.degradation ?? [] } as any;

  return new BrokerCapabilityService(brokerConfig, adapterFactory, degradation);
}

const ALL_METHODS = {
  placeOrder: async () => ({ ok: true }),
  modifyPosition: async () => ({ ok: true }),
  closePosition: async () => ({ ok: true }),
  getPositions: async () => [],
};

describe('BrokerCapabilityService.getBrokerStatus', () => {
  it('derives capability from the adapter methods, not from broker_config', async () => {
    const svc = build({
      configs: [{ id: 'mt5', displayName: 'MetaTrader 5', tradingEnabled: true, isActive: true }],
      registrations: [{ id: 'mt5', name: 'MT5', capabilities: ['quotes', 'trades'] }],
      adapters: { mt5: ALL_METHODS },
    });

    const res = await svc.getBrokerStatus();
    expect(res.brokers).toHaveLength(1);
    expect(res.brokers[0].runtime).toMatchObject({
      probed: true,
      canPlaceOrder: true,
      canModifyStop: true,
      canClosePosition: true,
      canReadPositions: true,
    });
    expect(res.brokers[0].warnings).toEqual([]);
  });

  it('reports canModifyStop=false when the adapter has no modifyPosition (the real capital.com/trading212 shape)', async () => {
    const svc = build({
      configs: [{ id: 'capital.com', displayName: 'Capital.com', tradingEnabled: true, isActive: true }],
      registrations: [{ id: 'capital.com', name: 'Capital.com', capabilities: ['quotes', 'trades'] }],
      adapters: {
        'capital.com': { placeOrder: async () => ({}), getPositions: async () => [] },
      },
    });

    const res = await svc.getBrokerStatus();
    expect(res.brokers[0].runtime?.canPlaceOrder).toBe(true);
    // The load-bearing assertion: a trailing-stop feature must be able to see this is FALSE.
    expect(res.brokers[0].runtime?.canModifyStop).toBe(false);
    expect(res.summary.provenStopMovable).toBe(0);
  });

  it('flags tradingEnabled=true against an adapter with no placeOrder (intent without capability)', async () => {
    const svc = build({
      configs: [{ id: 'alpaca', displayName: 'Alpaca', tradingEnabled: true, isActive: true }],
      registrations: [{ id: 'alpaca', name: 'Alpaca', capabilities: ['quotes'] }],
      adapters: { alpaca: { getPositions: async () => [] } },
    });

    const res = await svc.getBrokerStatus();
    expect(res.brokers[0].warnings.join(' ')).toMatch(/tradingEnabled is true but the adapter defines no placeOrder/);
    // Proven tradeable counts PROOF, so this broker must not be in it.
    expect(res.summary.provenTradeable).toBe(0);
    expect(res.summary.withWarnings).toBe(1);
  });

  it('flags a broker configured with no adapter registration', async () => {
    const svc = build({
      configs: [{ id: 'paper', displayName: 'Paper Trading', tradingEnabled: true, isActive: true }],
      registrations: [],
    });

    const res = await svc.getBrokerStatus();
    expect(res.brokers[0].registered).toBe(false);
    expect(res.brokers[0].runtime).toBeNull();
    expect(res.brokers[0].warnings.join(' ')).toMatch(/no adapter registration/);
  });

  it('flags a registration with no broker_config row (the app cannot show it)', async () => {
    const svc = build({
      configs: [],
      registrations: [{ id: 'binance', name: 'Binance', capabilities: ['quotes'] }],
      adapters: { binance: {} },
    });

    const res = await svc.getBrokerStatus();
    expect(res.brokers[0].id).toBe('binance');
    expect(res.brokers[0].warnings.join(' ')).toMatch(/no broker_config row/);
  });

  it('reports an unobserved provider as unknown + observed:false, never as healthy', async () => {
    const svc = build({
      configs: [{ id: 'mt5', displayName: 'MetaTrader 5', tradingEnabled: true }],
      registrations: [{ id: 'mt5', name: 'MT5', capabilities: ['trades'] }],
      adapters: { mt5: ALL_METHODS },
      degradation: [], // nothing observed
    });

    const res = await svc.getBrokerStatus();
    expect(res.brokers[0].connection).toEqual({ observed: false, status: 'unknown', reason: null });
    expect(res.summary.up).toBe(0);
    expect(res.summary.unobserved).toBe(1);
  });

  it('passes through an observed healthy connection', async () => {
    const svc = build({
      configs: [{ id: 'mt5', displayName: 'MetaTrader 5', tradingEnabled: true }],
      registrations: [{ id: 'mt5', name: 'MT5', capabilities: ['trades'] }],
      adapters: { mt5: ALL_METHODS },
      degradation: [{ providerId: 'mt5', status: 'healthy', reason: '' }],
    });

    const res = await svc.getBrokerStatus();
    expect(res.brokers[0].connection).toMatchObject({ observed: true, status: 'healthy' });
    expect(res.summary.up).toBe(1);
  });

  it('answers "cannot judge" (null), not false, when the adapter cannot be constructed', async () => {
    const svc = build({
      configs: [{ id: 'capital.com', displayName: 'Capital.com', tradingEnabled: true }],
      registrations: [{ id: 'capital.com', name: 'Capital.com', capabilities: ['trades'] }],
      adapters: {}, // create() returns null — missing credentials
    });

    const res = await svc.getBrokerStatus();
    expect(res.brokers[0].runtime).toMatchObject({
      probed: false,
      canPlaceOrder: null,
      canModifyStop: null,
    });
    expect(res.brokers[0].runtime?.probeError).toMatch(/could not be instantiated/);
    // And the UI must be told it cannot verify, rather than being left to infer.
    expect(res.brokers[0].warnings.join(' ')).toMatch(/could not be instantiated/);
  });

  it('survives a throwing create() without losing the row', async () => {
    const svc = build({
      configs: [{ id: 'mt5', displayName: 'MetaTrader 5', tradingEnabled: true }],
      registrations: [{ id: 'mt5', name: 'MT5', capabilities: ['trades'] }],
      throwOnCreate: ['mt5'],
    });

    const res = await svc.getBrokerStatus();
    expect(res.brokers).toHaveLength(1);
    expect(res.brokers[0].runtime?.probed).toBe(false);
    expect(res.brokers[0].runtime?.probeError).toMatch(/exploded/);
  });

  it('flags a supportsBrokerage declaration contradicted by the methods', async () => {
    const svc = build({
      configs: [],
      registrations: [{ id: 'x', name: 'X', capabilities: ['quotes'] }],
      adapters: { x: { supportsBrokerage: true, getPositions: async () => [] } },
    });

    const res = await svc.getBrokerStatus();
    expect(res.brokers[0].runtime?.supportsBrokerageDeclared).toBe(true);
    expect(res.brokers[0].warnings.join(' ')).toMatch(/supportsBrokerage is declared true but placeOrder is absent/);
  });

  it('detects a self-declared stub from the adapter SOURCE, and ignores the class name', async () => {
    // The real defect, reproduced: IBKR logs "called in mock mode — no real execution" and
    // then returns `{ success: true }`. A class-name heuristic misses it entirely.
    class InteractiveBrokersAdapter {
      async placeOrder(_p: any) {
        void 'IBKR placeOrder called in mock mode — no real execution';
        return { success: true };
      }
      async getPositions() { return []; }
    }
    // A cleanly-named MOCK class whose body is honest must NOT be flagged — the name is a
    // guess, the source is the evidence.
    class MockSomethingAdapter {
      async placeOrder() { return { success: true }; }
    }

    const svc = build({
      configs: [],
      registrations: [
        { id: 'interactive-brokers', name: 'IBKR', capabilities: ['trades'] },
        { id: 'clean', name: 'Clean', capabilities: ['trades'] },
      ],
      adapters: {
        'interactive-brokers': new InteractiveBrokersAdapter(),
        clean: new MockSomethingAdapter(),
      },
    });

    const res = await svc.getBrokerStatus();
    const ibkr = res.brokers.find((b) => b.id === 'interactive-brokers')!;
    const clean = res.brokers.find((b) => b.id === 'clean')!;

    expect(ibkr.runtime?.mockSuspect).toBe(true);
    expect(ibkr.warnings.join(' ')).toMatch(/mock\/stub/);
    expect(clean.runtime?.mockSuspect).toBe(false);
    // A stub must not be counted as proven tradeable.
    expect(res.summary.provenTradeable).toBe(1);
  });

  it('separates brokers from data providers so a broker list is not padded with quote APIs', async () => {
    const svc = build({
      configs: [{ id: 'mt5', displayName: 'MT5', tradingEnabled: true }],
      registrations: [
        { id: 'mt5', name: 'MT5', capabilities: ['quotes', 'trades'] },
        { id: 'yahoo', name: 'Yahoo', capabilities: ['quotes', 'candles'] },
        { id: 't212', name: 'T212', capabilities: ['quotes', 'trades'] },
      ],
      adapters: { mt5: ALL_METHODS, yahoo: {}, t212: { placeOrder: async () => ({}) } },
    });

    const res = await svc.getBrokerStatus();
    const role = (id: string) => res.brokers.find((b) => b.id === id)?.role;
    expect(role('mt5')).toBe('broker');
    expect(role('t212')).toBe('broker');
    expect(role('yahoo')).toBe('data-provider');
  });

  it('reports credentialsConfigured as null (not false) when the adapter declares no API-key env', async () => {
    const svc = build({
      configs: [{ id: 'mt5', displayName: 'MT5', tradingEnabled: true }],
      // No apiKeyEnv: MT5 authenticates through the bridges, so an env-key check does not apply.
      registrations: [{ id: 'mt5', name: 'MT5', capabilities: ['trades'] }],
      adapters: { mt5: ALL_METHODS },
    });

    const res = await svc.getBrokerStatus();
    expect(res.brokers[0].credentialsConfigured).toBeNull();
  });

  it('sorts by sortOrder then id, so the list is stable between calls', async () => {
    const svc = build({
      configs: [
        { id: 'zeta', displayName: 'Zeta', sortOrder: 5 },
        { id: 'alpha', displayName: 'Alpha', sortOrder: 1 },
        { id: 'beta', displayName: 'Beta', sortOrder: 5 },
      ],
      registrations: [],
    });

    const res = await svc.getBrokerStatus();
    expect(res.brokers.map((b) => b.id)).toEqual(['alpha', 'beta', 'zeta']);
  });

  it('does not lose the list when the degradation read throws', async () => {
    const brokerConfig = { findAll: async () => [{ id: 'mt5', displayName: 'MT5', tradingEnabled: true }] } as any;
    const adapterFactory = {
      listAdapters: () => [{ id: 'mt5', name: 'MT5', capabilities: ['trades'] }],
      create: () => ALL_METHODS,
      hasCredentials: () => true,
    } as any;
    const degradation = {
      getAll: () => {
        throw new Error('degradation unavailable');
      },
    } as any;

    const svc = new BrokerCapabilityService(brokerConfig, adapterFactory, degradation);
    const res = await svc.getBrokerStatus();
    expect(res.brokers).toHaveLength(1);
    expect(res.brokers[0].connection.status).toBe('unknown');
  });

  it('memoises the probe per adapter id — capability cannot change at runtime', async () => {
    let createCalls = 0;
    const brokerConfig = { findAll: async () => [] } as any;
    const adapterFactory = {
      listAdapters: () => [{ id: 'mt5', name: 'MT5', capabilities: ['trades'] }],
      create: () => {
        createCalls += 1;
        return ALL_METHODS;
      },
      hasCredentials: () => true,
    } as any;
    const degradation = { getAll: () => [] } as any;

    const svc = new BrokerCapabilityService(brokerConfig, adapterFactory, degradation);
    await svc.getBrokerStatus();
    await svc.getBrokerStatus();
    await svc.getBrokerStatus();

    expect(createCalls).toBe(1);
  });
});
