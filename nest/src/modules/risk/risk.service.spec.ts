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
   * #899 (2026-09-19) — the cap measures the SYMBOL (existing exposure + this order), not one order.
   *
   * The owner's design is one protocol driving several bots on the same symbol, with the explicit
   * constraint "…for the same symbol, but not increasing risk". Before this fix, that guarantee did
   * not exist: three bots at 20% each put 60% on one instrument while every check passed. Each call
   * was individually correct and the SUM was unguarded — `maxPositions` counts positions, not
   * exposure, so it could never cover it.
   */
  it('blocks the SECOND bot on the same symbol once the total crosses the cap (#899)', () => {
    // Bot A opens at 20% — passes, as one order.
    expect(riskService.canOpenPosition(1, 1000, 200, profile(), 0).allowed).toBe(true);
    // Bot B opens another 20% on the SAME symbol — 40% total. Before #899 this ALSO passed.
    const botB = riskService.canOpenPosition(1, 1000, 200, profile(), 200);
    expect(botB.allowed).toBe(false);
    expect(botB.reason).toContain('40.0%');
    // The reason must expose the existing term — otherwise "40% from a 20% order" is inexplicable
    // from the record, which is the #865 lesson applied to the new parameter.
    expect(botB.reason).toContain('already open on this symbol');
    expect(botB.reason).toContain('200.00');
  });

  it('is inclusive at exactly the cap, existing exposure included (#899 boundary)', () => {
    // 240 existing + 10 new = 250 of 1000 = exactly 25% — the cap is "exceeds", not "reaches".
    expect(riskService.canOpenPosition(1, 1000, 10, profile(), 240).allowed).toBe(true);
    // A hair over the boundary flips it.
    expect(riskService.canOpenPosition(1, 1000, 10.01, profile(), 240).allowed).toBe(false);
  });

  it('an order that fits alone is still blocked when the symbol is already loaded (#899)', () => {
    // The precise reported shape: the incoming ORDER is small (4%), the SYMBOL is not (23% + 4%).
    expect(riskService.canOpenPosition(1, 1000, 40, profile(), 0).allowed).toBe(true);
    const blocked = riskService.canOpenPosition(1, 1000, 40, profile(), 230);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain('27.0%');
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
