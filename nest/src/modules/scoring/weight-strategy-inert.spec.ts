/**
 * weight-strategy-inert.spec.ts — `weightStrategy` is echoed, not applied
 * ======================================================================
 * Created 2026-09-24 while closing #919.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * #919 asked (item 3): *"Rename `'group-weighted'`. It selects a denominator, not a
 * weighting."* — and a rename was drafted before anyone checked the premise.
 *
 * **The premise is false.** `weightStrategy` is a parameter with a default and it is
 * **never branched on**: it is only echoed into the payload (`meta.weightStrategy`).
 * The denominator is not selected, it is HARDCODED:
 *
 *     denominatorMode: 'configured-capacity',   // protocol-gating.service.ts L1152
 *     configuredSignalMax: capacityMaxTotal,
 *
 * So `'group-weighted'` and `'maxscore-weighted'` currently produce **the same
 * composite**. Renaming the first would have been cosmetic — it would have made the
 * documentation read correctly while leaving a config field that reads as a control
 * and does nothing. That is precisely the defect #919's own item 4 names:
 * *"A registry field that reads as a control and has no effect is the same defect as
 * `timeframe` on a bot."*
 *
 * This test is what makes that a CHECKED property rather than a comment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ IF THIS TEST FAILS, SOMEONE HAS WIRED `weightStrategy` — AND THAT IS A MATHS CHANGE
 * ─────────────────────────────────────────────────────────────────────────────
 * Do **not** weaken this test to make it pass. Two things must happen instead:
 *
 *   1. **Selecting a different denominator changes scores.** `maxscore-weighted` divides
 *      by the OBSERVED evidence sum (market-dependent) instead of the configured
 *      capacity, so the same market condition scores differently between ticks. That is
 *      a maths change → it needs a copied configuration and a monitored comparison
 *      (`.github/instructions/maths-change-requires-ab.instructions.md`), NOT an in-place
 *      edit.
 *   2. The surfaces that present `weightStrategy` and `config.weight` as controls must be
 *      updated in the same change, and the `protocol-gating.service.ts` doc block must
 *      stop describing a selection that now exists.
 *
 * The honest resolution for #919 was to DECLARE the field inert while it is inert, not to
 * rename it into looking active.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS ASSERTED
 * ─────────────────────────────────────────────────────────────────────────────
 * The property, not merely that the function returns a number: **the composite is
 * invariant under every value of `weightStrategy`**, including a value that is not a
 * recognised convention at all. The last one matters — if an unrecognised string ever
 * fell through to a *different* code path, every stored value written before a rename
 * would silently change the score.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProtocolGatingService } from './protocol-gating.service';

/**
 * Bars must carry real Date timestamps — `computeMarketStatus()` sorts by
 * `timestamp.getTime()` and calls `.toISOString()` on the newest bar, so a
 * placeholder `[{ close: 1 }]` throws before any arithmetic is reached.
 * (Pattern copied from `directive-dedupe.spec.ts`, which is proven to run.)
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

const GATING_SERVICE = join(__dirname, 'protocol-gating.service.ts');

function makeService() {
  const DIRECTIVES: Record<string, { id: string; name: string; maxScore: number; signalClass: string }> = {
    'dir-a': { id: 'dir-a', name: 'A', maxScore: 100, signalClass: 'bullish' },
    // ⚠️ `dir-b` MUST stay NEUTRAL at runtime while remaining direction-eligible by CONFIG.
    //
    // This is what makes the equality assertion non-vacuous. The configured denominator counts
    // every direction-eligible directive's maxScore (100 + 60 = 160); the OBSERVED denominator
    // counts only what produced evidence this tick (100). If both directives fired, the two
    // denominators would be EQUAL, `weightStrategy` could select either with no visible
    // difference, and this test would pass for the wrong reason — it would report green over a
    // field that had in fact been wired. Measured 2026-09-24: the first version of this fixture
    // made exactly that mistake, and a canary that wired the field left it passing.
    'dir-b': { id: 'dir-b', name: 'B', maxScore: 60, signalClass: 'neutral' },
  };

  const directivesService = {
    get: (id: string) => DIRECTIVES[id] ?? null,
    getEnabled: () => Object.values(DIRECTIVES),
    getAll: () => Object.values(DIRECTIVES),
    getMaxScore: (id: string) => DIRECTIVES[id]?.maxScore ?? 100,
    has: (id: string) => Boolean(DIRECTIVES[id]),
    runAll: async (_input: any, ids?: Set<string>) =>
      new Map(Array.from(ids ?? []).map((id) => [id, {
        directiveId: id,
        // A neutral directive scores 0 — it produced no directional evidence. It still
        // counts toward the CONFIGURED denominator (see the `dir-b` note above).
        score: DIRECTIVES[id]?.signalClass === 'neutral' ? 0 : (DIRECTIVES[id]?.maxScore ?? 0),
        signalClass: DIRECTIVES[id]?.signalClass ?? 'neutral',
        reason: 'test',
      }])),
  };

  const protocolConfig = {
    slug: 'test-protocol',
    name: 'Test Protocol',
    directionMode: 'LONG_ONLY' as const,
    tradingStyle: 'Day Trade',
    groups: [
      { id: 'technical', name: 'technical', weight: 1, isRiskGate: false, directiveIds: ['dir-a'] },
      { id: 'sentiment', name: 'sentiment', weight: 1, isRiskGate: false, directiveIds: ['dir-b'] },
    ],
  };

  const protocolDb = {
    getCached: () => protocolConfig,
    getBySlug: () => protocolConfig,
    findBySlug: async () => protocolConfig,
    getRequiredBars: () => ({}),
    resolveSymbols: async () => [],
  };

  // Constructor order is positional, 10 args — see directive-dedupe.spec.ts.
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
      getAllConfigs: async () => new Map(),
      getProtocolOverrides: async () => new Map(),
      getEffectiveMaxScores: () => new Map(),
      get: () => null,
    } as any,                   // 8 configService
    { getBars: async () => [] } as any, // 9 marketData
    { getMarketStatus: () => ({ open: true, reason: null }) } as any, // 10 marketCalendar
  );

  // `classifyDirectiveInclusion` reads these; 'ready' + a matching bias keeps every
  // stub directive INCLUDED so the arithmetic is the only thing under test.
  for (const d of Object.values(DIRECTIVES)) {
    (d as any).readiness = 'ready';
    (d as any).directionBias = 'bullish';
  }

  return { service };
}

/** The fields a denominator change would move. Compared as a set, not one by one. */
function reading(gated: any) {
  return {
    signalPct: gated?.signalPct,
    composite: gated?.composite,
    signalMax: gated?.signalMax,
    capacityMax: gated?.capacityMax,
  };
}

describe('#919 — `weightStrategy` is declared inert and IS inert', () => {
  it('the FIXTURE is non-degenerate: configured capacity differs from the observed max', async () => {
    // Without this, every assertion below is vacuous — see the `dir-b` note in makeService().
    // A fixture where the two denominators coincide cannot tell a wired field from an inert one,
    // and would report green over the very defect this file exists to catch.
    const { service } = makeService();
    const gated: any = await service.scoreWithGating('TESTX', BARS, 'test-protocol');

    expect(gated?.meta?.configuredSignalMax).toBe(160);
    expect(gated?.meta?.observedSignalMax).toBe(100);
    expect(gated?.meta?.configuredSignalMax).not.toBe(gated?.meta?.observedSignalMax);
  });

  it('produces an identical reading for both conventions (the field has no effect)', async () => {
    const { service } = makeService();

    const grouped: any = await service.scoreWithGating('TESTX', BARS, 'test-protocol', undefined, 'group-weighted' as any);
    const maxscore: any = await service.scoreWithGating('TESTX', BARS, 'test-protocol', undefined, 'maxscore-weighted' as any);

    // If these ever differ, someone wired the field — read the header before changing this.
    expect(reading(maxscore)).toEqual(reading(grouped));
  });

  it('an UNRECOGNISED value does not fall through to a different reading', async () => {
    // This is the hazard a rename would have introduced: stored values hold the OLD
    // string (measured 2026-09-24: all 28 `scoring_strategy` rows are 'group-weighted').
    // If an unrecognised value took a different path, renaming would silently rescore.
    const { service } = makeService();

    const grouped: any = await service.scoreWithGating('TESTX', BARS, 'test-protocol', undefined, 'group-weighted' as any);
    const junk: any = await service.scoreWithGating('TESTX', BARS, 'test-protocol', undefined, 'not-a-convention' as any);

    expect(reading(junk)).toEqual(reading(grouped));
  });

  it('reports the denominator truthfully as `configured-capacity`', async () => {
    // The vocabulary #919 asked to "reuse" already exists — and it is the hardcoded
    // truth in the payload. The rename was unnecessary; the field was the problem.
    const { service } = makeService();
    const gated: any = await service.scoreWithGating('TESTX', BARS, 'test-protocol');

    expect(gated?.meta?.denominatorMode).toBe('configured-capacity');
  });

  it('still echoes the field into the payload, so it can be DECLARED rather than dropped', async () => {
    // The field is not removed from the payload: `meta.weightStrategy` is what a surface
    // would read to label it display-only. Removing it would delete the evidence that a
    // convention was ever intended.
    const { service } = makeService();
    const gated: any = await service.scoreWithGating('TESTX', BARS, 'test-protocol', undefined, 'maxscore-weighted' as any);

    expect(gated?.meta?.weightStrategy).toBe('maxscore-weighted');
  });

  it('the service source states the field is inert — the reasoning survives in-file', async () => {
    // A comment inside the service is not read by an agent editing for another reason;
    // this asserts the statement is still there so it cannot be quietly deleted.
    const source = readFileSync(GATING_SERVICE, 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    // The composite must not consult weightStrategy: no comparison anywhere in code.
    expect(code).not.toMatch(/weightStrategy\s*(===|!==|==|!=)/);
    expect(code).not.toMatch(/switch\s*\(\s*weightStrategy/);

    // And the DECLARATION must survive in the doc block. Without it the next reader
    // finds a parameter named like a selector and wires it, which is the whole trap.
    expect(source).toMatch(/IS INERT/);
  });
});
