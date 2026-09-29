/**
 * log-policy — the two destructive rules, pinned (#1023).
 * ========================================================
 *
 * WHY THESE ARE TESTS. Both rules in `log-policy.ts` destroy something: one drops log LINES, the
 * other deletes log FILES. Neither failure would announce itself — a prune that ate the wrong file
 * and a collapse that hid a one-off error both produce a tidier log and no error at all. That is the
 * signature this repo keeps re-finding ("plausible output, no error"), so each rule is pinned to the
 * exact number it must produce, not to a shape.
 *
 * The four that matter most:
 *
 *   1. **Today's file is refused, not compared.** The window can be 3650d and the clock can be
 *      wrong; the file being appended to is never a candidate. Asserted with a window long enough
 *      that a comparison-based implementation would delete it.
 *   2. **A window below one day is INERT.** `0` must remove nothing. The dangerous alternative
 *      ("everything older than an hour") turns a typo into a deletion spree, and it is the reading a
 *      naive `now - days*86400000` produces.
 *   3. **Age comes from the NAME, not the mtime.** A file restored from backup has a fresh mtime and
 *      an old date. Pruning on mtime keeps a six-month-old file forever — a retention policy that
 *      silently stops retaining.
 *   4. **`count` includes the written occurrence.** The summary line says "suppressed N of count".
 *      If `count` excluded the first, a single occurrence would be described as a storm.
 *
 * Each guard was canaried in both directions when written (see the #1023 closing comment for the
 * observed failures).
 */
import {
  collapseRepeat,
  fileAgeDays,
  logFingerprint,
  parseFingerprint,
  selectPrunable,
  type LogFileInfo,
  type RepeatState,
} from './log-policy';

const DAY = 86_400_000;
/** 2026-09-29T12:00:00Z — the day this was written, so the fixtures read as real dates. */
const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);

const TODAY = 'tcs-2026-09-29.log';

function f(name: string, size = 1000): LogFileInfo {
  return { name, size };
}

describe('selectPrunable — which files a prune may remove', () => {
  it('refuses TODAY\'S FILE even with a window long enough to qualify it', () => {
    // 3650d back from 2026-09-29 reaches 2016 — today's file would qualify by age on any
    // comparison-based implementation. It must still be kept, and kept with the reason stated.
    const { remove, keep } = selectPrunable([f(TODAY)], TODAY, 3650, NOW);
    expect(remove).toEqual([]);
    expect(keep).toEqual([{ name: TODAY, reason: 'the file being written now' }]);
  });

  it('is INERT below one day — 0 removes nothing rather than everything', () => {
    const files = [f('tcs-2026-09-01.log'), f('tcs-2025-01-01.log')];
    for (const days of [0, 0.5, -7, NaN, Infinity]) {
      const { remove, bytesRemoved } = selectPrunable(files, TODAY, days, NOW);
      expect(remove).toEqual([]);
      expect(bytesRemoved).toBe(0);
    }
  });

  it('removes only what is OUTSIDE the window, and counts the bytes', () => {
    const files = [f('tcs-2026-09-29.log', 10), f('tcs-2026-09-20.log', 100), f('tcs-2026-08-01.log', 1000)];
    const { remove, bytesRemoved } = selectPrunable(files, TODAY, 30, NOW);
    // 09-29 is today (refused), 09-20 is 9d (inside 30d), 08-01 is 59d (outside).
    expect(remove.map((r) => r.name)).toEqual(['tcs-2026-08-01.log']);
    expect(bytesRemoved).toBe(1000);
  });

  it('keeps a file at EXACTLY the window boundary — the comparison is exclusive', () => {
    // 2026-08-30 is exactly 30 days before 2026-09-29. `age > days` keeps it; `age >= days` deletes
    // it. This is a real decision, so it is named here rather than left to whoever reads the operator.
    const { remove, keep } = selectPrunable([f('tcs-2026-08-30.log')], TODAY, 30, NOW);
    expect(remove).toEqual([]);
    expect(keep[0].reason).toContain('inside the 30d window');
  });

  it('never auto-prunes a file whose name carries no date', () => {
    // `console-build-api.log`, `api-out.log` and friends live in the same directory. They are not
    // ours to delete, and their name gives no age to judge.
    const files = [f('api-out.log'), f('console-tcs-launch.log'), f('tcs-2026-08-01.log')];
    const { remove, keep } = selectPrunable(files, TODAY, 30, NOW);
    expect(remove.map((r) => r.name)).toEqual(['tcs-2026-08-01.log']);
    expect(keep.filter((k) => k.name === 'api-out.log')[0].reason).toContain('never auto-pruned');
  });

  it('orders removals newest-first and all removals are counted in bytesRemoved', () => {
    const files = [f('tcs-2026-08-01.log', 100), f('tcs-2026-08-20.log', 200), f('tcs-2026-07-01.log', 300)];
    const { remove, bytesRemoved } = selectPrunable(files, TODAY, 30, NOW);
    expect(remove.map((r) => r.name)).toEqual(['tcs-2026-08-20.log', 'tcs-2026-08-01.log', 'tcs-2026-07-01.log']);
    expect(bytesRemoved).toBe(600);
  });
});

describe('fileAgeDays — a name, not an mtime', () => {
  it('reads the date out of the filename', () => {
    expect(fileAgeDays('tcs-2026-09-29.log', NOW)).toBe(0);
    expect(fileAgeDays('tcs-2026-09-28.log', NOW)).toBe(1);
    expect(fileAgeDays('tcs-2026-08-30.log', NOW)).toBe(30);
  });

  it('returns null for anything that is not a dated tcs-<YYYY-MM-DD>.log', () => {
    // ⚠️ null, never 0 and never Infinity — both of those would be ACTED on: 0 keeps forever by
    // accident, Infinity deletes by accident. null means "no opinion", which the caller honours.
    for (const name of ['api-out.log', 'tcs-2026-09.log', 'tcs-2026-09-29.log.gz', 'TCS-2026-09-29.log', 'tcs-2026-13-01.log', 'tcs-2026-00-10.log', 'tcs-2026-09-32.log']) {
      expect(fileAgeDays(name, NOW)).toBeNull();
    }
  });
});

describe('collapseRepeat — a window that bounds volume without hiding the repetition', () => {
  const WINDOW = 5 * 60_000;
  const fp = logFingerprint('error', 'MT5Adapter', 'GET /symbols FAILED');

  it('writes the FIRST occurrence and suppresses the rest inside the window', () => {
    const first = collapseRepeat(fp, undefined, NOW, WINDOW, true);
    expect(first.emit).toBe(true);
    expect(first.summariseSuppressed).toBe(0);
    expect(first.next.count).toBe(1);

    const second = collapseRepeat(fp, first.next, NOW + 1000, WINDOW, true);
    expect(second.emit).toBe(false);
    expect(second.next.count).toBe(2);
    // Inside the window nothing is reported yet — the count is still open.
    expect(second.summariseSuppressed).toBe(0);
  });

  it('counts the WRITTEN occurrence in the total, and reports it when the window closes', () => {
    // 4,801 occurrences: the first is written, 4,800 are suppressed. A `count` that excluded the
    // first would report "4,800" for a storm of 4,800 — and "1" for a message seen once.
    let state: RepeatState | undefined = collapseRepeat(fp, undefined, NOW, WINDOW, true).next;
    for (let i = 1; i < 4801; i += 1) {
      state = collapseRepeat(fp, state, NOW + (i % 60) * 1000, WINDOW, true).next;
    }
    expect(state!.count).toBe(4801);

    // The next occurrence lands after the window has expired.
    const after = collapseRepeat(fp, state, NOW + WINDOW + 1, WINDOW, true);
    expect(after.emit).toBe(true);
    expect(after.summariseSuppressed).toBe(4800);
    expect(after.next.count).toBe(1);
  });

  it('a recurring-but-not-continuous fault is REPORTED again, not swallowed', () => {
    // Once an hour for a week is a real signal. A "seen this before?" implementation would emit one
    // line and silence the other six — which is how a log stops being evidence.
    let state: RepeatState | undefined;
    const emitted: number[] = [];
    for (let hour = 0; hour < 7; hour += 1) {
      const t = NOW + hour * 60 * 60_000;
      const d = collapseRepeat(fp, state, t, WINDOW, true);
      if (d.emit) emitted.push(hour);
      state = d.next;
    }
    expect(emitted).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('is a no-op when DISABLED — every occurrence is written', () => {
    let state: RepeatState | undefined;
    let written = 0;
    for (let i = 0; i < 50; i += 1) {
      const d = collapseRepeat(fp, state, NOW + i, WINDOW, false);
      if (d.emit) written += 1;
      expect(d.summariseSuppressed).toBe(0);
      state = d.next;
    }
    expect(written).toBe(50);
  });

  it('is a no-op for a nonsensical window rather than suppressing everything', () => {
    let state: RepeatState | undefined;
    let written = 0;
    for (const bad of [0, -1, NaN]) {
      for (let i = 0; i < 5; i += 1) {
        const d = collapseRepeat(fp, state, NOW + i, bad, true);
        if (d.emit) written += 1;
        state = d.next;
      }
    }
    expect(written).toBe(15);
  });

  it('treats the window boundary as CLOSED — a new window opens at exactly windowMs', () => {
    const first = collapseRepeat(fp, undefined, NOW, WINDOW, true);
    const atBoundary = collapseRepeat(fp, first.next, NOW + WINDOW, WINDOW, true);
    expect(atBoundary.emit).toBe(true);
    const justInside = collapseRepeat(fp, first.next, NOW + WINDOW - 1, WINDOW, true);
    expect(justInside.emit).toBe(false);
  });
});

describe('logFingerprint — the identity collapsed on', () => {
  it('separates the same text from two sources, and two levels', () => {
    // The same sentence from the adapter and from the service is two facts. Collapsing them hides one.
    expect(logFingerprint('error', 'MT5Adapter', 'x')).not.toBe(logFingerprint('error', 'ScoringService', 'x'));
    expect(logFingerprint('error', 'MT5Adapter', 'x')).not.toBe(logFingerprint('warn', 'MT5Adapter', 'x'));
  });

  it('is stable for two occurrences that differ only by timestamp', () => {
    // The whole point: the identity must not include the thing that differs between storm lines.
    expect(logFingerprint('error', 'MT5Adapter', 'GET /symbols FAILED'))
      .toBe(logFingerprint('error', 'MT5Adapter', 'GET /symbols FAILED'));
  });

  it('does not let a crafted source+message collide by shifting the separator', () => {
    // ⚠️ THIS ASSERTION WAS WRONG WHEN FIRST WRITTEN, AND THE TEST CAUGHT IT. The original
    // fingerprint was NUL-separated and the comment claimed collisions were impossible — but
    // ('a', 'b\u0000c') and ('a\u0000b', 'c') produce the same string. A separator only
    // disambiguates if it cannot occur in the fields, and nothing enforced that. The encoding is now
    // JSON, which needs no such assumption.
    expect(logFingerprint('error', 'a', 'b\u0000c')).not.toBe(logFingerprint('error', 'a\u0000b', 'c'));
    // And the inverse recovers the three fields it encoded, including a NUL inside one.
    expect(parseFingerprint(logFingerprint('error', 'a', 'b\u0000c'))).toEqual(['error', 'a', 'b\u0000c']);
  });

  it('parseFingerprint returns null rather than throwing on a key it did not make', () => {
    // It runs inside the summary interval. A malformed key must not kill the flush that reports
    // every other pending storm.
    for (const bad of ['', 'nonsense', '[]', '["a"]', '["a","b","c","d"]', '{']) {
      expect(parseFingerprint(bad)).toBeNull();
    }
  });
});
