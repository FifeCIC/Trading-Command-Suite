/**
 * cost-divergence.spec.ts — canary for `describeCostDivergence()`.
 *
 * ⚠️ WHY THIS FILE EXISTS: that function is the ONLY thing standing between a reader and a
 * comparison of two runs that were costed differently. Measured 2026-11-13 — it had **no test at
 * all**, while the stored data proves the cost model changed under it:
 *
 *   | era  | fingerprint                    | runs  |
 *   |------|--------------------------------|-------|
 *   | pre  | `0.01 / 0.01 / 0`              |    22 |  ← round, hand-set constant
 *   | post | `0.00003358954693304877 / …`   |  1404 |  ← 17 significant digits, computed per symbol
 *
 * Those two are **298× apart** on the spread alone. If this guard stops firing, every old-vs-new
 * comparison silently credits a cost change to the protocol — the "plausible numbers, no error"
 * shape this repo treats as its most expensive defect.
 *
 * The three states the function must keep apart (from its own docblock):
 *   · all recorded and identical  → silent
 *   · all recorded and different  → name both sides
 *   · not recorded on one or both → say so and STOP (unknown is not equal)
 *
 * Each test below is written so that DELETING or INVERTING the corresponding branch makes it fail.
 */
import { describeCostDivergence, type CostFacts } from './backtest.service';

const run = (
  id: string,
  costs: Partial<CostFacts['costs']> & { recorded?: boolean } = {},
  overrides: Partial<CostFacts> = {},
): CostFacts => ({
  id,
  protocolId: 'spy-speed-v1',
  timeframe: '1h',
  costs: {
    recorded: costs.recorded ?? true,
    slippage: costs.slippage ?? 0.0004,
    spread: costs.spread ?? 0.00003358954693304877,
    commission: costs.commission ?? 0,
    positionModel: costs.positionModel ?? 'risk',
    accountSize: costs.accountSize ?? 10000,
    riskPct: costs.riskPct ?? 1,
  },
  ...overrides,
});

describe('describeCostDivergence', () => {
  it('is silent for a single run — there is no second side to disagree', () => {
    expect(describeCostDivergence([run('a')])).toBeNull();
    expect(describeCostDivergence([])).toBeNull();
  });

  it('is silent when both runs costed and sized identically', () => {
    expect(describeCostDivergence([run('a'), run('b')])).toBeNull();
  });

  it('names BOTH sides when the execution costs differ — the pre-vs-post era case', () => {
    // The measured pair: a hand-set 1% constant against a per-symbol quote.
    const message = describeCostDivergence([
      run('old00001', { spread: 0.01, slippage: 0.01 }),
      run('new00001'),
    ]);

    expect(message).toContain('NOT A CLEAN COST PAIR');
    expect(message).toContain('DIFFERENT execution costs');
    // Both run ids must appear, or the reader cannot tell WHICH side was the expensive one.
    expect(message).toContain('old00001');
    expect(message).toContain('new00001');
    // Both fingerprints must appear — the numbers are the evidence, not a summary of them.
    expect(message).toContain('0.01/0.01/0');
    expect(message).toContain('0.00003358954693304877/0.0004/0');
  });

  it('reports UNKNOWN (not "different") when a run has no recorded costs', () => {
    const message = describeCostDivergence([
      run('known001'),
      run('unknown1', { recorded: false, spread: null, slippage: null, commission: null }),
    ]);

    expect(message).toContain('EXECUTION COSTS ARE UNKNOWN');
    expect(message).toContain('1 of 2');
    expect(message).toContain('unknown1');
    expect(message).toContain('Unknown is not the same as equal');
    // ⚠️ It must NOT also claim a cost difference: the values are absent, not divergent. Asserting
    // "different" here would be inventing a finding out of a missing column.
    expect(message).not.toContain('DIFFERENT execution costs');
  });

  it('puts UNKNOWN ahead of DIFFERENT — an unrecorded side cannot be compared at all', () => {
    // One run recorded 1%, the other recorded nothing. The recorded pair here genuinely differs
    // too, so the ordering matters: "unknown" is the stronger, blocking statement.
    const message = describeCostDivergence([
      run('a1', { spread: 0.01, slippage: 0.01 }),
      run('b1', { recorded: false, spread: null, slippage: null, commission: null }),
    ]);

    expect(message).toContain('EXECUTION COSTS ARE UNKNOWN');
    expect(message).not.toContain('NOT A CLEAN COST PAIR');
  });

  it('distinguishes a SIZING difference from a COST difference', () => {
    const message = describeCostDivergence([
      run('small', { accountSize: 10000, riskPct: 1 }),
      run('large', { accountSize: 100000, riskPct: 2 }),
    ]);

    expect(message).toContain('DIFFERENT position sizing');
    expect(message).toContain('10000');
    expect(message).toContain('100000');
    // Costs were identical, so that clause must NOT appear.
    expect(message).not.toContain('DIFFERENT execution costs');
  });

  it('names both kinds when costs AND sizing differ', () => {
    const message = describeCostDivergence([
      run('one', { spread: 0.01, slippage: 0.01, accountSize: 10000 }),
      run('two', { accountSize: 50000 }),
    ]);

    expect(message).toContain('DIFFERENT execution costs');
    expect(message).toContain('DIFFERENT position sizing');
  });

  it('stays SILENT on identical numbers even if they were arrived at differently', () => {
    // #1154's residual, encoded as a decision: `0.01/0.01/0` exists in BOTH eras (22 pre, 7 post).
    // The guard treats that as a clean pair, and it is right to — the same cost was applied to the
    // fill. HOW the number was chosen does not enter P&L, so warning here would be noise, and a
    // guard that over-fires gets allowlisted and then covers nothing.
    expect(describeCostDivergence([
      run('preEra01', { spread: 0.01, slippage: 0.01 }),
      run('postEra1', { spread: 0.01, slippage: 0.01 }),
    ])).toBeNull();
  });

  it('labels every run with its id, not just protocol@timeframe', () => {
    // Two VARIANTS of one protocol are the primary use of the compare page, and they share
    // protocolId AND timeframe — so a label built from those two names nothing (#1141's docblock).
    const message = describeCostDivergence([
      run('aaaaaaaa-1', { spread: 0.01, slippage: 0.01 }, { protocolId: 'xau-speed-v1', timeframe: '15m' }),
      run('bbbbbbbb-2', {}, { protocolId: 'xau-speed-m15-long', timeframe: '15m' }),
    ]);

    expect(message).toContain('[aaaaaaaa]');
    expect(message).toContain('[bbbbbbbb]');
  });

  it('WARNS rather than refuses — two cost models is a legitimate experiment', () => {
    // From the docblock: this must never throw and must never refuse the comparison the way
    // `windowWarning` does. A different cost model is a question you CAN answer from a compare;
    // two different date windows is not. If this ever starts throwing, that distinction is lost.
    expect(() => describeCostDivergence([run('a', { spread: 0.01 }), run('b')])).not.toThrow();
    expect(typeof describeCostDivergence([run('a', { spread: 0.01 }), run('b')])).toBe('string');
  });
});
