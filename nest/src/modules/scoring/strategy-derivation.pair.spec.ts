/**
 * #1212 — a DECLARED experiment pair is not a duplication fault.
 *
 * ⚠️ MEASURED CASE. `DAX Five Pound Target Bot` and `DAX Index Tick Scalp Bot` share a strategy key,
 * so the detector warned: "identical … should not both exist". Both claims were wrong — the first was
 * created by COPYING the second (`duplicatedFromId`), and they differ in `takeProfitAmount` (5 vs
 * null), which is not part of the hashed treatment. Acting on that warning would have deleted one arm
 * of a money-take-profit experiment.
 *
 * These tests pin the distinction in both directions: an experiment must NOT be flagged, and an
 * accidental duplicate must still be.
 */
import { StrategyDerivationService } from './strategy-derivation.service';

/** Minimal bot row for the derivation; every field the service reads, with neutral defaults. */
function bot(overrides: Record<string, unknown>) {
  return {
    id: 'bot-a',
    name: 'Bot A',
    symbol: 'GER40',
    brokerId: 'mt5',
    active: true,
    protocolId: 'dax-speed-v1-long',
    shortProtocolId: null,
    scoringStrategyId: null,
    minComposite: 10,
    baseSize: 0.1,
    slPct: 0.4,
    tpPct: 0.6,
    maxHoldHours: null,
    cooldownMinutes: 5,
    maxPyramidTiers: 1,
    timeframe: '5m',
    sessionWindow: '["london"]',
    exitBeforeUtc: null,
    mode: 'auto',
    maxPositions: 1,
    maxDailyLoss: null,
    useRaritySizing: true,
    maxSize: null,
    duplicatedFromId: null,
    takeProfitAmount: null,
    protocols: [{ protocolId: 'dax-speed-v1-long', role: 'long' }],
    ...overrides,
  };
}

function makeService(bots: unknown[]) {
  const prisma = { tradingStrategy: { findMany: jest.fn().mockResolvedValue(bots) } };
  const service = new StrategyDerivationService(prisma as never);
  // Silence the service's own logging; the assertions read the result, not the log text.
  (service as unknown as { logger: Record<string, () => void> }).logger = {
    log: () => {}, warn: () => {}, debug: () => {}, error: () => {},
  };
  return service;
}

const control = bot({ id: 'ctrl', name: 'DAX Index Tick Scalp Bot', takeProfitAmount: null });
const variant = bot({
  id: 'var',
  name: 'DAX Five Pound Target Bot',
  takeProfitAmount: 5,
  duplicatedFromId: 'ctrl',
});

describe('duplicate detection distinguishes an experiment from a fault (#1212)', () => {
  it('a copy differing in takeProfitAmount is a DIFFERENT STRATEGY, not a pair (#1224)', async () => {
    // v1 hashed neither takeProfitAmount nor any other money field, so these two shared a key and the
    // registry reported one strategy with a hidden difference. v2 gives each its own identity.
    const res = await makeService([control, variant]).deriveAll();
    expect(res.strategies).toHaveLength(2);
    expect(res.duplicateGroups).toBe(0);
    expect(res.declaredPairs).toBe(0);
    const keys = res.strategies.map((s) => s.strategyKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys.every((k) => k.startsWith('v2:'))).toBe(true);
  });

  it('a copy differing only in MAGIC is still a pair — magic is not identity', async () => {
    // The residue the pair report still covers after #1224: same key, different per-order magic.
    const magicCopy = bot({ id: 'mag', name: 'Magic Copy', magic: 12345, duplicatedFromId: 'ctrl' });
    const res = await makeService([control, magicCopy]).deriveAll();
    expect(res.declaredPairs).toBe(1);
    expect(res.strategies[0].pairDifferingFields).toContain('magic');
  });

  it('two bots with the same config and NO lineage are still a duplication fault', async () => {
    const res = await makeService([control, bot({ id: 'twin', name: 'Twin Bot' })]).deriveAll();
    expect(res.duplicateGroups).toBe(1);
    expect(res.declaredPairs).toBe(0);
    expect(res.strategies[0].pairDeclared).toBe(false);
  });

  it('three take-profit arms are three strategies, not one family (#1224)', async () => {
    const second = bot({ id: 'var2', name: 'DAX Ten Pound Bot', takeProfitAmount: 10, duplicatedFromId: 'ctrl' });
    const res = await makeService([control, variant, second]).deriveAll();
    expect(res.strategies).toHaveLength(3);
    expect(res.duplicateGroups).toBe(0);
    expect(res.declaredPairs).toBe(0);
  });

  it('a copy pointing OUTSIDE the group is not a declared pair — lineage must be inside it', async () => {
    const stray = bot({ id: 'stray', name: 'Stray Copy', duplicatedFromId: 'some-other-bot' });
    const res = await makeService([control, stray]).deriveAll();
    expect(res.duplicateGroups).toBe(1);
    expect(res.declaredPairs).toBe(0);
  });

  it('two roots and one copy is a fault — there is no single control', async () => {
    const secondRoot = bot({ id: 'ctrl2', name: 'Second Control' });
    const res = await makeService([control, secondRoot, variant]).deriveAll();
    expect(res.duplicateGroups).toBe(1);
    expect(res.declaredPairs).toBe(0);
  });

  it('a pair that differs in NOTHING is still reported as a pair — but with no differing fields named', async () => {
    const exactCopy = bot({ id: 'exact', name: 'Exact Copy', duplicatedFromId: 'ctrl' });
    const res = await makeService([control, exactCopy]).deriveAll();
    expect(res.declaredPairs).toBe(1);
    expect(res.strategies[0].pairDifferingFields).toEqual([]);
  });
});
