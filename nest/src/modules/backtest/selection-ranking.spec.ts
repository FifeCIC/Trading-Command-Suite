import {
  parseCutoffUtc,
  moveSoFarPct,
  rankCandidates,
  buildDayRanks,
  applySelection,
  type RankBar,
} from './selection-ranking';

/**
 * The generic ranked-selection rules.
 *
 * ⚠️ THE LOOK-AHEAD TESTS ARE THE POINT OF THIS FILE. Everything else is arithmetic; "the ranking
 * must not see the rest of the day" is the property that decides whether a selection backtest means
 * anything. Each of those tests states the trap in its name so a failure is self-explaining.
 */

const bar = (timestamp: string, close: number): RankBar => ({ timestamp, close });

describe('parseCutoffUtc', () => {
  it('parses HH:MM to minutes', () => {
    expect(parseCutoffUtc('15:30')).toBe(930);
    expect(parseCutoffUtc('09:05')).toBe(545);
    expect(parseCutoffUtc('00:00')).toBe(0);
  });

  it('THROWS on anything it cannot read — a cutoff silently read as 00:00 would rank on the first bar', () => {
    expect(() => parseCutoffUtc('1530')).toThrow(/not HH:MM/);
    expect(() => parseCutoffUtc('15:3O')).toThrow(/not HH:MM/);
    expect(() => parseCutoffUtc('25:00')).toThrow(/out of range/);
  });
});

describe('moveSoFarPct — measures at the cutoff and NOT beyond it', () => {
  const day = [
    bar('2026-11-04T14:30:00Z', 100),
    bar('2026-11-04T15:00:00Z', 110),
    bar('2026-11-04T15:30:00Z', 120), // cutoff lands here -> +20% from 100
    bar('2026-11-04T20:00:00Z', 300), // later collapse/spike must be invisible
    bar('2026-11-04T20:55:00Z', 400),
  ];

  it('uses the last bar AT OR BEFORE the cutoff', () => {
    const r = moveSoFarPct(day, 100, parseCutoffUtc('15:30'));
    expect(r.movePct).toBeCloseTo(20, 6);
  });

  it('▶ CANARY — a huge move AFTER the cutoff does not change the metric', () => {
    // Both halves computed from the same bars: only the cutoff differs.
    const early = moveSoFarPct(day, 100, parseCutoffUtc('15:30')).movePct;
    const late = moveSoFarPct(day, 100, parseCutoffUtc('23:59')).movePct;
    expect(early).toBeCloseTo(20, 6); // ranked on 120
    expect(late).toBeCloseTo(300, 6); // ranked on 400
    // If these ever agree, the cutoff is being ignored and the whole feature is look-ahead.
    expect(early).not.toBeCloseTo(late as number, 3);
  });

  it('reports a NULL metric with a reason when there is no previous close', () => {
    const r = moveSoFarPct(day, null, parseCutoffUtc('15:30'));
    expect(r.movePct).toBeNull();
    expect(r.reason).toMatch(/no previous session close/);
  });

  it('reports a NULL metric when no bar exists at or before the cutoff', () => {
    const eveningOnly = [bar('2026-11-04T19:00:00Z', 50)];
    const r = moveSoFarPct(eveningOnly, 100, parseCutoffUtc('15:30'));
    expect(r.movePct).toBeNull();
    expect(r.reason).toMatch(/no bar at or before the cutoff/);
  });

  it('rejects an unusable denominator instead of producing Infinity', () => {
    expect(moveSoFarPct(day, 0, parseCutoffUtc('15:30')).movePct).toBeNull();
    expect(moveSoFarPct(day, -5, parseCutoffUtc('15:30')).movePct).toBeNull();
  });
});

describe('rankCandidates', () => {
  const candidates = [
    { symbol: 'A', movePct: -8 },
    { symbol: 'B', movePct: 12 },
    { symbol: 'C', movePct: 4 },
    { symbol: 'D', movePct: null, reason: 'no previous session close to measure from' },
  ];

  it('winners = largest gain first, and only topN are selected', () => {
    const r = rankCandidates(candidates, 'winners', 2);
    expect(r.ranked.map((x) => x.symbol)).toEqual(['B', 'C', 'A', 'D']);
    expect(r.selected).toEqual(['B', 'C']);
    expect(r.ranked.filter((x) => x.selected).map((x) => x.symbol)).toEqual(['B', 'C']);
  });

  it('losers = most negative first', () => {
    const r = rankCandidates(candidates, 'losers', 2);
    expect(r.selected).toEqual(['A', 'C']);
    expect(r.ranked[0].symbol).toBe('A');
  });

  it('keeps unmeasured candidates VISIBLE with rank null — a short ranking must not look complete', () => {
    const r = rankCandidates(candidates, 'winners', 3);
    const d = r.ranked.find((x) => x.symbol === 'D')!;
    expect(d.rank).toBeNull();
    expect(d.selected).toBe(false);
    expect(d.reason).toMatch(/previous session close/);
    expect(r.ranked).toHaveLength(4);
  });

  it('selects nothing when topN is 0 or negative', () => {
    expect(rankCandidates(candidates, 'winners', 0).selected).toEqual([]);
    expect(rankCandidates(candidates, 'winners', -3).selected).toEqual([]);
  });

  it('selects everything available when topN exceeds the candidate count', () => {
    const r = rankCandidates(candidates, 'winners', 50);
    expect(r.selected).toEqual(['B', 'C', 'A']); // D is unmeasured, so never selected
  });
});

describe('buildDayRanks', () => {
  const bars = (): Map<string, RankBar[]> =>
    new Map([
      [
        'AAA',
        [
          bar('2026-11-04T14:30:00Z', 10),
          bar('2026-11-04T20:55:00Z', 10),
          bar('2026-11-05T14:30:00Z', 10),
          bar('2026-11-05T15:30:00Z', 11), // +10% at cutoff
          bar('2026-11-05T20:55:00Z', 30), // +200% by the close — must NOT influence the ranking
        ],
      ],
      [
        'BBB',
        [
          bar('2026-11-04T14:30:00Z', 20),
          bar('2026-11-04T20:55:00Z', 20),
          bar('2026-11-05T14:30:00Z', 20),
          bar('2026-11-05T15:30:00Z', 24), // +20% at cutoff — the real winner
          bar('2026-11-05T20:55:00Z', 22),
        ],
      ],
    ]);

  it('the FIRST day is unrankable and says why — there is no earlier close in the window', () => {
    const days = buildDayRanks(bars(), 'winners', 1, '15:30');
    expect(days[0].date).toBe('2026-11-04');
    expect(days[0].rankable).toBe(false);
    expect(days[0].reason).toMatch(/first day in the window/);
  });

  it('▶ CANARY — ranks on the cutoff, not the day\'s closing move', () => {
    const days = buildDayRanks(bars(), 'winners', 1, '15:30');
    const day2 = days[1];
    expect(day2.rankable).toBe(true);
    // At 15:30 BBH leads (+20% vs +10%). By the close AAA is up 200% — a look-ahead ranking would
    // pick AAA and this assertion is what catches it.
    expect(day2.selected).toEqual(['BBB']);
    expect(day2.ranked[0].symbol).toBe('BBB');
    expect(day2.ranked[0].movePct).toBeCloseTo(20, 6);
  });

  it('losers side picks the weakest candidate', () => {
    const days = buildDayRanks(bars(), 'losers', 1, '15:30');
    expect(days[1].selected).toEqual(['AAA']); // +10% is the weaker move
  });

  it('a later cutoff moves the winner — proving the cutoff parameter is live', () => {
    const days = buildDayRanks(bars(), 'winners', 1, '23:59');
    expect(days[1].selected).toEqual(['AAA']); // +50% vs +10% at the close
  });
});

describe('applySelection — keeps only what the selection would have taken', () => {
  const days = [
    { date: '2026-11-04', rankable: false, ranked: [], selected: [] },
    { date: '2026-11-05', rankable: true, ranked: [], selected: ['AAA'] },
  ];
  const t = (symbol: string, entryDate: string) => ({ symbol, entryDate, id: `${symbol}-${entryDate}` });

  it('keeps a selected symbol entered at or after the cutoff', () => {
    const { kept, dropped } = applySelection([t('AAA', '2026-11-05T15:30:00Z')], days, '15:30');
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it('drops a selected symbol entered BEFORE the cutoff — the ranking was not known yet', () => {
    const { kept, dropped } = applySelection([t('AAA', '2026-11-05T15:00:00Z')], days, '15:30');
    expect(kept).toHaveLength(0);
    expect(dropped[0].code).toBe('before-cutoff');
  });

  it('drops a symbol that was not selected that day', () => {
    const { kept, dropped } = applySelection([t('BBB', '2026-11-05T16:00:00Z')], days, '15:30');
    expect(kept).toHaveLength(0);
    expect(dropped[0].code).toBe('not-selected');
  });

  it('drops everything on an unrankable day', () => {
    const { kept } = applySelection([t('AAA', '2026-11-04T18:00:00Z')], days, '15:30');
    expect(kept).toHaveLength(0);
  });
});
