import { RiskGatingEngine } from './risk-gating-engine.service';

describe('RiskGatingEngine', () => {
  const engine = new RiskGatingEngine();

  it('preserves a hard-gate veto and reports its aggregate risk', () => {
    const result = engine.apply(100, [{
      directiveId: 'budget-gate',
      name: 'Budget Gate',
      score: 0,
      maxScore: 100,
      reason: 'limit reached',
    }]);

    expect(result.finalScore).toBe(0);
    expect(result.multiplier).toBe(0);
    expect(result.hardGateTriggered).toBe(true);
    expect(result.riskScore).toBe(100);
  });

  it('computes riskScore from rules that take continue branches', () => {
    const result = engine.apply(100, [{
      directiveId: 'volatility-regime',
      name: 'Volatility',
      score: 50,
      maxScore: 100,
      reason: 'elevated',
    }]);

    expect(result.hardGateTriggered).toBe(false);
    expect(result.multiplier).toBeCloseTo(0.85, 3);
    expect(result.riskScore).toBe(50);
  });

  it('handles an invalid zero maximum without producing NaN', () => {
    const result = engine.apply(100, [{
      directiveId: 'volatility-regime',
      name: 'Invalid',
      score: 0,
      maxScore: 0,
      reason: 'invalid maximum',
    }]);
    expect(Number.isFinite(result.multiplier)).toBe(true);
    expect(result.riskScore).toBe(100);
  });
});
