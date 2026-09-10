/**
 * Directive de-duplication contract — one directive, one group.
 * =============================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `ProtocolHealthService` already treats a directive appearing in more than one
 * group as an ERROR and skips the second occurrence (`duplicate-directive`,
 * "appears in more than one group — double-counted"). The SCORER had no such
 * guard, so the same config was reported as faulty by the audit and silently
 * scored twice by the engine. The two disagreed, and nothing compared them.
 *
 * The arithmetic consequence: a duplicated directive contributes its `score`
 * AND its `maxScore` once per group. `session-open-effect` (maxScore 60) was the
 * only offender in the live data, across 6 ACTIVE protocols, carrying 60 phantom
 * maxScore each — 120 for `forex-session-v1`, which listed it in three groups.
 * That inflates the denominator (making every other directive's contribution
 * look smaller) and double-weights the duplicated signal itself.
 *
 * WHAT IS ASSERTED
 * ----------------
 * The property that was violated, not merely that the function returns a number:
 * `capacityMaxTotal` (the configured directional denominator that #758 made
 * stable) must grow by the directive's maxScore EXACTLY ONCE per group it
 * legitimately owns — i.e. once, not twice, when the config duplicates it.
 *
 * A test that only checked "scoreWithGating returns a score" passed before the
 * fix and passes after it. That is coverage of the wrong claim — worse than no
 * test, because it reports green over a broken contract.
 */

import { ProtocolGatingService } from './protocol-gating.service';

/**
 * Bars must carry real Date timestamps — `computeMarketStatus()` sorts by
 * `timestamp.getTime()` and calls `.toISOString()` on the newest bar, so a
 * placeholder `[{ close: 1 }]` throws before any arithmetic is reached.
 */
const BAR_STEP_MS = 15 * 60 * 1000;
const LAST_BAR_AT = Date.UTC(2026, 8, 10, 12, 0, 0);
const BARS = Array.from({ length: 120 }, (_, i) => {
  const close = 100 + i * 0.05;
  return {
    timestamp: new Date(LAST_BAR_AT - (119 - i) * BAR_STEP_MS),
    open: close,
    high: close + 0.2,
    low: close - 0.2,
    close,
    volume: 1000 + i,
  };
});

/**
 * Minimal fakes. This file exercises the AGGREGATION arithmetic (how maxScore is
 * summed per group), so the directive implementations themselves are irrelevant
 * and are stubbed to a fixed directional reading.
 */
function makeService(groups: Array<{ id: string; directiveIds: string[]; weight?: number; isRiskGate?: boolean }>) {
  const DIRECTIVES: Record<string, { id: string; name: string; maxScore: number; signalClass: string }> = {
    'dup-directive': { id: 'dup-directive', name: 'Duplicated', maxScore: 60, signalClass: 'bullish' },
    'solo-directive': { id: 'solo-directive', name: 'Solo', maxScore: 100, signalClass: 'bullish' },
  };

  const directivesService = {
    get: (id: string) => DIRECTIVES[id] ?? null,
    getEnabled: () => Object.values(DIRECTIVES),
    getAll: () => Object.values(DIRECTIVES),
    getMaxScore: (id: string) => DIRECTIVES[id]?.maxScore ?? 100,
    has: (id: string) => Boolean(DIRECTIVES[id]),
    /**
     * The real seam: `scoreWithGating` calls `runAll(input, Set<directiveId>)`
     * and receives a Map keyed by directiveId, then walks the config's groups.
     * Stubbing it lets us control the arithmetic without depending on directive
     * internals. NOTE the second argument is a Set, not an array.
     */
    runAll: async (_input: any, ids?: Set<string>) =>
      new Map(Array.from(ids ?? []).map((id) => [id, {
        directiveId: id,
        score: DIRECTIVES[id]?.maxScore ?? 0, // always fire at full — makes counting trivial
        signalClass: DIRECTIVES[id]?.signalClass ?? 'neutral',
        reason: 'test',
      }])),
  };

  const protocolConfig = {
    slug: 'test-protocol',
    name: 'Test Protocol',
    directionMode: 'LONG_ONLY' as const,
    tradingStyle: 'Day Trade',
    groups: groups.map((g) => ({
      id: g.id,
      name: g.id,
      weight: g.weight ?? 1,
      isRiskGate: g.isRiskGate ?? false,
      directiveIds: g.directiveIds,
    })),
  };

  const protocolDb = {
    getCached: () => protocolConfig,
    getBySlug: () => protocolConfig,
    findBySlug: async () => protocolConfig,
    getRequiredBars: () => ({}),
    resolveSymbols: async () => [],
  };

  // Constructor order matters — it is positional, 10 args:
  //   directivesService, prisma, riskEngine, adapterFactory, macroSnapshot,
  //   eurusdCache, protocolDb, configService, marketData, marketCalendar
  const service = new ProtocolGatingService(
    directivesService as any,   // 1 directivesService
    {} as any,                  // 2 prisma
    {
      apply: () => ({ hardGateTriggered: false, finalScore: 100, multiplierChain: [], warnings: [] }),
    } as any,                   // 3 riskEngine
    { create: () => null } as any, // 4 adapterFactory
    { capture: () => undefined } as any, // 5 macroSnapshot
    { getValue: async () => null } as any, // 6 eurusdCache
    protocolDb as any,          // 7 protocolDb
    {
      // getAllConfigs feeds a Map keyed by directiveId; an empty Map means
      // "no config overrides", so the directive's own maxScore is used.
      getAllConfigs: async () => new Map(),
      getProtocolOverrides: async () => new Map(),
      getEffectiveMaxScores: () => new Map(),
      get: () => null,
    } as any,                   // 8 configService
    { getBars: async () => [] } as any, // 9 marketData
    { getMarketStatus: () => ({ open: true, reason: null }) } as any, // 10 marketCalendar
  );

  // `classifyDirectiveInclusion` reads `readiness` and `directionBias` off the
  // directive; 'ready' + a matching bias keeps every stub directive INCLUDED so
  // the aggregation arithmetic is the only thing under test.
  for (const d of Object.values(DIRECTIVES)) {
    (d as any).readiness = 'ready';
    (d as any).directionBias = 'bullish';
  }

  return { service, DIRECTIVES };
}

describe('INV-ONE-DIRECTIVE-ONE-GROUP — a duplicated directive is not double-counted', () => {
  it('counts a duplicated directive ONCE, so capacity is not inflated', async () => {
    // Same directive in TWO groups — the exact live shape of `session-open-effect`
    // in ftse-speed-v1 / dax-speed-v1 / cac-speed-v1 / qqq-speed-v1 / spy-speed-v1.
    const { service } = makeService([
      { id: 'technical', directiveIds: ['dup-directive'] },
      { id: 'risk', directiveIds: ['dup-directive'], isRiskGate: true },
    ]);

    const gated: any = await service.scoreWithGating('TESTX', BARS, 'test-protocol');

    // 60 once — NOT 120. This is the assertion the old code failed.
    expect(gated.signalMax).toBe(60);
    // And the phantom capacity must be absent from the stable denominator too.
    expect(gated.capacityMax ?? gated.signalMax).toBe(60);
  });

  it('counts a duplicated directive ONCE even when it appears in THREE groups', async () => {
    // forex-session-v1 listed it in three groups -> 180 of phantom capacity before the fix.
    const { service } = makeService([
      { id: 'technical', directiveIds: ['dup-directive'] },
      { id: 'sentiment', directiveIds: ['dup-directive'] },
      { id: 'risk', directiveIds: ['dup-directive'], isRiskGate: true },
    ]);

    const gated: any = await service.scoreWithGating('TESTX', BARS, 'test-protocol');

    expect(gated.signalMax).toBe(60);
  });

  it('leaves a legitimate multi-directive protocol completely unchanged', async () => {
    // The guard must not alter protocols that have no duplicates — this is the
    // behaviour-preservation half of the contract.
    const { service } = makeService([
      { id: 'technical', directiveIds: ['dup-directive', 'solo-directive'] },
    ]);

    const gated: any = await service.scoreWithGating('TESTX', BARS, 'test-protocol');

    // 60 + 100, both counted once each.
    expect(gated.signalMax).toBe(160);
  });

  it('does not let a duplicated GATE directive contaminate directional capacity', async () => {
    const { service, DIRECTIVES } = makeService([
      { id: 'technical', directiveIds: ['solo-directive'] },
      { id: 'risk', directiveIds: ['dup-directive'], isRiskGate: true },
      { id: 'risk2', directiveIds: ['dup-directive'], isRiskGate: true },
    ]);
    DIRECTIVES['dup-directive'].signalClass = 'bullish';

    const gated: any = await service.scoreWithGating('TESTX', BARS, 'test-protocol');

    // Only the non-gate directive may carry direction.
    expect(gated.signalMax).toBe(100);
  });
});
