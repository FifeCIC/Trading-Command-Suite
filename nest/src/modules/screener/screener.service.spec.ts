import {
  screenerRecency,
  screenerRawWeight,
  normalizeAttentionWeights,
} from './screener.service';

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe('ScreenerService — attention decay modes (#647 / epic #682 Phase 4.1)', () => {
  const now = Date.UTC(2026, 7, 26, 12, 0, 0); // fixed now

  describe('screenerRecency — future earnings: proximity 1/(1+daysAway)', () => {
    it('ranks a same-day event at maximum recency (1)', () => {
      expect(screenerRecency(now, now)).toBeCloseTo(1, 10);
    });

    it('decays with distance — 7 days out is 1/8', () => {
      expect(screenerRecency(now, now + 7 * DAY)).toBeCloseTo(1 / 8, 10);
    });

    it('is monotonically decreasing as the event moves away', () => {
      const r1 = screenerRecency(now, now + 1 * DAY);
      const r2 = screenerRecency(now, now + 2 * DAY);
      const r3 = screenerRecency(now, now + 30 * DAY);
      expect(r1).toBeGreaterThan(r2);
      expect(r2).toBeGreaterThan(r3);
    });

    it('clamps past-dated "future" events to today (no boost beyond 1)', () => {
      expect(screenerRecency(now, now - 5 * DAY)).toBeCloseTo(1, 10);
    });
  });

  describe('screenerRecency — past news: half-life 24h (0.5^(hours/24))', () => {
    it('is 1 when just published', () => {
      expect(screenerRecency(now, null, now)).toBeCloseTo(1, 10);
    });

    it('halves every 24 hours', () => {
      expect(screenerRecency(now, null, now - 24 * HOUR)).toBeCloseTo(0.5, 10);
      expect(screenerRecency(now, null, now - 48 * HOUR)).toBeCloseTo(0.25, 10);
    });

    it('defaults to full recency when no timestamp is present', () => {
      expect(screenerRecency(now, null, null)).toBeCloseTo(1, 10);
    });
  });

  describe('screenerRecency — mode precedence', () => {
    it('a future event beats past history when both exist', () => {
      const r = screenerRecency(now, now + 3 * DAY, now - 1 * HOUR);
      expect(r).toBeCloseTo(1 / 4, 10); // proximity, not half-life
    });
  });

  describe('screenerRawWeight — strength × reliability × recency', () => {
    it('full strength, full reliability, full recency → 100', () => {
      expect(screenerRawWeight(100, 100, 1)).toBeCloseTo(100, 10);
    });

    it('halved strength halves the weight', () => {
      expect(screenerRawWeight(50, 100, 1)).toBeCloseTo(50, 10);
    });

    it('halved reliability halves the weight', () => {
      expect(screenerRawWeight(100, 50, 1)).toBeCloseTo(50, 10);
    });

    it('recency scales linearly', () => {
      expect(screenerRawWeight(100, 100, 0.5)).toBeCloseTo(50, 10);
    });
  });

  describe('normalizeAttentionWeights — relative 0–100 vs the strongest', () => {
    it('strongest catalyst → 100, weaker scales proportionally', () => {
      const rows = [{ rawAttentionWeight: 80 }, { rawAttentionWeight: 40 }];
      normalizeAttentionWeights(rows);
      expect(rows[0].attentionWeight).toBe(100);
      expect(rows[1].attentionWeight).toBe(50);
    });

    it('all-zero board stays zero (no NaN)', () => {
      const rows = [{ rawAttentionWeight: 0 }, { rawAttentionWeight: 0 }];
      normalizeAttentionWeights(rows);
      expect(rows[0].attentionWeight).toBe(0);
      expect(rows[1].attentionWeight).toBe(0);
    });

    it('preserves relative ordering', () => {
      const rows = [{ rawAttentionWeight: 10 }, { rawAttentionWeight: 90 }, { rawAttentionWeight: 30 }];
      normalizeAttentionWeights(rows);
      const sorted = [...rows].sort((a, b) => (b.attentionWeight ?? 0) - (a.attentionWeight ?? 0));
      expect(sorted.map((r) => r.rawAttentionWeight)).toEqual([90, 30, 10]);
    });
  });
});
