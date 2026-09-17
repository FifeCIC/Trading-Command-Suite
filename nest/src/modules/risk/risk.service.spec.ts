import { RiskService, PortfolioRisk } from './risk.service';

/**
 * RiskService.canOpenPosition() — the gate that refused 78 trades in one day (#865).
 *
 * It had no direct unit coverage before 2026-09-17; its only exercise was indirect, through
 * `assessGlobalRiskLimits`, with a `SIZE` chosen small enough to avoid the allocation branch
 * altogether. So the branch that was actually blocking live trading was never executed by a test.
 *
 * Two properties are asserted here:
 *
 *   1. It reads the cap from the PROFILE, not a literal. The cap used to be hardcoded `0.25` in five
 *      places; if someone reintroduces a literal in this method, the last test fails.
 *   2. The refusal NAMES BOTH NUMBERS. The original reason was
 *      `Allocation 62.7% exceeds max per symbol 25%`, which is true and impossible to act on — it
 *      took an hour and a hand-built probe to discover the estimate was 11x too high. A reason of
 *      `… estimated capital 1160.09 of 1340.00` makes the defect askable from the log alone.
 */
describe('RiskService.canOpenPosition — the per-symbol allocation gate', () => {
  const riskService = new RiskService({ notifyDrawdown: jest.fn() } as any);

  const profile = (over: Partial<PortfolioRisk> = {}): PortfolioRisk => ({
    maxPortfolioRisk: 0.15,
    maxPerTradeRisk: 0.02,
    maxPerSymbol: 0.25,
    maxPositions: 5,
    maxDrawdown: 0.25,
    trailingStopAtProfit: 0.03,
    ...over,
  });

  it('allows an entry when under both caps', () => {
    const r = riskService.canOpenPosition(1, 1000, 100, profile());
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('OK');
  });

  it('blocks when the position count reaches the cap', () => {
    const r = riskService.canOpenPosition(5, 1000, 10, profile());
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('Max positions (5)');
  });

  it('blocks when the allocation exceeds the cap', () => {
    // 250 of 1000 = 25.0%, exactly at the cap. 251 is over it.
    expect(riskService.canOpenPosition(1, 1000, 250, profile()).allowed).toBe(true);
    const over = riskService.canOpenPosition(1, 1000, 251, profile());
    expect(over.allowed).toBe(false);
    expect(over.reason).toContain('25.1%');
  });

  /**
   * REGRESSION GUARD — the reason must carry the NUMBERS, not only the ratio.
   *
   * Reproduces the measured live case: `estimated capital 1160.09 of 1340.00`. That pair is what
   * exposes the defect, because the reader can immediately ask "why is a 0.1-lot position £1,160?"
   */
  it('names the estimate and the portfolio value in the refusal', () => {
    const r = riskService.canOpenPosition(1, 1340, 1160.09, profile());
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('1160.09');
    expect(r.reason).toContain('1340.00');
    // …and still carries the ratio, which is what a UI shows first.
    expect(r.reason).toContain('86.6%');
    expect(r.reason).toContain('25%');
  });

  it('reads the cap from the profile — a literal here would be a fifth copy of the number', () => {
    // Same allocation (30%), two different declared caps: one refuses, one permits. If the method
    // hardcoded 0.25 this pair would return the same verdict.
    const strict = riskService.canOpenPosition(1, 1000, 300, profile({ maxPerSymbol: 0.25 }));
    const loose = riskService.canOpenPosition(1, 1000, 300, profile({ maxPerSymbol: 0.5 }));
    expect(strict.allowed).toBe(false);
    expect(loose.allowed).toBe(true);
  });

  it('treats a zero portfolio value as zero allocation rather than dividing by zero', () => {
    const r = riskService.canOpenPosition(0, 0, 100, profile());
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('OK');
  });
});
