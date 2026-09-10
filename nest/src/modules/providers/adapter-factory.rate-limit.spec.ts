import { Logger } from '@nestjs/common';
import { AdapterFactory, AdapterConfig } from './adapter-factory';
import { RateLimitGovernor } from './rate-limit-governor.service';

/**
 * GH #744 — "Provider rate limiting is a no-op".
 *
 * `getActive()` used to compute `remaining` from this factory's own trackers and
 * fall back to `Infinity`. Nothing ever called `setRateLimiter()`, so EVERY
 * provider looked unlimited, the skip/failover branch could not trigger, and the
 * metered keys (finnhub free tier = 60/min) were hammered without back-off.
 *
 * These tests drive the real RateLimitGovernor (whose `recordCall` is already
 * invoked by the finnhub adapter after every response), so they fail if the
 * factory stops consulting it.
 */

class FakeAdapter {
  constructor(readonly name: string) {}
}

function config(id: string, failoverPriority: number): AdapterConfig {
  return {
    id,
    name: `${id} adapter`,
    apiKeyEnv: `${id.toUpperCase()}_API_KEY`,
    capabilities: ['quotes'],
    enabled: true,
    failoverPriority,
  } as AdapterConfig;
}

/** Factory with N fake adapters already instantiated ("cached instances"). */
function factoryWith(governor: RateLimitGovernor | undefined, ids: string[]) {
  const factory = new AdapterFactory(undefined, governor);
  ids.forEach((id, i) => {
    factory.register(id, class extends FakeAdapter { constructor() { super(id); } } as any, config(id, i + 1));
    factory.create(id);
  });
  return factory;
}

/** Real governor with `calls` successful finnhub calls already recorded. */
function governorAfterFinnhubCalls(calls: number): RateLimitGovernor {
  const governor = new RateLimitGovernor();
  for (let i = 0; i < calls; i++) governor.recordCall('finnhub', true, 200);
  return governor;
}

describe('AdapterFactory rate-limit aware selection (GH #744)', () => {
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('reports a FINITE remaining count for every provider, never Infinity', () => {
    const factory = factoryWith(governorAfterFinnhubCalls(2), ['finnhub', 'mt5']);

    factory.getActive();

    const logged = debugSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/remaining/);
    expect(logged).not.toMatch(/Infinity/);
  });

  it('fails over away from finnhub once its budget is nearly spent', () => {
    // 58 of 60 calls used → 2 remaining, below the 5-call floor.
    const governor = governorAfterFinnhubCalls(58);
    const factory = factoryWith(governor, ['finnhub', 'mt5']);

    const active = factory.getActive() as any;

    expect(active.name).toBe('mt5');
    expect(governor.getStatus().providers.finnhub.remainingEstimate).toBe(2);
  });

  it('keeps using a metered provider that still has budget', () => {
    const factory = factoryWith(governorAfterFinnhubCalls(10), ['finnhub']);

    const active = factory.getActive() as any;

    expect(active.name).toBe('finnhub');
    const logged = debugSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/50 remaining/);
  });

  it('skips a provider the governor has blocked, even with a healthy count', () => {
    const governor = governorAfterFinnhubCalls(0);
    // 401 marks the key expired, which blocks the provider outright.
    governor.recordCall('finnhub', false, 401);
    const factory = factoryWith(governor, ['finnhub', 'mt5']);

    const active = factory.getActive() as any;

    expect(governor.canCall('finnhub').allowed).toBe(false);
    expect(active.name).toBe('mt5');
  });

  it('returns the least-exhausted provider when everything is throttled, rather than bypassing limits', () => {
    const governor = governorAfterFinnhubCalls(60);   // finnhub exhausted
    const factory = factoryWith(governor, ['finnhub']);
    // No mt5 to fail over to: the old code fell through to "create anything from
    // the registry", which ignored the limit entirely.
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const active = factory.getActive() as any;

    expect(active).not.toBeNull();
    expect(active.name).toBe('finnhub');
    expect(warnSpy.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/All providers throttled/);
  });

  it('gives a provider the governor does not know a finite default', () => {
    const governor = new RateLimitGovernor();
    const factory = factoryWith(governor, ['some-unlisted-provider']);

    const active = factory.getActive() as any;

    expect(active.name).toBe('some-unlisted-provider');
    const logged = debugSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toMatch(/Infinity/);
  });

  it('still works with no governor injected (manual construction)', () => {
    const factory = factoryWith(undefined, ['finnhub', 'mt5']);

    const active = factory.getActive() as any;

    expect(active).not.toBeNull();
  });
});
