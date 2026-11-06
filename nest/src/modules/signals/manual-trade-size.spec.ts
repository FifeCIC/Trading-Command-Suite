/**
 * resolveTradeSize — the per-instrument size rule for manual trades (#835).
 *
 * ⚠️ THE DEFECT THIS PINS. One global `signals.manualTrade.size` was used for every instrument while
 * the broker's `volumeMin` is per BROKER × INSTRUMENT. Measured 2026-09-15 on both bridges: every
 * index reports `volumeMin 0.1`, FX/metals report `0.01`. So one number was wrong either way:
 *
 *   · at 0.01 — every index manual trade was IMPOSSIBLE (`size-below-minimum`);
 *   · at 0.1  — every FX manual trade was 10× the intended risk.
 *
 * The rule is `max(requested, floor)` per instrument, which makes both statements false at once:
 * FX keeps 0.01 because ITS floor is 0.01, and an index rises to 0.1 because that is the smallest
 * tradeable size — not because a global multiplier was applied.
 *
 * ⚠️ CANARY IT BOTH WAYS. Two directions, and the second is the dangerous one:
 *   1. a size below a known floor must rise to the floor and report `raised: true`;
 *   2. an UNKNOWN floor must pass the request through UNCHANGED. Enlarging an order because the
 *      broker did not answer is a risk change made on missing information. If a future edit makes
 *      `null` behave like `0`, case 2 fails — and the failure is silent in production.
 *   3. a size AT or ABOVE the floor must never be moved, in either direction.
 */
import { resolveTradeSize, DEFAULT_MANUAL_TRADE } from './manual-trade-defaults.service';

describe('resolveTradeSize — one size per instrument, floored by the broker (#835)', () => {
  it('raises a size below a KNOWN floor to the floor, and says so', () => {
    const r = resolveTradeSize(0.01, 0.1);
    expect(r.placed).toBe(0.1);
    expect(r.requested).toBe(0.01);
    expect(r.floor).toBe(0.1);
    expect(r.raised).toBe(true);
  });

  it('leaves a size that already meets the floor alone — FX at 0.01 against a 0.01 floor', () => {
    const r = resolveTradeSize(0.01, 0.01);
    expect(r.placed).toBe(0.01);
    expect(r.raised).toBe(false);
    expect(r.floor).toBe(0.01);
  });

  it('never LOWERS a size because the floor is smaller — an index at 0.5 against a 0.1 floor', () => {
    const r = resolveTradeSize(0.5, 0.1);
    expect(r.placed).toBe(0.5);
    expect(r.raised).toBe(false);
  });

  it('PASSES THROUGH UNCHANGED when the floor is unknown — "cannot ask" is not "too small"', () => {
    for (const unknown of [null, undefined, 0, Number.NaN, -1]) {
      const r = resolveTradeSize(0.01, unknown as any);
      expect(r.placed).toBe(0.01);
      expect(r.raised).toBe(false);
      expect(r.floor).toBeNull();
    }
  });

  it('reports where the request came from, so "why is this 0.01?" is answerable', () => {
    expect(resolveTradeSize(0.01, 0.1, 'caller').source).toBe('caller');
    expect(resolveTradeSize(0.01, 0.1, 'setting').source).toBe('setting');
    expect(resolveTradeSize(0.01, 0.1, 'fallback').source).toBe('fallback');
  });

  it('the shipped default is unplaceable on an index and placeable on FX — the whole point', () => {
    // This asserts the SHIPPED constant against the two real floors, so a future change to either
    // is a visible test failure rather than a discovery at click time.
    const index = resolveTradeSize(DEFAULT_MANUAL_TRADE.size, 0.1);
    const fx = resolveTradeSize(DEFAULT_MANUAL_TRADE.size, 0.01);
    expect(index).toMatchObject({ requested: 0.01, placed: 0.1, raised: true });
    expect(fx).toMatchObject({ requested: 0.01, placed: 0.01, raised: false });
    // …and crucially the FX leg is NOT scaled up to the index floor. That was the 10× regression.
    expect(fx.placed).toBe(DEFAULT_MANUAL_TRADE.size);
  });
});
