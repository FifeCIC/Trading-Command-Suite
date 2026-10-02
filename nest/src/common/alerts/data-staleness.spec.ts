/**
 * data-staleness.spec.ts — the staleness rule (#1067).
 *
 * ⚠️ WHAT THESE GUARD. The rule replaced a check that was **structurally incapable of being false**:
 * it counted every historical bar older than the threshold and fired when that count was > 0.
 * Measured: the alert fired on 98.6% of a 1,009,146-row table, and had fired 2,621 times.
 *
 * So the cases that matter are not "does it detect staleness" — they are the ones that keep it
 * from becoming permanently true again:
 *
 *   1. a symbol with NO bars must NOT be reported stale (that is "cannot judge")
 *   2. history must NOT count — 1,000 old bars plus one fresh one is FRESH
 *
 * ⚠️ CANARY: making `stalenessReport` treat `latest: null` as stale fails the `cannot judge` case,
 * and counting the ROWS instead of the newest timestamp fails the history case. Both verified
 * against the real tree.
 */
import { stalenessReport, stalenessMessage, allowedAgeMinutes } from './data-staleness';

const NOW = new Date('2026-10-02T12:00:00Z');
const minsAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

describe('stalenessReport — is our market data stale? (#1067)', () => {
  it('a symbol with a recent bar is NOT stale', () => {
    const r = stalenessReport([{ symbol: 'XAUUSD', latest: minsAgo(1) }], 5, NOW);
    expect(r.stale).toEqual([]);
    expect(r.cannotJudge).toEqual([]);
  });

  it('a symbol whose newest bar is older than the threshold IS stale', () => {
    const r = stalenessReport([{ symbol: 'XAUUSD', latest: minsAgo(37) }], 5, NOW);
    expect(r.stale).toEqual([{ symbol: 'XAUUSD', latestAgeMinutes: 37 }]);
  });

  // ⚠️ CANARY A — "no bars" is CANNOT JUDGE, not stale. Reporting it as stale is how the old alert
  // became permanently true: a freshly-subscribed symbol has no bars yet.
  it('⚠️ CANARY — a symbol with NO bars is "cannot judge", NEVER stale', () => {
    const r = stalenessReport(
      [{ symbol: 'NEWCO', latest: null }, { symbol: 'XAUUSD', latest: minsAgo(1) }],
      5,
      NOW,
    );
    expect(r.stale).toEqual([]);
    expect(r.cannotJudge).toEqual(['NEWCO']);
  });

  // ⚠️ CANARY B — HISTORY MUST NOT COUNT. This is the exact shape of the original defect: a table
  // full of old bars, plus one fresh one, is a HEALTHY feed. Counting rows makes it "stale".
  it('⚠️ CANARY — one fresh bar among a thousand old ones is FRESH, not stale', () => {
    const rows = [
      { symbol: 'XAUUSD', latest: minsAgo(1) },
      ...Array.from({ length: 1000 }, (_, i) => ({ symbol: `OLD${i}`, latest: minsAgo(600) })),
    ];
    // The 1000 OLD symbols are stale (they have active bots in this scenario and genuinely are
    // stale) — but XAUUSD must not be, and the count must not be the whole table.
    const r = stalenessReport(rows, 5, NOW);
    expect(r.stale.map((s) => s.symbol)).not.toContain('XAUUSD');
    expect(r.stale).toHaveLength(1000);
  });

  it('the threshold is EXCLUSIVE — exactly at the limit is not yet stale', () => {
    expect(stalenessReport([{ symbol: 'A', latest: minsAgo(5) }], 5, NOW).stale).toEqual([]);
    expect(stalenessReport([{ symbol: 'A', latest: minsAgo(5.001) }], 5, NOW).stale).toHaveLength(1);
  });

  it('an unparseable date is "cannot judge", not stale', () => {
    const r = stalenessReport([{ symbol: 'A', latest: new Date('nonsense') }], 5, NOW);
    expect(r.stale).toEqual([]);
    expect(r.cannotJudge).toEqual(['A']);
  });

  it('an empty input reports nothing rather than everything', () => {
    expect(stalenessReport([], 5, NOW)).toEqual({ stale: [], cannotJudge: [] });
  });

  // ── THE THRESHOLD IS PER-TIMEFRAME (#1067, second correction) ──
  //
  // ⚠️ MEASURED 2026-10-02: newest-bar age for actively-botted symbols is 7 min for 5m bars,
  // 64 min for 1h, 1422 min for 1d. A flat 5-minute threshold sits BELOW the floor of normal
  // operation for EVERY timeframe in use — so the first correction would have fired permanently
  // again, reproducing the defect it replaced, by a new route.
  describe('⚠️ CANARY — the threshold must scale with the bar interval', () => {
    it('a 5m bar at the MEASURED 7-minute lag is NOT stale', () => {
      const r = stalenessReport([{ symbol: 'XAUUSD', latest: minsAgo(7), intervalMinutes: 5 }], 5, NOW);
      expect(r.stale).toEqual([]);
    });

    it('an hour bar at 64 minutes of lag is NOT stale — the real average', () => {
      const r = stalenessReport([{ symbol: 'XAUUSD', latest: minsAgo(64), intervalMinutes: 60 }], 5, NOW);
      expect(r.stale).toEqual([]);
    });

    it('but a 5m bar at 40 minutes IS stale — well past its own two intervals', () => {
      const r = stalenessReport([{ symbol: 'XAUUSD', latest: minsAgo(40), intervalMinutes: 5 }], 5, NOW);
      expect(r.stale).toEqual([{ symbol: 'XAUUSD', latestAgeMinutes: 40 }]);
    });

    it('allowedAge is the LARGER of the setting and twice the interval', () => {
      // Operator loosens the threshold -> looser alert.
      expect(allowedAgeMinutes({ symbol: 'A', intervalMinutes: 60 }, 300)).toBe(300);
      // Interval dominates -> the operator cannot tighten below the physical floor.
      expect(allowedAgeMinutes({ symbol: 'A', intervalMinutes: 60 }, 5)).toBe(120);
    });

    it('an unknown interval falls back to the configured threshold, not to zero', () => {
      expect(allowedAgeMinutes({ symbol: 'A' }, 5)).toBe(5);
      expect(allowedAgeMinutes({ symbol: 'A', intervalMinutes: NaN }, 5)).toBe(5);
      expect(allowedAgeMinutes({ symbol: 'A', intervalMinutes: 0 }, 5)).toBe(5);
    });
  });
});

describe('stalenessMessage — names the SYMBOLS, not a count of history (#1067)', () => {
  it('names the symbols and the worst age', () => {
    const r = stalenessReport(
      [{ symbol: 'XAUUSD', latest: minsAgo(40) }, { symbol: 'EURUSD', latest: minsAgo(12) }],
      5,
      NOW,
    );
    const m = stalenessMessage(r, 5);
    expect(m).toContain('XAUUSD');
    expect(m).toContain('EURUSD');
    expect(m).toContain('40');
    // ⚠️ The old message's number was a COUNT OF HISTORY — 995489 — which reads as alarming and
    // means nothing. Assert the message does not lead with a raw row count.
    expect(m).not.toMatch(/\b\d{5,} market bar/);
  });

  it('truncates long lists but says how many were hidden', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ symbol: `S${i}`, latest: minsAgo(60) }));
    const m = stalenessMessage(stalenessReport(rows, 5, NOW), 5);
    expect(m).toContain('(+4 more)');
  });
});
