import { authoritativeFromSnapshot } from './automation-loop.service';

/**
 * #1058 — a PARTIAL snapshot must never be authoritative.
 *
 * WHY THIS SUITE EXISTS
 *
 * The call site read `snapshot.authoritative || positions.length > 0`. `authoritative` means "every
 * source answered" — `fetchAllBrokerPositions()` computes it that way, flipping it `false` the
 * moment any bridge fails — so the `||` OVERRODE a correct answer with a guess made from the size
 * of a list that was short *because a source was missing*.
 *
 * MEASURED 2026-10-01 17:39:09.091Z, `nest/logs/tcs-2026-10-01.log`:
 *
 *     WARN [MT5Adapter] bridge[2] GET /positions FAILED: network: fetch failed
 *
 * Nine trades were closed in the following 11 seconds — the entire broker-2 book — each with
 * `closeReason='broker:unknown'`, `exitPrice NULL`, `pnlInvalid=1`. Bridge 3 held ONE position
 * (US500), and that single non-empty row is what made the incomplete snapshot "authoritative".
 * Three of the nine were still open at the broker 1.5 hours later.
 *
 * ⚠️ WHAT THIS SUITE CAN AND CANNOT COVER (stated, per the honest-partial rule)
 *
 * It covers the DECISION — that size is not evidence of completeness. It cannot exercise the whole
 * `tick()` method, whose constructor takes ~28 injected services; the defect is therefore pinned
 * by making the decision a value with no position list in its signature, which is the same
 * technique `stopAdjustmentReason()` (#1034) and `TickDecisionScore` (#937) use here.
 *
 * It does NOT cover the wiring: that the loop passes the result to `syncPositions`. That is a
 * one-line call site, reviewed rather than executed.
 */

describe('authoritativeFromSnapshot — a partial snapshot is never authoritative (#1058)', () => {
  it('a COMPLETE snapshot is authoritative', () => {
    expect(authoritativeFromSnapshot({ authoritative: true })).toBe(true);
  });

  it('⚠️ a snapshot that reports itself INCOMPLETE is NOT authoritative', () => {
    // The canary. This is the exact value the bridge failure produced at 17:39.
    expect(authoritativeFromSnapshot({ authoritative: false })).toBe(false);
  });

  it('⚠️ NON-EMPTINESS CANNOT MAKE IT AUTHORITATIVE — the function has no list to consult', () => {
    // ⚠️ THE CANARY THAT MATTERS MOST. The old expression was
    //     `snapshot.authoritative || positions.length > 0`
    // so ANY non-empty list flipped a `false` to `true`. Here the same partial snapshot is offered
    // alongside a sprawling position list — and the list cannot be passed, because the signature
    // does not accept one. If someone restores the `||`, this suite does not merely fail: the
    // FUNCTION CANNOT EXPRESS IT, which is the difference between a rule and an enforced rule.
    const partial = { authoritative: false };
    const smuggled = { ...partial, length: 9, positions: new Array(9).fill({}) } as any;

    expect(authoritativeFromSnapshot(partial)).toBe(false);
    expect(authoritativeFromSnapshot(smuggled)).toBe(false);
  });

  it('treats a missing/undefined flag as NOT authoritative (fail closed)', () => {
    // A shape that forgot the field must not be read as permission to liquidate a book. Missing a
    // close is recoverable; inventing one is not.
    expect(authoritativeFromSnapshot({} as any)).toBe(false);
    expect(authoritativeFromSnapshot({ authoritative: undefined } as any)).toBe(false);
    expect(authoritativeFromSnapshot({ authoritative: null } as any)).toBe(false);
  });

  it('does not coerce a truthy non-boolean into authority', () => {
    expect(authoritativeFromSnapshot({ authoritative: 1 } as any)).toBe(false);
    expect(authoritativeFromSnapshot({ authoritative: 'true' } as any)).toBe(false);
  });

  /**
   * ⚠️ THE CALL-SITE GUARD — and it is a SOURCE check on purpose.
   *
   * The signature above stops the function EXPRESSING the defect, but it cannot stop a future edit
   * re-adding the `||` at the CALL SITE:
   *     authoritativeFromSnapshot(snapshot) || positions.length > 0
   * …which is exactly the shape that closed nine live trades. #1058's acceptance asks for a
   * regression test that FAILS if `authoritative` is ever computed that way again, so this reads
   * the real source rather than trusting the shape of the helper.
   *
   * ⚠️ DELIBERATELY NARROW: one file, the assignment to `authoritative` only. A broad "no .length
   * near positions" rule would fire on `positions.length` used for the count log and would be
   * allowlisted within a week — and an allowlisted guard is worse than none.
   */
  it('⚠️ THE SOURCE does not compute `authoritative` from the SIZE of anything', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, 'automation-loop.service.ts'),
      'utf8',
    ) as string;

    const assignments = src
      .split(/\r?\n/)
      .filter((l: string) => /const\s+authoritative\s*=/.test(l));

    // The assignment must exist — if it were renamed away, this test would silently pass on an
    // empty list, which is the "a check that inspects nothing reports OK" defect.
    expect(assignments.length).toBeGreaterThan(0);

    for (const line of assignments) {
      expect(line).not.toMatch(/\.length/);
      expect(line).not.toMatch(/\|\|/);
      expect(line).toContain('authoritativeFromSnapshot(');
    }
  });
});
