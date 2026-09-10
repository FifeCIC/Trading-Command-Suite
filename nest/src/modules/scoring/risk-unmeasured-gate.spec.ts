import { RiskGatingEngine } from './risk-gating-engine.service';

/**
 * Regression tests for the false HARD GATE that blocked automated trading
 * (discovered 2026-09-10).
 *
 * THE BUG
 * -------
 * `liquidity-check` returns `score: 0` when its stale-data guard trips — i.e.
 * "I could not measure liquidity". `RiskGatingEngine.classifyRule` derived
 * `severity = 1 - score/maxScore = 1.0`, and the `liquidity-check` rule treats
 * `severity > 0.9` as a HARD GATE. So a directive admitting it could not see
 * anything vetoed the whole trade and reported the FALSE reason
 * "Symbol liquidity too low — cannot execute at acceptable spread".
 *
 * Composite 0 then failed the 65 pre-trade gate, so nothing traded.
 *
 * MEASURED BLAST RADIUS (45-minute window, before the fix)
 * -------------------------------------------------------
 *   xau-speed-v1  12 of 22 ticks hard-gated
 *   spy-day-v1    11 of 11  (never once scored non-zero liquidity)
 *   qqq-day-v1    11 of 11
 *   qqq-speed-v1  10 of 11
 *   spy-speed-v1   7 of 7
 *
 * The same symbol alternated between "highly liquid ... 94/100" and
 * "Market closed ... stale" seconds apart.
 *
 * THE PRINCIPLE
 * -------------
 * Absence of evidence is not evidence. An unmeasured reading must contribute no
 * penalty and can never veto — the risk-side twin of INV-STABLE-DENOMINATOR,
 * which already forbids a missing measurement from becoming a phantom zero in
 * the numerator.
 */
describe('RiskGatingEngine — unmeasured readings must never hard-gate', () => {
  const engine = new RiskGatingEngine();

  const unmeasuredLiquidity = {
    directiveId: 'liquidity-check',
    name: 'Liquidity Check',
    score: 0,
    maxScore: 100,
    reason: 'Market closed — liquidity is not scored on stale data.',
    unmeasured: true,
  };

  it('does NOT veto a trade when liquidity could not be measured', () => {
    const result = engine.apply(100, [unmeasuredLiquidity]);

    // The regression: this used to be 0 / true, killing every trade.
    expect(result.hardGateTriggered).toBe(false);
    expect(result.finalScore).toBe(100);
    expect(result.multiplier).toBe(1);
  });

  it('records the skip in the multiplier chain without touching the score', () => {
    const result = engine.apply(100, [unmeasuredLiquidity]);

    expect(result.multiplierChain).toHaveLength(1);
    expect(result.multiplierChain[0].tier).toBe('unmeasured');
    expect(result.multiplierChain[0].multiplier).toBe(1);
    // The directive's own reason survives, so the log explains itself.
    expect(result.multiplierChain[0].reason).toContain('not scored on stale data');
    expect(result.warnings).toHaveLength(0);
  });

  it('does NOT drag riskScore toward "extreme risk"', () => {
    // An unmeasured directive carries weight 0, so it cannot make the aggregate
    // risk read as maximal. Previously severity 1.0 * weight 1.0 -> riskScore 100.
    const result = engine.apply(100, [unmeasuredLiquidity]);
    expect(result.riskScore).toBe(50); // neutral, not 100
  });

  it('STILL vetoes a genuinely measured illiquidity', () => {
    // The guard must not disarm the gate — only stop it misfiring on no-data.
    // score 5/100 -> severity 0.95 > 0.9 -> hard gate, and here that is CORRECT.
    const result = engine.apply(100, [{
      directiveId: 'liquidity-check',
      name: 'Liquidity Check',
      score: 5,
      maxScore: 100,
      reason: 'Illiquid: spread far too wide.',
      unmeasured: false,
    }]);

    expect(result.hardGateTriggered).toBe(true);
    expect(result.finalScore).toBe(0);
  });

  it('treats an absent flag as MEASURED, preserving existing behaviour', () => {
    // Only an explicit `unmeasured: true` skips. Every existing caller that
    // omits the field keeps the previous semantics, so this change cannot
    // silently disarm any other directive's gate.
    const result = engine.apply(100, [{
      directiveId: 'liquidity-check',
      name: 'Liquidity Check',
      score: 0,
      maxScore: 100,
      reason: 'measured zero',
    }]);

    expect(result.hardGateTriggered).toBe(true);
    expect(result.finalScore).toBe(0);
  });

  it('lets a measurable risk still compound while an unmeasured one is ignored', () => {
    // A mixed tick: liquidity cannot be read, but volatility genuinely is
    // elevated. The trade should be penalised by the real signal only.
    const result = engine.apply(100, [
      unmeasuredLiquidity,
      {
        directiveId: 'volatility-regime',
        name: 'Volatility',
        score: 50,
        maxScore: 100,
        reason: 'elevated',
      },
    ]);

    expect(result.hardGateTriggered).toBe(false);
    expect(result.multiplier).toBeCloseTo(0.85, 3);
    expect(result.riskScore).toBe(50);
  });
});
