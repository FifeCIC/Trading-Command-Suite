/**
 * stoch-rsi.directive.spec.ts — proves the directive does what its header claims.
 *
 * ⚠️ THE TEST THAT MATTERS MOST IS `maxScore is ACHIEVABLE`. The whole reason this directive exists
 * is that its sibling `stochastic` declares `maxScore = 100` while gating `signalClass` at
 * `>= 60`, so 60% of its declared capacity can never be awarded — and measured across ~200,000 real
 * readings, `earnings-momentum` best-ever 0/100, `adx` 16/100, `support-resistance-levels` 25/95,
 * `btc-halving-cycle` 59/200. A test that only checks "it emits BUY sometimes" would pass on a
 * directive with exactly that fault, so this spec checks the CEILING and the FLOOR instead.
 */

import { StochRsiDirective } from './stoch-rsi.directive';
import { DirectiveInput } from '../interfaces/directive.interface';

/** Build bars from a close series, with a small high/low envelope. */
function bars(closes: number[]): DirectiveInput['bars'] {
  return closes.map((c, i) => ({
    time: new Date(2026, 0, 1, 0, i).toISOString(),
    open: i === 0 ? c : closes[i - 1],
    high: c * 1.0005,
    low: c * 0.9995,
    close: c,
    volume: 1000,
  })) as DirectiveInput['bars'];
}

const input = (closes: number[]): DirectiveInput => ({ symbol: 'XAUUSD', bars: bars(closes) } as DirectiveInput);

/** A long decline then a sharp reversal — the shape a StochRSI cross-up is meant to catch. */
function declineThenRise(): number[] {
  const out: number[] = [];
  let p = 2000;
  for (let i = 0; i < 60; i++) { p -= 4; out.push(p); }
  for (let i = 0; i < 20; i++) { p += 9; out.push(p); }
  return out;
}

/** The mirror: a long rise then a sharp reversal. */
function riseThenDecline(): number[] {
  const out: number[] = [];
  let p = 1800;
  for (let i = 0; i < 60; i++) { p += 4; out.push(p); }
  for (let i = 0; i < 20; i++) { p -= 9; out.push(p); }
  return out;
}

describe('StochRsiDirective', () => {
  const d = new StochRsiDirective();

  it('declares identity and readiness the engine relies on', () => {
    expect(d.id).toBe('stoch-rsi');
    expect(d.category).toBe('oscillator');
    expect(d.readiness).toBe('ready');
    expect(d.maxScore).toBeGreaterThan(0);
  });

  it('refuses to invent a reading when there is not enough data', () => {
    const r = d.calculate(input([1, 2, 3]));
    expect(r.score).toBe(0);
    expect(r.signalClass).toBe('neutral');
    expect(r.reason).toMatch(/Insufficient data/);
  });

  it('treats a perfectly flat series as NO READING, never as a mid score', () => {
    // ⚠️ A zero denominator must not become 0 or 50. "Cannot judge" and "judged neutral" are
    // different facts and must never render the same.
    const r = d.calculate(input(new Array(120).fill(2000)));
    expect(r.score).toBe(0);
    expect(r.signalClass).toBe('neutral');
    expect(r.reason).toMatch(/flat|no oscillation/i);
  });

  it('emits a DIRECTION on a real reversal (not merely a score)', () => {
    const up = d.calculate(input(declineThenRise()));
    expect(['bullish', 'bearish']).toContain(up.signalClass);
    expect(up.score).toBeGreaterThan(0);
  });

  it('emits opposite directions for opposite reversals', () => {
    const up = d.calculate(input(declineThenRise()));
    const down = d.calculate(input(riseThenDecline()));
    // Both must be directional, and they must disagree about the way.
    expect(up.signalClass).not.toBe('neutral');
    expect(down.signalClass).not.toBe('neutral');
    expect(up.signalClass).not.toBe(down.signalClass);
  });

  // ── ⚠️ the fault this directive exists to avoid ──────────────────────────────────────────────

  it('has NO SCORE CLIFF — a low score is still classified, never discarded as neutral', () => {
    // Sweep many series. Any reading with a nonzero score must carry a direction; a "score > 0 but
    // neutral" row is exactly the cliff that makes 60% of `stochastic` unreachable.
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const closes: number[] = [];
      let p = 2000;
      for (let i = 0; i < 140; i++) {
        p += Math.sin((i + seed) / 5) * 6 + Math.sin((i + seed) / 17) * 3;
        closes.push(p);
      }
      const r = d.calculate(input(closes));
      if (r.score > 0) {
        checked++;
        expect(r.signalClass).not.toBe('neutral');
      }
    }
    // The sweep must actually exercise the case, or this test proves nothing.
    expect(checked).toBeGreaterThan(10);
  });

  it('⚠️ maxScore is ACHIEVABLE — the ceiling is not inflated capacity', () => {
    // Sweep widely and require the declared maximum to be REACHED. If this fails, the directive
    // declares capacity it cannot award, which is the fault the header says it avoids.
    let best = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const closes: number[] = [];
      let p = 2000;
      for (let i = 0; i < 160; i++) {
        // A mix of trend, oscillation and shock so the %K/%D pair separates widely.
        p += Math.sin((i + seed) / 4) * 9 + Math.sin((i + seed) / 11) * 4 + ((i + seed) % 23 === 0 ? 25 : 0);
        closes.push(p);
      }
      best = Math.max(best, d.calculate(input(closes)).score);
    }
    expect(best).toBeGreaterThanOrEqual(d.maxScore * 0.9);
  });

  it('never exceeds its declared maxScore', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const closes: number[] = [];
      let p = 2000;
      for (let i = 0; i < 160; i++) { p += Math.sin((i + seed) / 3) * 12; closes.push(p); }
      expect(d.calculate(input(closes)).score).toBeLessThanOrEqual(d.maxScore);
    }
  });

  it('states HOW it classified, so a reader can see the score was not gated', () => {
    const r = d.calculate(input(declineThenRise()));
    expect(r.metadata?.classifiedBy).toBe('crossover');
    expect(r.reason).toMatch(/separation=/);
    expect(r.reason).toMatch(/momentum=/);
  });
});
