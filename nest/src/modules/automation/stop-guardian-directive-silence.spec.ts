/**
 * stop-guardian-directive-silence.spec.ts — canary for #1075 (cf. #890).
 * ================================================================================================
 * THE DEFECT THIS PINS. The guardian declares FOUR stop directives and derives `stopConfidence`
 * from them against a `>= 55` threshold. A directive can fail to contribute in two ways that look
 * identical in the output but have different causes:
 *
 *   1. NOT REGISTERED  — `resultsMap.get(id)` returns `undefined`. Guarded by #890
 *                        (`INV-GUARDIAN-DIRECTIVE-RESOLVABLE`).
 *   2. REGISTERED BUT PERMANENTLY SILENT — present, active, evaluated, always `neutral`.
 *                        Nothing watched this. `resultsMap.size` read 4 of 4 throughout.
 *
 * Measured 2026-10-06: `atr-trailing-stop` returned `signalClass: 'neutral'` in **133 of 133** live
 * guardian evaluations, so the `>= 55` threshold was being applied to fewer signals than it was
 * calibrated for while every existing count reported healthy.
 *
 * ⚠️ WHAT THIS GUARD IS *NOT*. It is a SYMPTOM guard and deliberately cause-agnostic. It cannot and
 * does not know WHY a directive is silent — `atr-trailing-stop`'s four branches compare
 * `distAboveLong`/`distBelowShort` against 0.03/0.1 as fractions of price while observed values
 * across XAUUSD/EURUSD/US30 are 0.0001–0.0015 (20×–300× too small), but a future silence might be
 * short bars, a stub, or a bug not yet written. Asserting the SYMPTOM is what makes this robust to
 * the cause being different from the one we found.
 *
 * ⚠️ CANARY DIRECTIONS (run before trusting this file — each must make a named test FAIL):
 *   1. Delete the `spoke ? 0 :` reset so the streak only ever increments →
 *      `one speaking evaluation resets the run` FAILS (199+1+199 would reach 399).
 *   2. Remove the `!spoke &&` condition from the `silent.push` branch so speaking directives are
 *      also reported → `a directive that keeps speaking is never reported` FAILS.
 *   3. Remove the `now - this.lastDirectiveSilenceAt >= ...` throttle → `the warning is throttled`
 *      FAILS (it becomes 400 warnings).
 *   4. Lower `DIRECTIVE_SILENCE_STREAK` to 1 → `a directive is not reported for a single quiet
 *      tick` FAILS.
 *   5. Substitute `resultsMap.size`-style presence for contribution (i.e. return `[]` whenever the
 *      id is in the passed array) → `a registered-but-silent directive IS caught` FAILS. This is
 *      the #890 blind spot restated as an executable assertion.
 *   6. Delete the `this.syslog?.warn(...)` line → `ALSO reaches the canonical log` FAILS. This one
 *      was NOT hypothetical: the first draft of this change had exactly that omission, and this
 *      file's own sibling (the owner-resolution warning) had already been measured silent for the
 *      same reason — 341 occurrences in the console log, zero in the canonical one.
 */
import { StopGuardianService } from './stop-guardian.service';

function build(syslog?: any) {
  const service = new StopGuardianService(
    {} as any, // strategyService
    {} as any, // directivesService
    {} as any, // mt5Connection
    {} as any, // adjustmentRecorder
    undefined, // notifications
    syslog,    // syslog — optional; its absence must not throw
  ) as any;
  // The unit under test is the contribution rule, not the tick that calls it (the tick is covered
  // by stop-guardian.service.spec.ts). Private, and deliberately exercised directly.
  service.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return service;
}

const ATF_REASON = 'Price inside ATR trailing-stop channel — no clear trend';

const silent = (id: string, reason = ATF_REASON): [string, any] => [
  id,
  { signalClass: 'neutral', score: 30, reason },
];
const bullish = (id: string): [string, any] => [
  id,
  { signalClass: 'bullish', score: 75, reason: 'Strong uptrend' },
];

/** `n` identical evaluations of the given directive list. */
const run = (service: any, n: number, directives: Array<[string, any]>) => {
  for (let i = 0; i < n; i++) service.trackDirectiveContributions(directives);
};

const warnings = (service: any): string[] =>
  service.logger.warn.mock.calls.map((c: any[]) => String(c[0]));

describe('StopGuardianService — a registered directive that never speaks (#1075)', () => {
  it('a registered-but-silent directive IS caught — the #890 blind spot', () => {
    const service = build();

    run(service, 200, [silent('atr-trailing-stop')]);

    const w = warnings(service);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('GUARDIAN DIRECTIVE SILENT');
    expect(w[0]).toContain('atr-trailing-stop');
    // The directive's OWN reason travels with the warning — without it the reader knows a directive
    // is quiet but not whether that is intended, which is the whole question being asked.
    expect(w[0]).toContain(ATF_REASON);
  });

  it('a directive is not reported for a single quiet tick', () => {
    const service = build();

    run(service, 1, [silent('atr-trailing-stop')]);

    expect(warnings(service)).toHaveLength(0);
  });

  it('reports only once the streak CROSSES the threshold, not at 199', () => {
    const service = build();

    run(service, 199, [silent('atr-trailing-stop')]);
    expect(warnings(service)).toHaveLength(0);

    run(service, 1, [silent('atr-trailing-stop')]);
    expect(warnings(service)).toHaveLength(1);
  });

  it('a directive that keeps speaking is never reported', () => {
    const service = build();

    run(service, 300, [bullish('supertrend')]);

    expect(warnings(service)).toHaveLength(0);
    expect(service.directiveNeutralStreak.get('supertrend')).toBe(0);
  });

  it('one speaking evaluation resets the run', () => {
    const service = build();

    run(service, 199, [silent('atr-trailing-stop')]);
    run(service, 1, [bullish('atr-trailing-stop')]);
    expect(service.directiveNeutralStreak.get('atr-trailing-stop')).toBe(0);

    run(service, 199, [silent('atr-trailing-stop')]);
    expect(warnings(service)).toHaveLength(0);
  });

  it('the warning is throttled — many passes, one line', () => {
    const service = build();

    run(service, 400, [silent('atr-trailing-stop')]);

    expect(warnings(service)).toHaveLength(1);
  });

  it('separates a silent directive from a speaking one in the same pass', () => {
    const service = build();

    run(service, 200, [silent('atr-trailing-stop'), bullish('supertrend')]);

    const w = warnings(service);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('atr-trailing-stop');
    expect(w[0]).not.toContain('supertrend');
  });

  it('treats a missing result the same as a neutral one — both contribute nothing', () => {
    const service = build();

    run(service, 200, [['atr-trailing-stop', undefined] as [string, any]]);

    const w = warnings(service);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('no result');
  });

  /**
   * ⚠️ THE VISIBILITY CANARY — and this file's own defect, caught before it shipped.
   *
   * `logger.warn` writes to STDOUT → `nest/logs/console-*.log`, NOT the structured file the app
   * serves at `/api/system/logs/file`. The guardian ALREADY paid for this: measured 2026-09-29, its
   * owner-resolution warning appeared **341 times** in the console log and **ZERO** times in
   * `tcs-2026-09-29.log` — reporting correctly, invisibly.
   *
   * A silence report nobody can find is the same defect wearing the fix's clothes, so the two-sink
   * write is asserted rather than assumed.
   */
  it('ALSO reaches the canonical log — not just STDOUT', () => {
    const syslog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = build(syslog);

    run(service, 200, [silent('atr-trailing-stop')]);

    expect(syslog.warn).toHaveBeenCalledTimes(1);
    const [source, message, category] = syslog.warn.mock.calls[0];
    expect(source).toBe('StopGuardianService');
    expect(category).toBe('trading');
    expect(message).toContain('GUARDIAN DIRECTIVE SILENT');
    expect(message).toContain('atr-trailing-stop');
  });

  it('an absent syslog is not an error', () => {
    const service = build(undefined);

    expect(() => run(service, 200, [silent('atr-trailing-stop')])).not.toThrow();
  });
});
