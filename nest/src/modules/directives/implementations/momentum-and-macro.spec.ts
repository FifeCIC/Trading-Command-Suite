/**
 * momentum-and-macro directive CLAIMS — the number must not describe an instrument it never read.
 * =================================================================================================
 * Created 2026-11-02 (#1181, register row 129) after the owner's direction:
 * *"we shouldn't mix up symbol names like sp500 and vix within a strategy — that will cause a lot of
 * confusion."*
 *
 * Two defects this file locks, both measured in production:
 *
 *  1. `spy-qqq-relative-strength` printed `SPY/QQQ RS proxy: …` while computing from `input.bars`,
 *     i.e. the PROTOCOL'S OWN symbol. Inside a VIX protocol it said "SPY/QQQ" about VIX. Its own
 *     source comment admitted it: "name is aspirational: uses own bars, not SPY/QQQ".
 *
 *  2. The same directive guarded with `closes.length < 20` but read `closes[closes.length - 21]`.
 *     At EXACTLY 20 bars that index is -1 → `undefined` → `ret20 = NaN` → the whole score became
 *     NaN. A NaN is not a small error in a composite: it propagates through every sum that touches
 *     it. `minBars` is now 21 and the guard says 21.
 *
 * ⚠️ CANARY BOTH DIRECTIONS. Restore the `SPY/QQQ` prefix and test 1 fails. Put the guard back to
 * `< 20` and test 2 fails (a NaN score is the observed result). Passing only proves the assertion
 * compiles unless each has been seen to fail.
 */
import { SpyQqqRelativeStrengthDirective } from './momentum-and-macro.directives';
import { Sp500RegimeDirective } from './momentum-and-macro.directives';
import type { DirectiveInput, MarketBar } from '../interfaces/directive.interface';

function bars(n: number, start = 1000): MarketBar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = start + i;
    return {
      timestamp: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000_000,
    };
  });
}

function input(symbol: string, n: number): DirectiveInput {
  return { symbol, bars: bars(n), timeframe: '1d' } as DirectiveInput;
}

describe('spy-qqq-relative-strength — claims', () => {
  const d = new SpyQqqRelativeStrengthDirective();

  it('declares the 21 bars its body actually needs (it reads index -21)', () => {
    expect(d.minBars?.['1d']).toBe(21);
  });

  it('refuses at exactly 20 bars instead of producing NaN', () => {
    const r = d.calculate(input('VIX', 20));
    expect(Number.isNaN(r.score)).toBe(false);
    expect(r.score).toBe(0);
    expect(r.signalClass).toBe('neutral');
  });

  it('never names SPY or QQQ in its reason — it reads the protocol its own symbol', () => {
    const r = d.calculate(input('VIX', 60));
    expect(r.reason).not.toMatch(/SPY/i);
    expect(r.reason).not.toMatch(/QQQ/i);
  });

  it('does not name SPY or QQQ in its display name either', () => {
    expect(d.name).not.toMatch(/SPY/i);
    expect(d.name).not.toMatch(/QQQ/i);
  });

  it('still scores a real reading (the claim fix changed no arithmetic)', () => {
    const r = d.calculate(input('VIX', 60));
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(d.maxScore);
  });
});

describe('sp500-regime — labelled as an overlay, still measuring', () => {
  const d = new Sp500RegimeDirective();

  it('says the S&P 500 is context and NOT the traded symbol', () => {
    const r = d.calculate(input('VIX', 220));
    expect(r.reason).toMatch(/NOT the traded symbol/i);
  });

  it('declares 200 bars, so the caller can actually fetch what it refuses below', () => {
    expect(d.minBars?.['1d']).toBe(200);
  });

  it('reports unmeasured rather than a score when starved of bars', () => {
    const r = d.calculate(input('VIX', 72));
    expect(r.score).toBe(0);
    expect(r.unmeasured).toBe(true);
  });

  it('produces a real reading once the requirement is met', () => {
    const r = d.calculate(input('VIX', 220));
    expect(r.unmeasured).toBeFalsy();
    expect(r.score).toBeGreaterThan(0);
  });
});

describe('bar requirement declarations — the four fixed under #1181', () => {
  it('every directive that refuses below N declares N, so the loader can honour it', async () => {
    const mod = await import('./momentum-and-macro.directives');
    const cases: Array<[string, number]> = [
      ['VolatilityToolsDirective', 20],
      ['MeanReversionDirective', 30],
      ['AnalystAdjustmentsDirective', 15],
      ['SpyQqqRelativeStrengthDirective', 21],
    ];
    for (const [cls, expected] of cases) {
      const Ctor = (mod as Record<string, unknown>)[cls] as new () => { minBars?: Record<string, number> };
      const inst = new Ctor();
      expect({ cls, minBars: inst.minBars?.['1d'] }).toEqual({ cls, minBars: expected });
    }
  });
});
