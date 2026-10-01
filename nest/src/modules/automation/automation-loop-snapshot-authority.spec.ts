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
});
