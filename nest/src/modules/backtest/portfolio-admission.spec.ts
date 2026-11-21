/**
 * portfolio-admission.spec.ts — the two live rules that decide whether a bot COULD have taken a trade.
 *
 * ⚠️ THE FAILURE MODE IS A POPULATION THAT LOOKS RIGHT. The engine already decided every entry and exit
 * correctly; what it never asked was "was the bot free?". Measured 2026-11-20: one movers day produced
 * **53 entries where the bot could have taken 13** (30-minute cooldown). Nothing errored then either.
 */
import {
  admitTrades,
  effectiveCooldownMinutes,
  type AdmittableTrade,
} from './portfolio-admission';

const t = (entryMin: number, holdMin: number, symbol = 'AAA'): AdmittableTrade => ({
  entryMs: Date.UTC(2026, 10, 20, 14, 0) + entryMin * 60_000,
  exitMs: Date.UTC(2026, 10, 20, 14, 0) + (entryMin + holdMin) * 60_000,
  symbol,
});

const entryMins = (trades: readonly AdmittableTrade[]) =>
  trades.map((x) => (x.entryMs - Date.UTC(2026, 10, 20, 14, 0)) / 60_000);

describe('effectiveCooldownMinutes — live reads `|| 5`', () => {
  it('turns 0/absent/NaN into FIVE minutes, never into "off"', () => {
    for (const raw of [0, null, undefined, Number.NaN, -3]) {
      expect(effectiveCooldownMinutes(raw as never)).toBe(5);
    }
  });

  it('passes a real cooldown through', () => {
    expect(effectiveCooldownMinutes(30)).toBe(30);
  });
});

describe('admitTrades — the cooldown', () => {
  it('▶ CANARY — refuses entries closer together than the cooldown, and says how short', () => {
    // Five entries five minutes apart, a 30-minute cooldown: only the first can be taken.
    const trades = [t(0, 20), t(5, 20), t(10, 20), t(15, 20), t(20, 20)];
    const r = admitTrades(trades, { maxConcurrent: null, cooldownMinutes: 30 });
    expect(entryMins(r.admitted)).toEqual([0]);
    expect(r.refused).toHaveLength(4);
    expect(r.refused.every((x) => x.code === 'cooldown')).toBe(true);
    expect(r.refused[0].because).toMatch(/5 min after the previous entry/);
    expect(r.refused[0].because).toMatch(/25 min short/);
  });

  it('admits an entry EXACTLY on the boundary — live refuses on `<`, not `<=`', () => {
    const r = admitTrades([t(0, 10), t(30, 10)], { maxConcurrent: null, cooldownMinutes: 30 });
    expect(entryMins(r.admitted)).toEqual([0, 30]);
  });

  it('measures from the last ADMITTED entry, not from the last candidate', () => {
    // 0 admitted; 5 refused; 40 is 40 min after 0 → admitted; 45 is 5 min after 40 → refused.
    const r = admitTrades([t(0, 10), t(5, 10), t(40, 10), t(45, 10)], { maxConcurrent: null, cooldownMinutes: 30 });
    expect(entryMins(r.admitted)).toEqual([0, 40]);
    expect(r.refused.map((x) => x.code)).toEqual(['cooldown', 'cooldown']);
  });

  it('applies the 5-minute default when the bot declares none — that is live behaviour', () => {
    const r = admitTrades([t(0, 10), t(3, 10), t(10, 10)], { maxConcurrent: null, cooldownMinutes: 0 });
    expect(entryMins(r.admitted)).toEqual([0, 10]);
    expect(r.applied.cooldownMinutes).toBe(5);
  });
});

describe('admitTrades — the concurrency cap', () => {
  it('refuses an entry while the cap is full, and admits once a position closes', () => {
    // One position, held 60 minutes: everything entered inside that window is refused.
    const trades = [t(0, 60), t(10, 5), t(70, 5)];
    const r = admitTrades(trades, { maxConcurrent: 1, cooldownMinutes: 5 });
    expect(entryMins(r.admitted)).toEqual([0, 70]);
    expect(r.refused.map((x) => x.code)).toEqual(['cap']);
    expect(r.refused[0].because).toMatch(/already open — the live cap is 1/);
  });

  it('a trade entering on the SAME instant another exits IS admitted — the close is processed first', () => {
    const r = admitTrades([t(0, 30), t(30, 5)], { maxConcurrent: 1, cooldownMinutes: 5 });
    expect(entryMins(r.admitted)).toEqual([0, 30]);
  });

  it('no cap declared means no cap — and the result says so rather than inventing one', () => {
    const r = admitTrades([t(0, 60), t(5, 60), t(10, 60)], { maxConcurrent: null, cooldownMinutes: 1 });
    expect(r.admitted).toHaveLength(3);
    expect(r.applied.maxConcurrent).toBeNull();
  });

  it('a zero or negative cap is NOT "unlimited" — it is refused as unreadable', () => {
    const r = admitTrades([t(0, 60), t(5, 60)], { maxConcurrent: 0, cooldownMinutes: 1 });
    expect(r.applied.maxConcurrent).toBeNull();
    expect(r.admitted).toHaveLength(2);
  });

  it('the CAP is what bites when the cooldown is satisfied — the codes tell them apart', () => {
    // Two symbols, both entering 10 min apart with a 5-min cooldown, cap 1: the first holds 120 min.
    const r = admitTrades([t(0, 120, 'AAA'), t(10, 5, 'BBB'), t(20, 5, 'CCC')], { maxConcurrent: 1, cooldownMinutes: 5 });
    expect(entryMins(r.admitted)).toEqual([0]);
    expect(r.refused.map((x) => x.code)).toEqual(['cap', 'cap']);
  });
});

describe('admitTrades — honesty about the population', () => {
  it('returns EVERY trade exactly once — admitted or refused, never dropped', () => {
    const trades = [t(0, 20), t(3, 20), t(9, 20), t(40, 20)];
    const r = admitTrades(trades, { maxConcurrent: 1, cooldownMinutes: 30 });
    expect(r.admitted.length + r.refused.length).toBe(trades.length);
    const ids = new Set([...r.admitted, ...r.refused.map((x) => x.trade)].map((x) => x.entryMs));
    expect(ids.size).toBe(trades.length);
  });

  it('orders by ENTRY even when handed an unordered list — the earliest signal has first claim', () => {
    const r = admitTrades([t(40, 5), t(0, 5), t(20, 5)], { maxConcurrent: null, cooldownMinutes: 15 });
    expect(entryMins(r.admitted)).toEqual([0, 20, 40]);
  });

  it('an empty population is an empty result, not a refusal to judge', () => {
    expect(admitTrades([], { maxConcurrent: 1, cooldownMinutes: 30 })).toEqual({
      admitted: [],
      refused: [],
      applied: { maxConcurrent: 1, cooldownMinutes: 30 },
    });
  });
});
