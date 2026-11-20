/**
 * session-change.spec.ts — the denominator rule for "% change today" inside a backtest run.
 *
 * ⚠️ THE CASES ARE THE TWO WAYS THIS NUMBER GOES WRONG IN A REAL RESULT:
 *   1. measured against the previous BAR, so a +430% day reads as a string of small moves;
 *   2. reported as 0% for the first session, so an unmeasurable bar looks flat.
 */
import { createSessionChangeTracker } from './session-change';

describe('createSessionChangeTracker', () => {
  it('reports null for the first session — there is no earlier close to measure from', () => {
    const change = createSessionChangeTracker();
    expect(change('2026-11-03T14:35:00Z', 10)).toBeNull();
    expect(change('2026-11-03T20:55:00Z', 11)).toBeNull();
  });

  it('measures the next session against the PREVIOUS SESSION CLOSE, not the previous bar', () => {
    const change = createSessionChangeTracker();
    change('2026-11-03T20:55:00Z', 10); // last close of 11-03
    // 11-04 opens gap-up at 12 and runs to 15: the change must stay anchored to 10.
    expect(change('2026-11-04T14:30:00Z', 12)).toBeCloseTo(20, 6);
    expect(change('2026-11-04T15:00:00Z', 15)).toBeCloseTo(50, 6);
  });

  it('▶ CANARY — a per-bar change would report a different number for the same bar', () => {
    const tracker = createSessionChangeTracker();
    tracker('2026-11-03T20:55:00Z', 10);
    tracker('2026-11-04T14:30:00Z', 12);
    const sessionPct = tracker('2026-11-04T15:00:00Z', 15);
    const perBarPct = (15 / 12 - 1) * 100; // what a previous-BAR denominator would produce
    expect(sessionPct).toBeCloseTo(50, 6);
    expect(perBarPct).toBeCloseTo(25, 6);
    expect(sessionPct).not.toBeCloseTo(perBarPct, 3);
  });

  it('keeps the whole of the answer day anchored to the prior session, including the last bar', () => {
    const change = createSessionChangeTracker();
    change('2026-11-10T20:55:00Z', 2);
    expect(change('2026-11-11T14:30:00Z', 2.2)).toBeCloseTo(10, 6);
    expect(change('2026-11-11T20:55:00Z', 10.6)).toBeCloseTo(430, 6); // the +430% day
    // 11-12 re-anchors on 11-11's CLOSE, not on its own first bar.
    expect(change('2026-11-12T14:30:00Z', 10.6)).toBeCloseTo(0, 6);
  });

  it('refuses to divide by an unusable previous close rather than inventing a number', () => {
    const change = createSessionChangeTracker();
    change('2026-11-03T20:55:00Z', 0); // a zero close cannot be a denominator
    expect(change('2026-11-04T14:30:00Z', 5)).toBeNull();
  });
});
