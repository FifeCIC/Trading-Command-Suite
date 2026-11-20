/**
 * selection-profile.spec.ts — the four states a comparison can be in, and the two rules that stop a
 * delta being shown where it would be a lie.
 *
 * ⚠️ THE EXPENSIVE CASE IS `semantics-changed`. A delta across two engine versions is arithmetic about
 * the engine, and it reads exactly like a result. Measured 2026-11-20: the same window gave −1,538.47 /
 * 44 trades and then +767.64 / 29 after one rule reached the engine. Both numbers are real; their
 * difference is not a finding.
 */
import { compareSelections, configChanges, profileKey, profileLabel, SelectionProfile } from './selection-profile';
import { EXECUTION_SEMANTICS } from '../../common/trading/execution-semantics';

const PROFILE: SelectionProfile = {
  datasetName: 'movers-winners-2026-11-11',
  answerDate: '2026-11-11',
  side: 'winners',
  directionMode: 'long',
  protocolId: 'movers-v1-long',
  botId: 'bot-1',
  topN: 1,
  cutoffUtc: '14:30',
};

const TOTALS = { trades: 38, wins: 13, winRate: 34.2105, netPnl: 935.497 };

const stored = (over: Partial<Parameters<typeof compareSelections>[1] & object> = {}) => ({
  id: 'sel-1',
  createdAt: '2026-11-20T18:00:00.000Z',
  engineVersion: '0.169.0',
  semanticsVersion: EXECUTION_SEMANTICS,
  totals: TOTALS,
  config: [
    { id: 'slPct', value: 2.5, applied: true },
    { id: 'tpPct', value: 6, applied: true },
    { id: 'cooldownMinutes', value: 30, applied: false },
  ],
  ...over,
});

describe('profileKey', () => {
  it('is stable and order-independent', () => {
    expect(profileKey(PROFILE)).toBe(profileKey({ ...PROFILE }));
    expect(profileKey(PROFILE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates the factors the owner named — the DAY and the DIRECTION — and every other one', () => {
    const base = profileKey(PROFILE);
    expect(profileKey({ ...PROFILE, answerDate: '2026-11-12' })).not.toBe(base);
    expect(profileKey({ ...PROFILE, directionMode: 'short' })).not.toBe(base);
    expect(profileKey({ ...PROFILE, datasetName: 'movers-losers-2026-11-10' })).not.toBe(base);
    expect(profileKey({ ...PROFILE, botId: null })).not.toBe(base);
    expect(profileKey({ ...PROFILE, topN: 3 })).not.toBe(base);
    expect(profileKey({ ...PROFILE, cutoffUtc: '15:00' })).not.toBe(base);
    expect(profileKey({ ...PROFILE, protocolId: 'movers-v1-short' })).not.toBe(base);
  });

  /**
   * ⚠️ THE CONFIG IS NOT IN THE KEY, AND THIS IS THE ASSERTION THAT KEEPS IT OUT. A bot with a
   * different take-profit is the *point* of re-running; if it entered the key, every re-run after a
   * tuning change would look like a first run and the operator would never see whether it helped.
   */
  it('does NOT include the trade-management config', () => {
    const withConfig = compareSelections({ totals: TOTALS, config: [] }, null, PROFILE);
    const alsoWithConfig = compareSelections(
      { totals: TOTALS, config: [{ id: 'tpPct', value: 99, applied: true }] },
      null,
      PROFILE,
    );
    expect(alsoWithConfig.profileKey).toBe(withConfig.profileKey);
  });
});

describe('profileLabel', () => {
  it('names the day, direction, top-N and rank time, so a delta says which pair it compares', () => {
    expect(profileLabel(PROFILE)).toContain('long');
    expect(profileLabel(PROFILE)).toContain('top 1');
    expect(profileLabel(PROFILE)).toContain('14:30');
    expect(profileLabel(PROFILE)).toContain('movers-winners-2026-11-11');
    expect(profileLabel(PROFILE)).toMatch(/11 Nov/);
  });
});

describe('compareSelections — the four states', () => {
  it('no previous run → no-previous, and NO delta (a first run is the baseline)', () => {
    const c = compareSelections({ totals: TOTALS, config: [] }, null, PROFILE);
    expect(c).toMatchObject({ comparable: false, blockedBy: 'no-previous', delta: null, previous: null });
    expect(c.reason).toMatch(/baseline/);
  });

  it('same semantics → a delta per tile, current minus previous', () => {
    const c = compareSelections(
      {
        totals: { trades: 40, wins: 15, winRate: 37.5, netPnl: 1180 },
        config: [],
      },
      stored(),
      PROFILE,
    );
    expect(c.comparable).toBe(true);
    expect(c.delta).toEqual({ trades: 2, wins: 2, winRate: 3.29, netPnl: 244.5 });
    expect(c.blockedBy).toBeNull();
  });

  it('▶ CANARY — different semantics REFUSES the delta and names both versions', () => {
    const c = compareSelections(
      { totals: TOTALS, config: [], semanticsVersion: EXECUTION_SEMANTICS + 1 },
      stored(),
      PROFILE,
    );
    expect(c.comparable).toBe(false);
    expect(c.blockedBy).toBe('semantics-changed');
    expect(c.delta).toBeNull();
    expect(c.reason).toMatch(/Not comparable/);
    expect(c.reason).toContain(String(EXECUTION_SEMANTICS));
    expect(c.reason).toContain(String(EXECUTION_SEMANTICS + 1));
    // The previous run is still returned — a reader must be able to see WHAT it is being compared with.
    expect(c.previous?.id).toBe('sel-1');
  });

  it('a missing semantics version on the stored row is refused, not assumed equal', () => {
    const c = compareSelections(
      { totals: TOTALS, config: [] },
      stored({ semanticsVersion: null as never }),
      PROFILE,
    );
    expect(c.blockedBy).toBe('semantics-changed');
    expect(c.delta).toBeNull();
  });

  it('a changed config still compares, and reports what changed', () => {
    const c = compareSelections(
      { totals: TOTALS, config: [
        { id: 'slPct', value: 2.5, applied: true },
        { id: 'tpPct', value: 8, applied: true },
        { id: 'cooldownMinutes', value: 30, applied: false },
      ] },
      stored(),
      PROFILE,
    );
    expect(c.comparable).toBe(true);
    expect(c.configChanges).toEqual([{ id: 'tpPct', from: 6, to: 8 }]);
  });

  it('rounds the delta so a tile cannot print floating-point noise', () => {
    const c = compareSelections(
      { totals: { trades: 1, wins: 1, winRate: 0.3, netPnl: 0.3 }, config: [] },
      stored({ totals: { trades: 0, wins: 0, winRate: 0, netPnl: 0 } }),
      PROFILE,
    );
    expect(c.delta?.netPnl).toBe(0.3);
    expect(c.delta?.winRate).toBe(0.3);
  });
});

describe('configChanges', () => {
  it('ignores a field neither run applies — it cannot explain a delta', () => {
    expect(configChanges(
      [{ id: 'cooldownMinutes', value: 30, applied: false }],
      [{ id: 'cooldownMinutes', value: 5, applied: false }],
    )).toEqual([]);
  });

  it('reports a field that moved from applied to not-applied', () => {
    expect(configChanges(
      [{ id: 'takeProfitAmount', value: null, applied: true }],
      [{ id: 'takeProfitAmount', value: 50, applied: false }],
    )).toEqual([{ id: 'takeProfitAmount', from: 50, to: null }]);
  });

  it('ignores a field that is absent on one side rather than inventing a change', () => {
    expect(configChanges([{ id: 'tpPct', value: 6, applied: true }], [])).toEqual([]);
  });
});
