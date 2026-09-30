import { Mt5Controller } from './mt5.controller';
import { Mt5ConnectionManager } from './mt5/mt5-connection-manager.service';

/**
 * mt5-reconnect-broker.spec.ts — the API can aim a reconnect at a NAMED bridge (#992 criterion 4).
 *
 * ⚠️ THE DEFECT THIS LOCKS OUT. `POST /providers/mt5/reconnect` hardcoded a single `BRIDGE_URL`
 * resolved from the PRIMARY bridge. With `MT5_ACTIVE_BROKERS=2,3` there are two bridges on :5000
 * and :5001, and the one recovery route the app exposes could not be aimed at the broker that was
 * down. On 2026-09-25 broker 2 lost its session and halted trading; the API could only have
 * reached it by luck of being primary.
 *
 * ⚠️ WHY THE REFUSAL TEST IS THE IMPORTANT ONE. `Mt5ConnectionManager.getUrl(brokerId)` THROWS for
 * an unregistered id rather than substituting the default (#914). The endpoint must REPORT that
 * throw. Swallowing it into a generic "bridge unreachable" would tell the operator the bridge was
 * down when the real fault was the id they asked for — the same class of misdirection as a
 * reconnect that silently hits the wrong bridge.
 *
 * ⚠️ CANARY (run before trusting this file). Change `@Query('brokerId') brokerId?: string` usage so
 * the resolution reads `this.BRIDGE_URL` unconditionally. `test_targets_the_NAMED_bridge` and
 * `test_refuses_an_unregistered_id` must both FAIL.
 */
describe('Mt5Controller.reconnect — per-broker targeting (#992)', () => {
  const PRIMARY = 'http://localhost:5000';
  const PEPPERSTONE = 'http://localhost:5001';

  /**
   * ⚠️ THE DOUBLE DELEGATES TO THE REAL MANAGER, DELIBERATELY (#992).
   *
   * The reconnect logic now lives in `Mt5ConnectionManager.reconnectBroker()`; this endpoint is a
   * thin wrapper over it so that the AUTOMATIC recovery watchdog and this manual route cannot drift
   * apart. A double that hand-rolled its own routing would therefore be testing a copy, and the real
   * one could regress unnoticed — exactly the failure this file exists to catch. So it constructs
   * the real manager and forwards.
   *
   * The manager reads `MT5_ACTIVE_BROKERS` at CONSTRUCTION, so the env is set for that one line and
   * restored immediately — otherwise this file would leak two brokers into every other spec sharing
   * the process.
   */
  function make() {
    const ctrl = Object.create(Mt5Controller.prototype) as any;
    const fetched: string[] = [];
    const saved = process.env.MT5_ACTIVE_BROKERS;

    process.env.MT5_ACTIVE_BROKERS = '2,3';
    const real = new Mt5ConnectionManager();
    if (saved === undefined) delete process.env.MT5_ACTIVE_BROKERS;
    else process.env.MT5_ACTIVE_BROKERS = saved;

    ctrl.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    ctrl.BRIDGE_URL = PRIMARY;
    ctrl.mt5Connection = {
      // Kept because the REAL manager owns this contract: it THROWS for an unregistered id rather
      // than substituting the default (#914), and a mock that returned the default would make the
      // refusal test pass for the wrong reason.
      getUrl: jest.fn((id?: number | null) => {
        if (id == null) return PRIMARY;
        const url = new Map<number, string>([[2, PRIMARY], [3, PEPPERSTONE]]).get(id);
        if (!url) throw new Error(`Broker ${id} is not an MT5 bridge (active: 2, 3) — refusing to answer as the default bridge`);
        return url;
      }),
      // The canonical implementation, not a second copy of it.
      reconnectBroker: (id?: number | null) => real.reconnectBroker(id),
    };

    (global as any).fetch = jest.fn(async (url: string) => {
      fetched.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, connected: true, connectionState: 'ok', account: '10011309743' }),
      };
    });

    return { ctrl, fetched };
  }

  it('targets the NAMED bridge, not the primary', async () => {
    const { ctrl, fetched } = make();
    const out = await ctrl.reconnect('3');

    expect(fetched).toEqual([`${PEPPERSTONE}/reconnect`]);
    expect(out.brokerId).toBe(3);
    expect(out.bridgeUrl).toBe(PEPPERSTONE);
    // ⚠️ The response NAMES which bridge answered. With two bridges running, a bare `success:true`
    // does not tell the operator whether the RIGHT one recovered.
    expect(out.success).toBe(true);
  });

  it('still defaults to the primary when no brokerId is given', async () => {
    // Backwards compatibility is the reason `undefined` must keep meaning "default" — existing
    // callers pass nothing.
    const { ctrl, fetched } = make();
    const out = await ctrl.reconnect(undefined);

    expect(fetched).toEqual([`${PRIMARY}/reconnect`]);
    expect(out.brokerId).toBeNull();
  });

  it('REFUSES an unregistered id and reports the real reason', async () => {
    // ⚠️ The throw must be surfaced, not collapsed into "bridge unreachable". A caller told the
    // bridge is down will go and restart a bridge that was never the problem.
    const { ctrl, fetched } = make();
    const out = await ctrl.reconnect('99');

    expect(fetched).toEqual([]); // nothing was called — no silent fallback to the default
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/not an MT5 bridge/i);
    expect(out.error).toMatch(/active: 2, 3/); // names the ids that DO exist
  });

  it('refuses a non-integer id rather than coercing it', async () => {
    const { ctrl, fetched } = make();
    const out = await ctrl.reconnect('abc');

    expect(fetched).toEqual([]);
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/integer/i);
  });

  it('passes the bridge\u2019s own connectionState through, not just a boolean', async () => {
    // The bridge classifies its link (ok | session-lost | terminal-down | account-unavailable).
    // Collapsing that back to connected:true/false here would undo #992's other half.
    const { ctrl } = make();
    const out = await ctrl.reconnect('2');
    expect(out.connectionState).toBe('ok');
  });
});
