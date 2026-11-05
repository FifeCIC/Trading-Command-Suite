import {
  PROGRESSION_LEVELS,
  XP_SOURCES,
  botCapForXp,
  countedValue,
  levelForXp,
  summarise,
  totalXp,
  wouldExceedBotCap,
  xpBreakdown,
  xpForSource,
} from './progression-levels';

/**
 * The progression model (#1193) — canaried in BOTH directions.
 *
 * ⚠️ WHY EVERY BOUNDARY IS TESTED FROM BOTH SIDES. An off-by-one in `levelForXp` grants a bot one
 * level early or withholds it one level late, and **nothing errors**. The symptom would be an
 * operator who cannot activate a bot they should be allowed, or one who can when they should not —
 * both of which read as "the cap is broken", not as "the table is wrong". A one-directional test
 * cannot tell a working threshold from a threshold that never runs.
 *
 * ⚠️ AND A THIRD DIRECTION: the grandfathering rule. `wouldExceedBotCap` is the gate's only
 * arithmetic, and the case that matters most is an install ALREADY over its cap — that must still
 * refuse an increase while never refusing an edit or a deactivation.
 */
describe('progression-levels — the earned-level model (#1193)', () => {
  describe('levelForXp — inclusive at the threshold, both sides', () => {
    it.each(PROGRESSION_LEVELS.map((l) => [l.level, l.xpRequired]))(
      'level %i is reached at exactly %i XP',
      (level, xpRequired) => {
        expect(levelForXp(xpRequired).level).toBe(level);
      },
    );

    it.each(PROGRESSION_LEVELS.slice(1).map((l) => [l.level, l.xpRequired]))(
      'level %i is NOT reached one XP below %i',
      (level, xpRequired) => {
        expect(levelForXp(xpRequired - 1).level).toBe(level - 1);
      },
    );

    it('0 XP is level 1 — a fresh install is never level 0', () => {
      expect(levelForXp(0).level).toBe(1);
    });

    it('unusable input is level 1, not a throw and not level 0', () => {
      expect(levelForXp(Number.NaN).level).toBe(1);
      expect(levelForXp(-500).level).toBe(1);
    });

    it('XP above the top threshold stays at the top level', () => {
      expect(levelForXp(999_999).level).toBe(PROGRESSION_LEVELS.length);
    });
  });

  describe('XP sources — the cap is visible, never silent', () => {
    it('scores below the cap exactly', () => {
      expect(xpForSource('closedTrades', 10)).toBe(
        10 * XP_SOURCES.closedTrades.weight,
      );
    });

    it('stops scoring at the cap', () => {
      const cap = XP_SOURCES.closedTrades.cap;
      expect(xpForSource('closedTrades', cap)).toBe(
        cap * XP_SOURCES.closedTrades.weight,
      );
      expect(xpForSource('closedTrades', cap + 1000)).toBe(
        cap * XP_SOURCES.closedTrades.weight,
      );
    });

    it('reports BOTH the raw and the counted number when the cap bites', () => {
      const row = xpBreakdown({ closedTrades: 900 }).find(
        (r) => r.key === 'closedTrades',
      );
      expect(row.raw).toBe(900);
      expect(row.counted).toBe(XP_SOURCES.closedTrades.cap);
      expect(row.capped).toBe(true);
    });

    it('does not claim a cap when one did not bite', () => {
      const row = xpBreakdown({ closedTrades: 5 }).find(
        (r) => r.key === 'closedTrades',
      );
      expect(row.capped).toBe(false);
      expect(row.counted).toBe(row.raw);
    });

    it('an unusable count scores zero rather than a guess', () => {
      expect(countedValue('backtestRuns', Number.NaN)).toBe(0);
      expect(countedValue('backtestRuns', -3)).toBe(0);
      expect(countedValue('backtestRuns', undefined as unknown as number)).toBe(
        0,
      );
    });

    it('a single axis cannot reach the top level on its own', () => {
      const top = PROGRESSION_LEVELS[PROGRESSION_LEVELS.length - 1];
      for (const key of Object.keys(
        XP_SOURCES,
      ) as (keyof typeof XP_SOURCES)[]) {
        expect(xpForSource(key, 1_000_000)).toBeLessThan(top.xpRequired);
      }
    });
  });

  describe('botCapForXp — the ceiling the gate reads', () => {
    it('a fresh install may run exactly one bot', () => {
      expect(botCapForXp(0)).toBe(1);
    });

    it('the top level is uncapped', () => {
      const top = PROGRESSION_LEVELS[PROGRESSION_LEVELS.length - 1];
      expect(botCapForXp(top.xpRequired)).toBeNull();
    });

    it('caps never decrease as XP rises', () => {
      const caps = PROGRESSION_LEVELS.map(
        (l) => l.activeBotCap ?? Number.POSITIVE_INFINITY,
      );
      for (let i = 1; i < caps.length; i += 1) {
        expect(caps[i]).toBeGreaterThanOrEqual(caps[i - 1]);
      }
    });
  });

  describe('wouldExceedBotCap — refuse the increase, never the way out', () => {
    it('refuses the bot that would cross the cap', () => {
      expect(wouldExceedBotCap(1, 1)).toBe(true);
    });

    it('allows the bot that lands exactly on the cap', () => {
      expect(wouldExceedBotCap(1, 2)).toBe(false);
    });

    it('an uncapped level never refuses', () => {
      expect(wouldExceedBotCap(500, null)).toBe(false);
    });

    it('⚠️ an install ALREADY over its cap still refuses an increase (grandfathering is not amnesty)', () => {
      expect(wouldExceedBotCap(7, 3)).toBe(true);
    });

    it('an unusable active count is treated as 0 and allows — a cap is a guardrail, not a lock', () => {
      expect(wouldExceedBotCap(Number.NaN, 1)).toBe(false);
    });
  });

  describe('summarise — what the panel renders', () => {
    it('reports the XP still needed to reach the next level', () => {
      const counts = { closedTrades: 20, backtestRuns: 0, daysActive: 0 }; // 40 XP
      const s = summarise(counts);
      expect(s.level.level).toBe(1);
      expect(s.xp).toBe(40);
      expect(s.nextLevel).toEqual(
        expect.objectContaining({ level: 2, xpRequired: 75, xpRemaining: 35 }),
      );
    });

    it('the top level has no next level and reads 100%', () => {
      const s = summarise({
        closedTrades: 400,
        backtestRuns: 150,
        daysActive: 120,
      });
      expect(s.level.level).toBe(PROGRESSION_LEVELS.length);
      expect(s.nextLevel).toBeNull();
      expect(s.percentToNext).toBe(100);
    });

    it('a fresh install summarises without throwing on zero everything', () => {
      const s = summarise({ closedTrades: 0, backtestRuns: 0, daysActive: 0 });
      expect(s.xp).toBe(0);
      expect(s.level.level).toBe(1);
      expect(s.percentToNext).toBe(0);
    });

    it('total XP is the sum of the capped sources', () => {
      const counts = { closedTrades: 10, backtestRuns: 2, daysActive: 5 };
      expect(totalXp(counts)).toBe(10 * 2 + 2 * 3 + 5 * 1);
    });
  });

  describe('the table itself', () => {
    it('is ordered, starts at 0 XP and never repeats a level number', () => {
      const levels = PROGRESSION_LEVELS.map((l) => l.level);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
      expect(new Set(levels).size).toBe(levels.length);
      expect(PROGRESSION_LEVELS[0].xpRequired).toBe(0);
    });

    it('every source declares a positive weight, a positive cap and where it comes from', () => {
      for (const def of Object.values(XP_SOURCES)) {
        expect(def.weight).toBeGreaterThan(0);
        expect(def.cap).toBeGreaterThan(0);
        expect(def.source.length).toBeGreaterThan(0);
      }
    });
  });
});
