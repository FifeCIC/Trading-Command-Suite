/**
 * alert-score-window.spec.ts — the silent-symbol alert must state the basis it actually has.
 *
 * ⚠️ THE DEFECT THIS GUARDS (#1245 follow-up, measured 2026-11-18). `checkSymbolSilent` counts scores
 * with a `24 HOUR` predicate, but `score` is throttled to 100 rows per (symbol, protocol) — about
 * **4.2–4.4 hours** for an actively-scored pair. So the count was a four-hour count and the message
 * called it a day. **26 symbols were firing with that wording**, and `decision_log` on the same day
 * held 41 days, so the two halves of the comparison were never on the same basis either.
 *
 * ⚠️ 0 IS THE SENTINEL, AND THAT IS THE CASE THAT MATTERS. "Cannot establish the window" must not
 * render as "within the last 0h" — it must drop out of the message entirely. A helper that returned
 * a number here would make the alert confidently wrong in a new way.
 */
import { scoreWindowHoursBetween } from './alert-trigger.service';

describe('scoreWindowHoursBetween — the span a score count really covered', () => {
  it('reports the measured case: 4.4 hours, not the 24 the SQL asked for', () => {
    expect(
      scoreWindowHoursBetween(new Date('2026-11-18T16:00:00Z'), new Date('2026-11-18T20:24:00Z')),
    ).toBe(4.4);
  });

  it('rounds to one decimal — an unrounded span reads as 4.399999 in a message', () => {
    expect(
      scoreWindowHoursBetween(new Date('2026-11-18T16:00:00Z'), new Date('2026-11-18T16:00:01.234Z')),
    ).toBe(0);
  });

  it('⚠️ no rows is 0, not a guess', () => {
    expect(scoreWindowHoursBetween(null, null)).toBe(0);
    expect(scoreWindowHoursBetween(null, new Date('2026-11-18T20:00:00Z'))).toBe(0);
    expect(scoreWindowHoursBetween(new Date('2026-11-18T20:00:00Z'), null)).toBe(0);
  });

  it('⚠️ a single row has no span — 0, so the message drops the window rather than saying "0h"', () => {
    const t = new Date('2026-11-18T20:00:00Z');
    expect(scoreWindowHoursBetween(t, t)).toBe(0);
  });

  it('⚠️ a reversed pair is 0, never a negative window', () => {
    expect(
      scoreWindowHoursBetween(new Date('2026-11-18T20:00:00Z'), new Date('2026-11-18T16:00:00Z')),
    ).toBe(0);
  });

  it('unparseable dates are 0 — cannot judge, not a silent pass', () => {
    expect(scoreWindowHoursBetween(new Date('nonsense'), new Date('2026-11-18T20:00:00Z'))).toBe(0);
  });

  it('a genuinely complete day reports ~24, so the flag cannot hide a real full window', () => {
    expect(
      scoreWindowHoursBetween(new Date('2026-11-17T20:00:00Z'), new Date('2026-11-18T19:55:00Z')),
    ).toBe(23.9);
  });
});
