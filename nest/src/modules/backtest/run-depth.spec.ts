/**
 * run-depth.spec.ts — the labels that turn a run's recorded bars into a readable timeline.
 *
 * ⚠️ A DERIVED STATE IS A CLAIM. Every case here is one of the ways the label can lie: calling a gated
 * bar "signalled", counting a trade the selection refused, or showing a warm-up session as result.
 */
import {
  buildDepthBars,
  buildStepLadder,
  type DepthSeriesRow,
  type DepthTrade,
} from './run-depth';

const row = (time: string, over: Partial<DepthSeriesRow> = {}): DepthSeriesRow => ({
  time,
  price: 10,
  changePct: 5,
  score: 12,
  signalPct: 12,
  opportunityPct: 30,
  riskMultiplier: 0.5,
  signal: 'BUY',
  passedBar: true,
  ...over,
});

const trade = (over: Partial<DepthTrade> = {}): DepthTrade => ({
  entryDate: '2026-11-11T15:35:00.000Z',
  exitDate: '2026-11-11T15:40:00.000Z',
  entryPrice: 10,
  exitPrice: 10.1,
  direction: 'LONG',
  pnl: 12.5,
  exitReason: 'TP',
  signal: 'BUY',
  kept: true,
  ...over,
});

const base = {
  answerDate: '2026-11-11',
  cutoffUtc: '15:30',
  directionMode: 'long' as const,
};

describe('buildDepthBars', () => {
  it('excludes warm-up sessions — a bar from another day is not a result', () => {
    const bars = buildDepthBars({
      ...base,
      series: [row('2026-11-10T15:35:00.000Z'), row('2026-11-11T15:35:00.000Z')],
      trades: [],
    });
    expect(bars).toHaveLength(1);
    expect(bars[0].time).toBe('2026-11-11T15:35:00.000Z');
  });

  it('marks a bar before the cutoff, and still shows what it scored', () => {
    const bars = buildDepthBars({
      ...base,
      series: [row('2026-11-11T15:00:00.000Z', { signal: 'HOLD' }), row('2026-11-11T15:30:00.000Z')],
      trades: [],
    });
    expect(bars[0].beforeCutoff).toBe(true);
    expect(bars[0].state).toBe('quiet');
    expect(bars[1].beforeCutoff).toBe(false);
    expect(bars[1].state).toBe('signal-not-traded');
  });

  it('labels the bar a trade opened on, and the bar it closed on', () => {
    const bars = buildDepthBars({
      ...base,
      series: [row('2026-11-11T15:35:00.000Z'), row('2026-11-11T15:40:00.000Z')],
      trades: [trade()],
    });
    expect(bars[0].state).toBe('entry');
    expect(bars[0].entries).toEqual([{ direction: 'LONG', kept: true, pnl: 12.5 }]);
    expect(bars[1].state).toBe('exit');
    expect(bars[1].exits[0].exitReason).toBe('TP');
  });

  it('▶ CANARY — a bar-gate failure outranks an actionable signal', () => {
    // Both facts are true. Reporting "signalled, not traded" would send the reader looking for a
    // reason inside the decision path when the bar never reached it.
    const bars = buildDepthBars({
      ...base,
      series: [row('2026-11-11T15:35:00.000Z', { passedBar: false, signal: 'STRONG_BUY' })],
      trades: [],
    });
    expect(bars[0].state).toBe('bar-gate');
  });

  it('NO_DATA is its own state, never "quiet"', () => {
    const bars = buildDepthBars({
      ...base,
      series: [row('2026-11-11T15:35:00.000Z', { signal: 'NO_DATA', score: 0, signalPct: 0 })],
      trades: [],
    });
    expect(bars[0].state).toBe('no-data');
  });

  it('a BUY on a SHORT run is not an actionable signal', () => {
    // Same bar, two directions: the label must follow the protocol's side or it will report signals
    // the engine could never have acted on.
    const longSide = buildDepthBars({ ...base, series: [row('2026-11-11T15:35:00.000Z')], trades: [] });
    const shortSide = buildDepthBars({
      ...base,
      directionMode: 'short',
      series: [row('2026-11-11T15:35:00.000Z')],
      trades: [],
    });
    expect(longSide[0].state).toBe('signal-not-traded');
    expect(shortSide[0].state).toBe('quiet');
  });

  it('shows a trade the selection refused, with its P/L withheld', () => {
    const bars = buildDepthBars({
      ...base,
      series: [row('2026-11-11T15:35:00.000Z')],
      trades: [trade({ kept: false })],
    });
    expect(bars[0].state).toBe('entry');
    expect(bars[0].entries[0].kept).toBe(false);
    expect(bars[0].entries[0].pnl).toBeNull();
  });

  it('labels one bar that both closed and opened a position', () => {
    const bars = buildDepthBars({
      ...base,
      series: [row('2026-11-11T15:40:00.000Z')],
      trades: [
        trade({ exitDate: '2026-11-11T15:40:00.000Z' }),
        trade({ entryDate: '2026-11-11T15:40:00.000Z', exitDate: '2026-11-11T15:45:00.000Z' }),
      ],
    });
    expect(bars[0].state).toBe('entry+exit');
    expect(bars[0].entries).toHaveLength(1);
    expect(bars[0].exits).toHaveLength(1);
  });
});

describe('buildStepLadder', () => {
  const bars = (() => {
    const series = [
      row('2026-11-11T15:00:00.000Z', { signal: 'HOLD' }), // before cutoff
      row('2026-11-11T15:35:00.000Z'), // actionable, traded
      row('2026-11-11T15:40:00.000Z', { signal: 'HOLD' }), // exit bar
      row('2026-11-11T15:45:00.000Z', { passedBar: false }), // gated
      row('2026-11-11T15:50:00.000Z'), // actionable, engine entered, selection refused
      row('2026-11-11T15:55:00.000Z'), // actionable, nothing traded
    ];
    const trades = [
      trade(),
      // Closes at an instant that is NOT a bar in this fixture, so its exit row cannot be mistaken
      // for the "signalled, nothing traded" bar at 15:55.
      trade({ kept: false, entryDate: '2026-11-11T15:50:00.000Z', exitDate: '2026-11-11T15:59:00.000Z' }),
    ];
    return buildDepthBars({ ...base, series, trades });
  })();

  const ladder = buildStepLadder({
    candidates: 10,
    selected: 1,
    bars,
    trades: [
      trade(),
      trade({ kept: false, entryDate: '2026-11-11T15:50:00.000Z', exitDate: '2026-11-11T15:59:00.000Z' }),
    ],
  });

  const step = (id: string) => ladder.find((s) => s.id === id)!;

  it('counts the day, and names the denominator for each rung', () => {
    expect(step('candidates')).toMatchObject({ count: 10, of: null });
    expect(step('selected')).toMatchObject({ count: 1, of: 10 });
    expect(step('scored')).toMatchObject({ count: 6, of: null });
    expect(step('tradable')).toMatchObject({ count: 5, of: 6 });
    expect(step('bar-gate')).toMatchObject({ count: 4, of: 5 });
  });

  it('▶ CANARY — a bar that both signalled and traded is not counted as "signal, no trade"', () => {
    // The 15:35 bar is actionable AND has an entry; counting it in both rungs would make the ladder
    // add up to more bars than exist and hide a genuine gap.
    expect(step('signals').count).toBe(1); // only 15:50
  });

  it('separates engine entries from what the strategy could take', () => {
    expect(step('entries').count).toBe(2);
    expect(step('kept').count).toBe(1);
    expect(step('exits').count).toBe(1);
  });

  it('▶ CANARY — no rung reports more than its own denominator', () => {
    // This caught a real defect on 2026-11-11: `entries` counted the whole session while its
    // denominator was the post-cutoff bars, so live NXXT read "53 of 44".
    for (const s of ladder) {
      if (s.of != null) expect(s.count).toBeLessThanOrEqual(s.of);
    }
  });

  it('counts a pre-cutoff entry in the entries rung, measured against the whole session', () => {
    // The engine opens trades before the cutoff too, and the selection drops them. The denominator
    // must therefore be the session's bars or the count can read larger than the whole.
    const early = [trade({ entryDate: '2026-11-11T15:00:00.000Z', exitDate: '2026-11-11T15:05:00.000Z', kept: false })];
    const barsWithEarly = buildDepthBars({
      ...base,
      series: [row('2026-11-11T15:00:00.000Z'), row('2026-11-11T15:35:00.000Z', { signal: 'HOLD' })],
      trades: early,
    });
    const l = buildStepLadder({ candidates: 10, selected: 1, bars: barsWithEarly, trades: early });
    const entries = l.find((s) => s.id === 'entries')!;
    expect(entries.count).toBe(1);
    expect(entries.of).toBe(2); // the session's bars, not the 1 bar after the cutoff
  });

  it('reports a rung of zero rather than omitting it', () => {
    const empty = buildStepLadder({ candidates: 3, selected: 0, bars: [], trades: [] });
    expect(empty.map((s) => s.id)).toEqual([
      'candidates',
      'selected',
      'scored',
      'tradable',
      'bar-gate',
      'signals',
      'entries',
      'kept',
      'exits',
    ]);
    expect(empty.every((s) => s.count === 0 || s.id === 'candidates')).toBe(true);
  });
});
