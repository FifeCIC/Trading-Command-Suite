/**
 * per-trade-risk.spec.ts — the money-at-risk ceiling (#1257).
 *
 * The measured case that motivated this: XAUUSD 0.01 lot with a 104.68 stop distance risked £78
 * on a £589.16 account = 13.3%, against a declared 2% cap that nothing on the order path read.
 * These tests pin the arithmetic AND the refusal behaviour, because the defect was never a wrong
 * number — it was a limit that was never asked.
 */
import { evaluatePerTradeRisk, type PerTradeRiskInput } from './per-trade-risk';

const base: PerTradeRiskInput = {
  stopDistance: 104.68,   // XAUUSD entry 3874.70 → stop 3770.02
  volume: 0.01,
  contractSize: 100,
  conversionRate: 1 / 1.34, // USD profit → GBP account
  equity: 589.16,
  capPct: 2,
  capSource: 'risk.maxTradeRiskCeilingPct',
};

describe('evaluatePerTradeRisk — the ceiling that was declared but never asked (#1257)', () => {
  it('REFUSES the real XAUUSD position that was live on 2026-11-12', () => {
    const r = evaluatePerTradeRisk(base);
    expect(r.evaluable).toBe(true);
    expect(r.allowed).toBe(false);
    // £78.12 of risk on a £589.16 account = 13.3%, against a 2% cap.
    expect(r.riskMoney).toBeCloseTo(78.12, 1);
    expect(r.riskPct).toBeCloseTo(13.26, 1);
    expect(r.reason).toContain('exceeds the 2% per-trade cap');
    expect(r.reason).toContain('risk.maxTradeRiskCeilingPct');
  });

  it('REFUSES the real NZDJPY position — 0.1 lot against a 0.01 FX book', () => {
    const r = evaluatePerTradeRisk({
      ...base,
      stopDistance: 0.708,     // 88.655 → 87.947
      volume: 0.1,
      contractSize: 100_000,
      conversionRate: 1 / 190, // JPY profit → GBP account
    });
    expect(r.allowed).toBe(false);
    expect(r.riskPct).toBeGreaterThan(2);
  });

  it('ALLOWS a the same gold trade at a size that fits inside the cap', () => {
    // 2% of 589.16 = £11.78. At £78.12 per 0.01 lot, 0.0015 lot is ~£11.7.
    const r = evaluatePerTradeRisk({ ...base, volume: 0.0015 });
    expect(r.evaluable).toBe(true);
    expect(r.allowed).toBe(true);
    expect(r.riskPct).toBeLessThan(2);
  });

  it('the boundary is INCLUSIVE — exactly the cap passes', () => {
    // Construct risk exactly at 2% of equity: 0.02 × 1000 = 20, with unit multipliers.
    const r = evaluatePerTradeRisk({
      ...base,
      stopDistance: 20, volume: 1, contractSize: 1, conversionRate: 1, equity: 1000, capPct: 2,
    });
    expect(r.riskPct).toBe(2);
    expect(r.allowed).toBe(true);
  });

  it('one tick of extra risk over the boundary fails', () => {
    const r = evaluatePerTradeRisk({
      ...base,
      stopDistance: 20.01, volume: 1, contractSize: 1, conversionRate: 1, equity: 1000, capPct: 2,
    });
    expect(r.riskPct).toBeGreaterThan(2);
    expect(r.allowed).toBe(false);
  });

  it('a PER-BOT cap is honoured and named — that is what makes it a strategy knob', () => {
    const tight = evaluatePerTradeRisk({ ...base, volume: 0.0015, capPct: 0.5, capSource: 'bot "Gold 4H" maxTradeRiskPct' });
    const loose = evaluatePerTradeRisk({ ...base, volume: 0.0015, capPct: 5, capSource: 'risk.maxTradeRiskCeilingPct' });
    expect(tight.riskPct).toBeCloseTo(loose.riskPct, 6); // same trade …
    expect(tight.allowed).toBe(false);                   // … different verdicts
    expect(loose.allowed).toBe(true);
    expect(tight.reason).toContain('maxTradeRiskPct');
  });

  describe('cannot judge → REFUSES, never passes', () => {
    const cases: [string, Partial<PerTradeRiskInput>][] = [
      ['no stop distance (a bot with slPct 0 kills the stop)', { stopDistance: 0 }],
      ['NaN stop distance', { stopDistance: Number.NaN }],
      ['no volume', { volume: 0 }],
      ['no contract size', { contractSize: 0 }],
      ['no conversion rate', { conversionRate: 0 }],
      ['no equity', { equity: 0 }],
      ['negative equity', { equity: -5 }],
    ];
    for (const [name, patch] of cases) {
      it(`${name} refuses and names the input`, () => {
        const r = evaluatePerTradeRisk({ ...base, ...patch });
        expect(r.evaluable).toBe(false);
        expect(r.allowed).toBe(false);
        expect(r.reason).toMatch(/Cannot measure the money at risk/);
      });
    }

    it('an unusable CAP refuses — it is never read as "no limit"', () => {
      for (const capPct of [0, -1, Number.NaN]) {
        const r = evaluatePerTradeRisk({ ...base, capPct });
        expect(r.allowed).toBe(false);
        expect(r.evaluable).toBe(false);
        expect(r.reason).toContain('a cap that cannot be read must not be treated as absent');
      }
    });
  });
});

