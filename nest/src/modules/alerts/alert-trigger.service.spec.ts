import { AlertTriggerService } from './alert-trigger.service';

/**
 * alert-trigger.service.spec.ts — the `bridge-clock-skew` trigger (#750).
 *
 * WHY THIS IS TESTED
 * ------------------
 * This alert exists to catch a regression that is otherwise invisible: a bridge build
 * without the clock-offset probe stamps broker SERVER time as UTC, every MT5 timestamp
 * lands ~3h in the future, and `computeMarketStatus`'s `ageMs` goes negative — so the
 * tradability gate fails OPEN on stale data. Scores still compute; nothing looks broken.
 *
 * The most important case here is the FIRST one: the live, healthy offset must NOT
 * raise an alert. An alert that cries wolf on +3h (the correct value for
 * MetaQuotes-Demo) would be worse than no alert at all.
 */
describe('AlertTriggerService — bridge-clock-skew', () => {
  const CFG = { enabled: true, cooldownSeconds: 0, severity: 'high' as const, threshold: 14 };

  function build(brokers: any[]) {
    const addAlert = jest.fn();
    const getAllBrokerHealths = jest.fn().mockResolvedValue(brokers);
    const svc = new AlertTriggerService(
      { addAlert } as any,
      {} as any,
      {} as any,
      { getAllBrokerHealths } as any,
    );
    return { svc, addAlert, getAllBrokerHealths };
  }

  const healthy = (server: string, offsetSeconds: number, brokerId = 2) => ({
    brokerId,
    server,
    url: `http://127.0.0.1:${5000 + brokerId - 2}`,
    reachable: true,
    health: { connected: true, serverUtcOffsetSeconds: offsetSeconds, serverUtcOffsetHours: offsetSeconds / 3600 },
  });

  it('stays quiet for the healthy live offset (+3h must not alert)', async () => {
    const { svc, addAlert } = build([healthy('MetaQuotes-Demo', 10800), healthy('PepperstoneUK-Demo', 10800, 3)]);

    await (svc as any).evaluateTrigger('bridge-clock-skew', CFG);

    expect(addAlert).not.toHaveBeenCalled();
  });

  it('rails CRITICAL when the offset telemetry is missing (pre-#750 bridge build)', async () => {
    const broker = healthy('MetaQuotes-Demo', 0);
    delete (broker.health as any).serverUtcOffsetSeconds;
    const { svc, addAlert } = build([broker, healthy('PepperstoneUK-Demo', 10800, 3)]);

    await (svc as any).evaluateTrigger('bridge-clock-skew', CFG);

    expect(addAlert).toHaveBeenCalledTimes(1);
    const [type, title, detail, severity] = addAlert.mock.calls[0];
    // Argument order matters — see the fireAlert() warning comment.
    expect(type).toBe('trading');
    expect(title).toBe('MT5 Clock-Offset Telemetry Missing');
    expect(detail).toContain('MetaQuotes-Demo');
    expect(detail).not.toContain('PepperstoneUK-Demo'); // only the broken one is named
    expect(severity).toBe('critical');
  });

  it('raises HIGH when the measured offset is implausible', async () => {
    const { svc, addAlert } = build([healthy('MetaQuotes-Demo', 20 * 3600)]);

    await (svc as any).evaluateTrigger('bridge-clock-skew', CFG);

    expect(addAlert).toHaveBeenCalledTimes(1);
    const [type, title, detail, severity] = addAlert.mock.calls[0];
    expect(type).toBe('trading');
    expect(title).toBe('MT5 Clock-Offset Implausible');
    expect(detail).toContain('20.00h');
    expect(severity).toBe('high');
  });

  it('accepts a negative offset (a broker behind UTC) as healthy', async () => {
    const { svc, addAlert } = build([healthy('SomeBroker', -5 * 3600)]);

    await (svc as any).evaluateTrigger('bridge-clock-skew', CFG);

    expect(addAlert).not.toHaveBeenCalled();
  });

  it('stays quiet when a bridge is unreachable — mt5-disconnected owns that case', async () => {
    const down = { brokerId: 2, server: 'MetaQuotes-Demo', url: 'http://127.0.0.1:5000', reachable: false, health: null };
    const { svc, addAlert } = build([down]);

    await (svc as any).evaluateTrigger('bridge-clock-skew', CFG);

    expect(addAlert).not.toHaveBeenCalled();
  });

  it('stays quiet when the bridge answers but MT5 is not connected', async () => {
    const disconnected = healthy('MetaQuotes-Demo', 10800);
    (disconnected.health as any).connected = false;
    const { svc, addAlert } = build([disconnected]);

    await (svc as any).evaluateTrigger('bridge-clock-skew', CFG);

    expect(addAlert).not.toHaveBeenCalled();
  });
});
