import { positionCapBreach } from './risk.controller';

/**
 * #852 — the position-cap trigger for the risk circuit breaker.
 *
 * ⚠️ THE DEFECT THESE TESTS PIN. The trigger compared a position COUNT against `80` under the
 * label "Exposure > 80%", while the enforced cap is `5`. It therefore required 16× the cap to
 * fire — the breaker rendered `state: 'READY'` and always would, which is the "plausible numbers,
 * no error" signature: a guard that inspects a real value against the wrong scale and never
 * fails loudly. The count is now compared to the cap it belongs to, and these tests DEMONSTRATE
 * the trigger firing (a canary), rather than asserting the comparison exists.
 *
 * BOUNDARY (the settled decision, stated here so nobody has to read the operator): EXCLUSIVE.
 * At exactly the cap the book is FULL — the normal steady state, since the cap gate refuses new
 * entries there. Firing at-cap would leave the breaker TRIPPED through normal operation, which is
 * the alarm-fatigue defect class from #950 (a permanently-tripped drawdown breaker).
 */
describe('positionCapBreach (#852)', () => {
  it('does NOT fire while the book is at or below the cap — at-cap is the normal full-book state', () => {
    expect(positionCapBreach(0, 5)).toBeNull();
    expect(positionCapBreach(4, 5)).toBeNull();
    expect(positionCapBreach(5, 5)).toBeNull(); // ⭐ the boundary, asserted explicitly
  });

  it('⭐ CANARY — FIRES the moment the cap is breached, with both numbers in the message', () => {
    const msg = positionCapBreach(6, 5);
    expect(msg).not.toBeNull();
    expect(msg).toContain('6 positions');
    expect(msg).toContain('risk.maxOpenPositions (5)');
  });

  it('scales with the configured cap — not a hardcoded 80', () => {
    // With the cap at 20 (a legitimate configuration), 6 positions is NOT a breach...
    expect(positionCapBreach(6, 20)).toBeNull();
    // ...and 21 is.
    expect(positionCapBreach(21, 20)).toContain('risk.maxOpenPositions (20)');
  });

  it('cannot judge ≠ breached: an unreadable count never fires and never reads as a clean zero', () => {
    expect(positionCapBreach(null, 5)).toBeNull();
    expect(positionCapBreach(undefined, 5)).toBeNull();
    expect(positionCapBreach(Number('nope'), 5)).toBeNull(); // NaN from a failed parse
  });

  it('the message states the unit — "positions", never a bare percentage', () => {
    const msg = positionCapBreach(26, 5);
    expect(msg).toMatch(/positions/);
    expect(msg).not.toMatch(/%/);
  });
});
