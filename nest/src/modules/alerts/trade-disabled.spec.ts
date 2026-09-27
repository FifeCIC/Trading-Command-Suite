/**
 * #972/#1010 — `trade-disabled` must fire when NOTHING can place an order, and stay silent when
 * something can.
 *
 * Owner, 2026-09-27: *"I need the app to draw my attention when algo trading is not active."*
 *
 * ⚠️ EVERY CASE BELOW IS A DIRECTION, NOT A DECORATION. A rule that only proves it fires cannot be
 * told apart from one that always fires; a rule that only proves it stays quiet cannot be told from
 * one that is dead. The measured defect this exists for — both terminals `connected: true` with
 * AutoTrading off, 19 refusals, ONE execution in 48h — sat behind a green `mt5-disconnected` trigger
 * for two days precisely because nobody tested the silent direction.
 */

import { AlertTriggerService } from './alert-trigger.service';

/** Reach the private check without widening the service's public surface for a test. */
function check(service: AlertTriggerService): () => Promise<any> {
  return (service as any).checkTradeDisabled.bind(service);
}

function serviceWith(brokers: any[]) {
  const windows = { notify: jest.fn(), reset: jest.fn() };
  const svc = new AlertTriggerService(
    { addAlert: jest.fn() } as any,        // alerts
    {} as any,                              // prisma
    {} as any,                              // calendar
    { getAllBrokerHealths: async () => brokers } as any, // mt5Connection
    windows as any,
  );
  return { svc, windows };
}

const up = (brokerId: number, health: any) => ({
  brokerId,
  server: `srv${brokerId}`,
  reachable: true,
  health: { connected: true, ...health },
});

describe('#972/#1010 — trade-disabled', () => {
  it('FIRES when every connected bridge has AutoTrading off', async () => {
    const { svc } = serviceWith([
      up(2, { tradeAllowed: false, tradeapiDisabled: false }),
      up(3, { tradeAllowed: false, tradeapiDisabled: false }),
    ]);
    const r = await check(svc)();
    expect(r?.triggered).toBe(true);
    expect(r?.message).toContain('AutoTrading off');
    // It must say the bridges are UP — that is the fact that makes this alert necessary.
    expect(r?.message).toContain('CONNECTED');
  });

  it('STAYS SILENT when one broker can trade — even if the other cannot', async () => {
    // ⚠️ The direction that stops "one broken broker" reading as "trading is off".
    const { svc, windows } = serviceWith([
      up(2, { tradeAllowed: false, tradeapiDisabled: false }),
      up(3, { tradeAllowed: true, tradeapiDisabled: false }),
    ]);
    const r = await check(svc)();
    expect(r?.triggered).toBe(false);
    // And the throttle must be CLEARED, or the next real outage is suppressed by this one.
    expect(windows.reset).toHaveBeenCalledWith('trade-disabled');
  });

  it('STAYS SILENT when a flag is UNKNOWN (null) — unknown is not off', async () => {
    // ⚠️ In the same family as everything else: an unreadable poll must never be published as a
    // definite fault. `null` means the bridge could not read terminal_info() at all.
    const { svc } = serviceWith([
      up(2, { tradeAllowed: null, tradeapiDisabled: null }),
      up(3, { tradeAllowed: null, tradeapiDisabled: null }),
    ]);
    const r = await check(svc)();
    expect(r?.triggered).toBe(false);
  });

  it('FIRES on tradeapiDisabled EVEN WHEN tradeAllowed is true — the second flag is independent', async () => {
    // ⚠️ This is the case #1010 exists for: the terminal button is ON and the API path is closed.
    // A check that read only `tradeAllowed` would report "fine" here while nothing could execute.
    const { svc } = serviceWith([up(2, { tradeAllowed: true, tradeapiDisabled: true })]);
    const r = await check(svc)();
    expect(r?.triggered).toBe(true);
    expect(r?.message).toContain('API trade path disabled');
  });

  it('STAYS SILENT when NO bridge is connected — that is mt5-disconnected_s case, not this one', async () => {
    // ⚠️ Direction that stops this trigger double-reporting a dropped bridge. Two alerts for one
    // cause is how an alert channel stops being read.
    const { svc } = serviceWith([
      { brokerId: 2, server: '?', reachable: false, health: null },
      { brokerId: 3, server: '?', reachable: false, health: null },
    ]);
    const r = await check(svc)();
    expect(r).toBeNull();
  });

  it('STAYS SILENT when the bridge health query throws — cannot judge is not a fault', async () => {
    const windows = { notify: jest.fn(), reset: jest.fn() };
    const svc = new AlertTriggerService(
      { addAlert: jest.fn() } as any,
      {} as any,
      {} as any,
      { getAllBrokerHealths: async () => { throw new Error('bridge down'); } } as any,
      windows as any,
    );
    expect(await check(svc)()).toBeNull();
  });
});

describe('ATTENTION_KEYS — which conditions earn a Windows notification', () => {
  it('includes trade-disabled, and is deliberately small', () => {
    const keys = (new (AlertTriggerService as any)(
      { addAlert: jest.fn() } as any, {} as any, {} as any,
      { getAllBrokerHealths: async () => [] } as any,
      { notify: jest.fn(), reset: jest.fn() } as any,
    ) as any).ATTENTION_KEYS as Set<string>;

    expect(keys.has('trade-disabled')).toBe(true);
    // ⚠️ A CHANNEL THAT FIRES FOR EVERY WARNING IS ONE THAT GETS DISMISSED UNREAD. If this set
    // grows past a handful, the notification stops carrying information — that is the assertion,
    // not the specific membership.
    expect(keys.size).toBeLessThanOrEqual(4);
  });
});
