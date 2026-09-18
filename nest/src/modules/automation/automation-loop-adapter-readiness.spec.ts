import { AutomationLoopService } from './automation-loop.service';

/**
 * #877 — the first tick after a restart must not run before the broker adapters exist.
 *
 * WHY THIS SUITE EXISTS
 *
 * `start()` fired an immediate tick so a restart would not cost a full interval. But the adapters
 * are registered by `ProvidersModule`'s OWN `onModuleInit`, and Nest does not guarantee that hook
 * runs before this one. Measured 2026-09-18 on 0.35.0:
 *
 *     Tick #1: 1 timeline events, global risk 1.00
 *     WARN  [AdapterFactory] No adapter registered for id: mt5          ← the tick's own fetch
 *     DEBUG [AdapterFactory] Registered adapter: mt5 (MetaTrader 5)     ← registration, after
 *
 * `create('mt5')` returned null, the broker loop skipped the broker, and
 * `positionSync.syncPositions()` was never called — so that pass reconciled nothing and closed
 * nothing, **with no line saying it had been skipped**. The next tick 2 minutes later worked.
 *
 * ⚠️ WHAT THESE TESTS DO AND DO NOT COVER
 *
 * They cover the WAIT: that it holds the tick until registrations exist, that it is bounded, and
 * that it proceeds anyway when nothing registers. They do NOT cover the ordering claim itself —
 * whether Nest actually runs `ProvidersModule`'s hook after this one is a property of the module
 * graph, and the fix is deliberately correct either way (wait if needed, proceed regardless).
 */

describe('AutomationLoopService — first tick waits for adapters (#877)', () => {
  /**
   * Built via the prototype rather than the constructor: `tickWhenAdaptersReady()` touches only
   * `adapterFactory` and `tick`, and the real constructor takes a dozen injected services. Using
   * the prototype keeps the test about the behaviour under test instead of about a mock graph.
   */
  const makeService = (listAdapters: () => unknown[]) => {
    const svc: any = Object.create(AutomationLoopService.prototype);
    svc.adapterFactory = { listAdapters: jest.fn(listAdapters) };
    svc.tick = jest.fn(async () => {});
    return svc;
  };

  it('waits for registrations before ticking', async () => {
    let calls = 0;
    // Nothing registered for the first few polls — the exact state at Tick #1.
    const svc = makeService(() => (++calls >= 3 ? [{ id: 'mt5' }] : []));

    await svc.tickWhenAdaptersReady(2000);

    expect(svc.tick).toHaveBeenCalledTimes(1);
    // It must have POLLED, not just proceeded — otherwise this test would pass against the
    // broken behaviour it exists to prevent.
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('ticks immediately when the adapters are already registered', async () => {
    const svc = makeService(() => [{ id: 'mt5' }]);
    const started = Date.now();

    await svc.tickWhenAdaptersReady(2000);

    expect(svc.tick).toHaveBeenCalledTimes(1);
    // No pointless delay on the normal path.
    expect(Date.now() - started).toBeLessThan(150);
  });

  it('⚠️ is BOUNDED — still ticks when nothing ever registers', async () => {
    // A genuinely missing adapter is a different problem and must not stop the loop. If this
    // hangs, the loop never runs at all, which is a worse failure than the one being fixed.
    const svc = makeService(() => []);

    await svc.tickWhenAdaptersReady(150);

    expect(svc.tick).toHaveBeenCalledTimes(1);
  });

  it('does not create an adapter in order to ask whether adapters exist', async () => {
    // ⚠️ THE TRAP THAT MAKES "just retry create()" THE WRONG FIX. `create()` on a registered
    // adapter whose DI is not ready falls through to `new ctor()` in `instantiate()` and CACHES
    // the dependency-less instance — so polling with `create()` could poison the factory while
    // trying to check it. `listAdapters()` reads the registry only; this asserts that contract,
    // because the safety of the wait depends on it.
    const svc = makeService(() => [{ id: 'mt5' }]);
    svc.adapterFactory.create = jest.fn();

    await svc.tickWhenAdaptersReady(2000);

    expect(svc.adapterFactory.create).not.toHaveBeenCalled();
  });
});
