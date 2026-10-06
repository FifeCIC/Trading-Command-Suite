/**
 * stop-guardian-decline-log.spec.ts — the guardian's DECLINES are durable, and bounded (#1056).
 * ================================================================================================
 * THE DEFECT THIS PINS. `stop_adjustment` records what the guardian DID. Nothing recorded what it
 * DECLINED, so once a position closed, *"why was this never trailed?"* was unanswerable — which is
 * how FRA40 stayed unexplained while five of its six broker-3 peers were trailed normally.
 *
 * `guardedPositions[].outcome` answers it only WHILE the position is open: the array is rebuilt every
 * tick and lives in memory. So the fix that added `outcome` narrowed the hole without closing it, and
 * FRA40 trades for a few hours at a time — nobody is watching when it matters.
 *
 * ⚠️ THE ASSERTION THAT MATTERS IS THE *SECOND* ONE. "A decline is logged" passes against a naive
 * implementation that logs EVERY tick — which at ~2-minute ticks across ~9 positions is thousands of
 * lines a day, and the repo has already paid for that mistake (4,800 identical bridge warnings,
 * 5.8 MB in one day). The guard is that a REPEATED state change writes nothing.
 *
 * ⚠️ CANARY DIRECTIONS (run before trusting this file):
 *   1. Delete the `isDeclined && (!wasDeclined || was !== now)` condition, logging unconditionally →
 *      `a repeated decline writes nothing more` FAILS (it becomes 3 lines).
 *   2. Remove the `lastOutcome.delete` prune loop → `a closed position is forgotten` FAILS.
 *   3. Remove the `if (!this.syslog) return;` guard and pass no syslog → the suite throws.
 */
import { StopGuardianService } from './stop-guardian.service';

/** Only the fields `logDeclines` reads — a full GuardedPosition would be noise. */
const pos = (over: Partial<any> = {}): any => ({
  ticket: 92748259,
  symbol: 'FRA40',
  side: 'BUY',
  brokerId: 3,
  outcome: 'below-threshold',
  stopConfidence: 0,
  currentSl: 7823,
  recommendedSl: null,
  ...over,
});

function build(syslog: any) {
  const service = new StopGuardianService(
    {} as any, // strategyService
    {} as any, // directivesService
    {} as any, // mt5Connection
    {} as any, // adjustmentRecorder
    undefined, // notifications
    syslog,    // syslog — the optional one
  );
  // Private, and deliberately exercised directly: the unit under test is the transition rule, not
  // the tick that calls it (the tick is covered by stop-guardian.service.spec.ts).
  return (service as any);
}

const call = (service: any, positions: any[]) => service.logDeclines(positions);

/** The message text of each `info` line the guardian wrote. */
const lines = (syslog: any) => syslog.info.mock.calls.map((c: any[]) => String(c[1]));

describe('StopGuardianService — durable decline log (#1056)', () => {
  let syslog: any;
  let service: any;

  beforeEach(() => {
    syslog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service = build(syslog);
  });

  it('logs a decline when it starts, with the reason and the numbers behind it', () => {
    call(service, [pos()]);

    expect(syslog.info).toHaveBeenCalledTimes(1);
    const [, message, category] = syslog.info.mock.calls[0];
    expect(category).toBe('trading');
    expect(message).toContain('DECLINED');
    expect(message).toContain('FRA40');
    expect(message).toContain('broker=3');
    expect(message).toContain('ticket=92748259');
    // The REASON is the whole point — a bare "declined" would be the same non-answer as silence.
    expect(message).toContain('outcome=below-threshold');
    expect(message).toContain('consensus=0');
  });

  it('a repeated decline writes nothing more — the log is bounded by STATE, not by ticks', () => {
    call(service, [pos()]);
    call(service, [pos()]);
    call(service, [pos()]);

    expect(syslog.info).toHaveBeenCalledTimes(1);
  });

  it('a CHANGE of reason logs again, and names what it changed from', () => {
    call(service, [pos({ outcome: 'below-threshold' })]);
    call(service, [pos({ outcome: 'no-bars' })]);

    expect(syslog.info).toHaveBeenCalledTimes(2);
    expect(lines(syslog)[1]).toContain('outcome=no-bars');
    expect(lines(syslog)[1]).toContain('(was below-threshold)');
  });

  it('a decline ENDING logs once, so the recovery is visible rather than implied by silence', () => {
    call(service, [pos({ outcome: 'below-threshold' })]);
    call(service, [pos({ outcome: 'adjusted' })]);
    call(service, [pos({ outcome: 'at-target' })]); // still fine — no further line

    expect(syslog.info).toHaveBeenCalledTimes(2);
    expect(lines(syslog)[1]).toContain('MANAGED');
    expect(lines(syslog)[1]).toContain('(was below-threshold)');
  });

  it('a position that was NEVER declined logs nothing at all', () => {
    call(service, [pos({ outcome: 'adjusted' })]);
    call(service, [pos({ outcome: 'at-target' })]);

    expect(syslog.info).not.toHaveBeenCalled();
  });

  it('adjusted <-> at-target oscillation writes no lines', () => {
    // The trailing stop moves, then the next tick finds it already at the recommendation. That is
    // normal operation, and it must not be able to flood the canonical log.
    for (const outcome of ['adjusted', 'at-target', 'adjusted', 'at-target', 'adjusted']) {
      call(service, [pos({ outcome })]);
    }

    expect(syslog.info).not.toHaveBeenCalled();
  });

  it('a closed position is forgotten — the map does not grow forever', () => {
    call(service, [pos()]);
    expect(service.lastOutcome.size).toBe(1);

    call(service, []); // the position closed; the guardian no longer sees it
    expect(service.lastOutcome.size).toBe(0);
  });

  it('a recycled ticket is treated as a NEW position, not as a continuation', () => {
    call(service, [pos()]);
    call(service, []);                       // closed — forgotten
    call(service, [pos({ symbol: 'GER40' })]); // same ticket, different instrument

    expect(syslog.info).toHaveBeenCalledTimes(2);
    expect(lines(syslog)[1]).toContain('GER40');
  });

  it('a missing syslog is not an error — the guardian must tick without a log file', () => {
    const bare = build(undefined);
    expect(() => call(bare, [pos()])).not.toThrow();
  });
});
