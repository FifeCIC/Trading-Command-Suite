/**
 * position-bar.spec.ts — the per-bar exit decision, canaried on the ORDER as well as the arithmetic.
 *
 * ⚠️ THE ORDER IS THE PART THAT FAILS SILENTLY. A wrong price is visible in one number; a time stop
 * tested before the stop is not — it books a plausible exit at a plausible price and quietly ignores a
 * level the market traded through. So the cases below assert which rule fired, not only where.
 */
import { managePositionBar, PositionBar, PositionState } from './position-bar';

const at = (minutes: number) => Date.UTC(2026, 10, 11, 14, 30) + minutes * 60_000;

/**
 * A bar whose `open` defaults to its close, so a case that is not about the session boundary does not
 * have to state a price it never uses. A case that IS about the boundary passes `open` explicitly.
 */
const bar = (over: Partial<PositionBar> & { high: number; low: number; close: number; timeMs: number }): PositionBar => ({
  open: over.close,
  ...over,
});

const base = (over: Partial<PositionState> = {}): PositionState => ({
  side: 'buy',
  entryPrice: 100,
  initialStop: 99,
  stop: 99,
  target: 106,
  bestPrice: 100,
  worstPct: 0,
  bestPct: 0,
  ...over,
});

describe('managePositionBar — the stop', () => {
  it('fills at the configured stop and calls it SL', () => {
    const d = managePositionBar(base(), bar({ high: 101, low: 98.9, close: 99.2, timeMs: at(5) }));
    expect(d.exit).toEqual({ kind: 'SL', price: 99, timeMs: at(5) });
  });

  it('calls a tightened stop TRAIL, not SL — the bracket did not stop this trade out', () => {
    const d = managePositionBar(
      base({ stop: 100.5 }),
      bar({ high: 101, low: 100.2, close: 100.6, timeMs: at(5) }),
    );
    expect(d.exit).toMatchObject({ kind: 'TRAIL', price: 100.5 });
  });

  it('mirrors for a short: the stop sits ABOVE and a high fills it', () => {
    const d = managePositionBar(
      base({ side: 'sell', initialStop: 101, stop: 101, target: 94 }),
      bar({ high: 101.4, low: 99, close: 100, timeMs: at(5) }),
    );
    expect(d.exit).toMatchObject({ kind: 'SL', price: 101 });
  });
});

describe('managePositionBar — the order', () => {
  it('reports the stop, not the time stop, when both could fire on one bar', () => {
    // The level was genuinely traded through; the time stop is only a decision to leave at the close.
    const d = managePositionBar(base(), bar({ high: 101, low: 98, close: 98, timeMs: at(60) }), {}, 'TIME');
    expect(d.exit?.kind).toBe('SL');
  });

  it('reports the target ahead of the time stop', () => {
    const d = managePositionBar(base(), bar({ high: 106, low: 99.5, close: 105, timeMs: at(60) }), {}, 'TIME');
    expect(d.exit?.kind).toBe('TP');
  });

  it('closes at the BAR CLOSE with TIME when only the time stop fired', () => {
    const d = managePositionBar(base(), bar({ high: 101, low: 99.4, close: 100.4, timeMs: at(240) }), {}, 'TIME');
    expect(d.exit).toEqual({ kind: 'TIME', price: 100.4, timeMs: at(240) });
  });

  it('does not close on an ordinary bar', () => {
    expect(managePositionBar(base(), bar({ high: 101, low: 99.4, close: 100.4, timeMs: at(5) })).exit).toBeNull();
  });
});

describe('managePositionBar — excursion', () => {
  it('records the excursion on the bar that EXITS, from the raw extremes', () => {
    // A trade that stopped out also went 1% in its favour on the way; losing that biases the
    // excursion statistics toward the trades that survived.
    const d = managePositionBar(base(), bar({ high: 101, low: 98.9, close: 99.2, timeMs: at(5) }));
    expect(d.state.worstPct).toBeCloseTo(1.1, 6);
    expect(d.state.bestPct).toBeCloseTo(1, 6);
  });

  it('accumulates the worst and best across bars, never replacing a larger one', () => {
    const first = managePositionBar(base(), bar({ high: 100.5, low: 99.6, close: 100.2, timeMs: at(5) }));
    const second = managePositionBar(first.state, bar({ high: 101, low: 99.5, close: 100.8, timeMs: at(10) }));
    expect(second.state.worstPct).toBeCloseTo(0.5, 6);
    expect(second.state.bestPct).toBeCloseTo(1, 6);
    expect(second.state.bestPrice).toBe(101);
  });

  it('does NOT let the bar that exits feed the trail (look-ahead guard)', () => {
    // `bestPrice` is only updated at the tighten step, so an exiting bar cannot move it.
    const d = managePositionBar(base(), bar({ high: 103, low: 98, close: 98.5, timeMs: at(5) }));
    expect(d.state.bestPrice).toBe(100);
  });
});

describe('managePositionBar — tightening', () => {
  it('locks at breakeven once the trade is far enough in front', () => {
    const d = managePositionBar(
      base(),
      bar({ high: 101, low: 99.6, close: 100.8, timeMs: at(5) }),
      { lockAtPct: 0.5 },
    );
    expect(d.state.stop).toBe(100);
  });

  it('does not lock before the threshold', () => {
    const d = managePositionBar(
      base(),
      bar({ high: 100.2, low: 99.6, close: 100.1, timeMs: at(5) }),
      { lockAtPct: 0.5 },
    );
    expect(d.state.stop).toBe(99);
  });

  it('trails a fixed distance behind the best price, and only while in profit', () => {
    const d = managePositionBar(
      base(),
      bar({ high: 104, low: 99.6, close: 103, timeMs: at(5) }),
      { trailPct: 2 },
    );
    expect(d.state.stop).toBeCloseTo(104 * 0.98, 6);

    const under = managePositionBar(
      base(),
      bar({ high: 100, low: 98.9, close: 99.5, timeMs: at(5) }),
      { trailPct: 2 },
    );
    expect(under.state.stop).toBe(99);
  });

  it('step-tightens from the CONFIGURED stop, one step per stepPct of gain', () => {
    const d = managePositionBar(
      base(),
      bar({ high: 104, low: 99.6, close: 103, timeMs: at(5) }),
      { stepPct: 1, tightenPct: 0.5 },
    );
    // 4% of gain at 1% per step = 4 steps × 0.5% of entry (100) = 2 points above 99.
    expect(d.state.stop).toBeCloseTo(101, 6);
  });

  it('never loosens a stop, even when a candidate is behind it', () => {
    const d = managePositionBar(
      base({ stop: 101 }),
      bar({ high: 104, low: 100.5, close: 103, timeMs: at(5) }),
      { trailPct: 5 },
    );
    expect(d.state.stop).toBe(101);
  });

  it('mirrors the trail for a short, tightening DOWNWARD', () => {
    const d = managePositionBar(
      base({ side: 'sell', initialStop: 101, stop: 101, target: 94, bestPrice: 100 }),
      bar({ high: 100, low: 96, close: 96.5, timeMs: at(5) }),
      { trailPct: 2 },
    );
    expect(d.state.stop).toBeCloseTo(96 * 1.02, 6);
  });
});

describe('managePositionBar — the ABSOLUTE money target', () => {
  const money = (targetAmount: number | null, pnlAtClose: number | null) => ({ targetAmount, pnlAtClose });

  it('closes at the bar close with TARGET when the amount is reached', () => {
    const d = managePositionBar(base(), bar({ high: 102, low: 99.5, close: 101.5, timeMs: at(5) }), {}, false, money(50, 62.4));
    expect(d.exit).toEqual({ kind: 'TARGET', price: 101.5, timeMs: at(5) });
  });

  it('does nothing while the P&L is below the amount', () => {
    const d = managePositionBar(base(), bar({ high: 102, low: 99.5, close: 101.5, timeMs: at(5) }), {}, false, money(50, 49.99));
    expect(d.exit).toBeNull();
  });

  it('is inert when the bot sets no amount — 0 and null both mean "no opinion"', () => {
    for (const amount of [null, 0]) {
      const d = managePositionBar(base(), bar({ high: 102, low: 99.5, close: 101.5, timeMs: at(5) }), {}, false, money(amount, 1_000_000));
      expect(d.exit).toBeNull();
    }
  });

  it('refuses to close on an unreadable P&L rather than reading it as zero', () => {
    const d = managePositionBar(base(), bar({ high: 102, low: 99.5, close: 101.5, timeMs: at(5) }), {}, false, money(50, null));
    expect(d.exit).toBeNull();
  });

  it('lets the PERCENTAGE target win on the same bar — a traded level beats a close-price test', () => {
    const d = managePositionBar(base(), bar({ high: 106, low: 99.5, close: 105.9, timeMs: at(5) }), {}, false, money(50, 900));
    expect(d.exit?.kind).toBe('TP');
  });

  it('beats the time stop on the same bar — the target is the more specific reason', () => {
    const d = managePositionBar(base(), bar({ high: 102, low: 99.5, close: 101.5, timeMs: at(60) }), {}, true, money(50, 62.4));
    expect(d.exit?.kind).toBe('TARGET');
  });
});

describe('managePositionBar — the SESSION boundary (#928)', () => {
  it('closes at the bar OPEN, not the close — the clock crossed before this bar traded', () => {
    const d = managePositionBar(
      base(),
      bar({ open: 100.4, high: 103, low: 99.5, close: 102.8, timeMs: at(30) }),
      {},
      'SESSION',
    );
    expect(d.exit).toEqual({ kind: 'SESSION', price: 100.4, timeMs: at(30) });
  });

  it('▶ CANARY — comes BEFORE the stop and the target, so a level it never held through cannot claim it', () => {
    // The same bar touches the stop (low 98.9 < 99) and the target (high 106). If the boundary were
    // tested after the levels, this trade would be booked as an SL or a TP — an exit at a price the
    // operator had already declared they would not be holding through.
    const stopBar = bar({ open: 100.2, high: 101, low: 98.9, close: 99.1, timeMs: at(30) });
    expect(managePositionBar(base(), stopBar, {}, 'SESSION').exit?.kind).toBe('SESSION');
    const targetBar = bar({ open: 100.2, high: 106, low: 99.5, close: 105.5, timeMs: at(30) });
    expect(managePositionBar(base(), targetBar, {}, 'SESSION').exit?.kind).toBe('SESSION');
  });

  it('adds NO excursion for the bar it exits on — the range had not happened at the open', () => {
    const d = managePositionBar(
      base(),
      bar({ open: 100.4, high: 110, low: 90, close: 102, timeMs: at(30) }),
      {},
      'SESSION',
    );
    expect(d.state.worstPct).toBe(0);
    expect(d.state.bestPct).toBe(0);
  });

  it('does not fire without the boundary verdict', () => {
    expect(managePositionBar(base(), bar({ open: 100.4, high: 101, low: 99.5, close: 100.8, timeMs: at(30) })).exit)
      .toBeNull();
  });
});

describe('managePositionBar — refusals', () => {
  it('throws on a non-positive entry rather than reporting a trade that never moved', () => {
    expect(() => managePositionBar(base({ entryPrice: 0 }), bar({ high: 1, low: 1, close: 1, timeMs: at(5) })))
      .toThrow(/entry price must be > 0/);
  });
});
