/**
 * #984 — the "MT5 Bridge(s) Down" alert must NAME the broker.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────────────────────
 * The live alert read:
 *
 *     MT5 Bridge(s) Down: ? unreachable. Only 1/2 active.
 *
 * The `?` is where the broker's name should be. The message used `b.server`, and that field is null
 * when the bridge cannot be reached — which is EXACTLY when this alert fires. So the one alert whose
 * entire job is "tell me which broker stopped" could not say.
 *
 * The issue it comes from states its own point well: *"a single `mt5` bucket cannot answer 'is my
 * second broker working?'"*
 *
 * ⚠️ The `server: null` cases below are the real ones. A test that supplied a server name would pass
 * whether or not the fix worked — the null case IS the test.
 */

import { AlertTriggerService } from './alert-trigger.service';

/** Build the service without its constructor: this spec exercises ONE private check. */
function make(brokers: any[]) {
  const svc: any = Object.create(AlertTriggerService.prototype);
  svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  svc.mt5Connection = { getAllBrokerHealths: jest.fn(async () => brokers) };
  return svc;
}

const healthy = (brokerId: number, server: string | null) => ({
  brokerId, server, url: `http://localhost:${4998 + brokerId}`,
  reachable: true, health: { connected: true },
});
const down = (brokerId: number, server: string | null) => ({
  brokerId, server, url: `http://localhost:${4998 + brokerId}`,
  reachable: false, health: null,
});

describe('checkMt5Connection — names the broker (#984)', () => {
  it('names the broker by ID when `server` is null — the case that produced "?"', async () => {
    // Broker 2 healthy with a name; broker 3 down and UNNAMEABLE (its probe failed).
    const svc = make([healthy(2, 'MetaQuotes-Demo'), down(3, null)]);
    const r = await svc.checkMt5Connection();

    expect(r.triggered).toBe(true);
    expect(r.message).toContain('broker 3');
    // The whole point: no bare placeholder, and no literal "undefined"/"null" either.
    expect(r.message).not.toContain('? unreachable');
    expect(r.message).not.toContain('undefined');
    expect(r.message).not.toContain('null');
    // The healthy broker must NOT be reported as down.
    expect(r.message).not.toContain('broker 2');
    // The counts the title must not carry are still readable here.
    expect(r.message).toContain('1/2');
  });

  it('still shows the server name when it IS known', async () => {
    const svc = make([healthy(2, 'MetaQuotes-Demo'), down(3, 'PepperstoneUK-Demo')]);
    const r = await svc.checkMt5Connection();
    expect(r.message).toContain('broker 3 (PepperstoneUK-Demo)');
  });

  it('names EVERY broker when all are down', async () => {
    const svc = make([down(2, null), down(3, null)]);
    const r = await svc.checkMt5Connection();
    expect(r.title).toBe('All MT5 Bridges Disconnected');
    expect(r.message).toContain('broker 2');
    expect(r.message).toContain('broker 3');
    expect(r.message).not.toContain('undefined');
  });

  it('does not fire when both brokers are healthy', async () => {
    const svc = make([healthy(2, 'MetaQuotes-Demo'), healthy(3, 'PepperstoneUK-Demo')]);
    const r = await svc.checkMt5Connection();
    expect(r.triggered).toBe(false);
  });

  it('a reachable bridge that is not CONNECTED still counts as down', async () => {
    // The distinction matters: the HTTP port answering is not the same as the terminal being up.
    const svc = make([
      healthy(2, 'MetaQuotes-Demo'),
      { brokerId: 3, server: 'PepperstoneUK-Demo', url: 'http://localhost:5001', reachable: true, health: { connected: false } },
    ]);
    const r = await svc.checkMt5Connection();
    expect(r.triggered).toBe(true);
    expect(r.message).toContain('broker 3');
  });

  it('an empty broker list is reported, not silently healthy', async () => {
    const svc = make([]);
    const r = await svc.checkMt5Connection();
    expect(r.triggered).toBe(true);
    expect(r.message).toContain('No MT5 broker bridges configured');
  });
});
