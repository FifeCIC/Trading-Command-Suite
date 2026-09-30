import { Mt5SessionRecoveryService } from './mt5-session-recovery.service';

/**
 * mt5-session-recovery.spec.ts — #992 option B, the API-side recovery watchdog.
 *
 * ⚠️ THE WHOLE VALUE OF THIS SERVICE IS IN *WHEN* IT FIRES, so that is what is pinned here. It runs
 * `POST /reconnect` on a bridge, which executes `mt5.shutdown()` + `initialize()` — it TEARS DOWN a
 * live session. Firing it at a bridge that is merely mid-recovery would destroy a working link, and
 * firing it at a bridge that is not running would achieve nothing at all.
 *
 * ⚠️ CANARY (run before trusting this file):
 *   1. lower `FAILURES_BEFORE_ACTION` to 1 → `does not act before the threshold` must FAIL;
 *   2. delete the `if (!h.answered)` branch → `does not reconnect a bridge that did not answer`
 *      must FAIL (it would post at a bridge that is not listening);
 *   3. delete the `MAX_ATTEMPTS` bound → `stops after the cap` must FAIL.
 */
describe('#992 — MT5 session recovery watchdog (option B)', () => {
  const HEALTHY = { brokerId: 2, server: 'MetaQuotes-Demo', url: 'http://localhost:5000', health: {}, reachable: true, answered: true, connectionState: 'ok', connectionStateDetail: '', remedy: '' };
  const SESSION_LOST = { brokerId: 2, server: 'MetaQuotes-Demo', url: 'http://localhost:5000', health: {}, reachable: false, answered: true, connectionState: 'session-lost', connectionStateDetail: 'terminal is running but its session is not connected', remedy: 'POST http://127.0.0.1:5000/reconnect' };
  /** The bridge did not reply at all — `POST /reconnect` cannot help; the remedy is to start it. */
  const UNANSWERED = { brokerId: 2, server: '?', url: 'http://localhost:5000', health: null, reachable: false, answered: false, connectionState: null, connectionStateDetail: null, remedy: null };

  function make(sequence: any[][]) {
    const reconnects: Array<number | null> = [];
    let i = 0;
    const mt5: any = {
      // One health snapshot per evaluate(), so a test scripts a SEQUENCE of observations.
      getAllBrokerHealths: jest.fn(async () => sequence[Math.min(i++, sequence.length - 1)]),
      reconnectBroker: jest.fn(async (brokerId: number | null) => {
        reconnects.push(brokerId);
        return { success: true, brokerId, connectionState: 'ok' };
      }),
    };
    const svc = new Mt5SessionRecoveryService(mt5);
    svc['logger'] = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
    return { svc, reconnects, mt5 };
  }

  it('does NOT act before the threshold — a single blip must not tear down a session', async () => {
    const { svc, reconnects } = make([[SESSION_LOST], [SESSION_LOST]]);
    await svc.evaluate();
    await svc.evaluate();
    expect(reconnects).toEqual([]);
    expect(svc.getState().bridges[0].blockedReason).toMatch(/waiting/i);
  });

  it('acts AT the threshold, naming the broker that is down', async () => {
    const { svc, reconnects } = make([[SESSION_LOST], [SESSION_LOST], [SESSION_LOST]]);
    await svc.evaluate();
    await svc.evaluate();
    await svc.evaluate();
    expect(reconnects).toEqual([2]);
    expect(svc.getState().totalAttempts).toBe(1);
  });

  it('⚠️ does NOT reconnect a bridge that did not ANSWER — the remedy is to start it', async () => {
    // The distinction #992's second half exists for. Posting /reconnect at a bridge that is not
    // listening cannot work, and reporting it as a failed recovery would send the operator to the
    // wrong place. It is recorded as unanswering, with the remedy that actually applies.
    const { svc, reconnects } = make([[UNANSWERED], [UNANSWERED], [UNANSWERED], [UNANSWERED]]);
    for (let i = 0; i < 4; i++) await svc.evaluate();
    expect(reconnects).toEqual([]);
    expect(svc.getState().unansweringBrokerIds).toEqual([2]);
    expect(svc.getState().bridges[0].lastRemedy).toMatch(/Start the bridge/i);
  });

  it('stops after the cap — reconnecting forever hides the real remedy', async () => {
    // Mirrors the bridge's own WATCHDOG_TERMINAL_DOWN_MAX_ATTEMPTS bound, from outside.
    // ⚠️ The threshold consumes the first 3 observations, so reaching a cap of 5 attempts needs
    // 3 + 5 evaluations, not 5. The first version of this test asserted 5 over 6 iterations and
    // failed with 4 — the arithmetic was mine, not the watchdog's.
    const { svc, reconnects } = make([[SESSION_LOST]]);
    for (let i = 0; i < 12; i++) {
      await svc.evaluate();
      // Clear the cooldown so the test drives ATTEMPTS rather than the clock.
      (svc as any).records.get(2)!.lastAttemptAt = new Date(Date.now() - 10 * 60_000).toISOString();
    }
    expect(reconnects.length).toBe(5); // MAX_ATTEMPTS
    expect(svc.getState().bridges[0].blockedReason).toMatch(/stopped after 5 attempts/i);
  });

  it('a healthy observation RESETS the record, so a later outage starts from zero', async () => {
    const { svc, reconnects } = make([[SESSION_LOST], [SESSION_LOST], [SESSION_LOST], [HEALTHY], [SESSION_LOST], [SESSION_LOST]]);
    for (let i = 0; i < 6; i++) await svc.evaluate();
    expect(reconnects).toEqual([2]); // one attempt, then reset — not two
    expect(svc.getState().bridges[0].attempts).toBe(0);
  });

  it('respects the cooldown between attempts', async () => {
    const { svc, reconnects } = make([[SESSION_LOST]]);
    for (let i = 0; i < 5; i++) await svc.evaluate(); // no clock advanced
    expect(reconnects).toEqual([2]); // attempt 1 only; the rest are inside the cooldown
    expect(svc.getState().bridges[0].blockedReason).toMatch(/cooldown/i);
  });

  it('is switchable off, because it can be aimed at a live session', async () => {
    const { svc, reconnects } = make([[SESSION_LOST]]);
    svc.setEnabled(false);
    for (let i = 0; i < 4; i++) await svc.poll();
    expect(reconnects).toEqual([]);
    expect(svc.getState().enabled).toBe(false);
  });

  it('⚠️ ships DISABLED — an unattended money-path action stays off until its blast radius is measured', () => {
    // MEASURED 2026-09-30: a reconnect on an UNRELATED third bridge (:5002) coincided with BOTH
    // live bridges dropping to `terminal-down`, and they recovered only when each was driven by
    // hand. The mechanism (`mt5.shutdown()` breaking a terminal-shared IPC link) is plausible but
    // was NOT isolated, so the automatic action was switched off rather than left live.
    // ⚠️ CANARY: set `enabled: true` in the service's initial `state` and this FAILS.
    const { svc } = make([[SESSION_LOST]]);
    expect(svc.getState().enabled).toBe(false);
  });
});
