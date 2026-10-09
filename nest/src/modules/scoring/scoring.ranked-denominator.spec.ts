/**
 * #1090 — the ranked DB-read payload must not fabricate a denominator.
 *
 * MEASURED (2026-10-10): `/api/scoring/ranked` reported `maxPossibleScore: 100` for EVERY row
 * while the same row's `score` exceeded it (XAUUSD = 106) and the protocol declares capacities
 * of 910 (directional) / 1010 (total). The real percentage was never `score / 100` — it is the
 * row's own `signalPct` (`normalizedScore`), which `protocol-gating.service.ts` sets as the
 * classifier's percentage: `signalPct = signalRaw / configured DIRECTIONAL capacity`
 * (xau-speed-v1: 10/910 = 1.0989%), while `composite` is a broader raw sum with NO exposed
 * denominator (BTC btc-scalp-v1: composite 30, signalPct 3.21951% ⇒ signalRaw 33 / capacity
 * 1025).
 *
 * So the DB-read path now emits `maxPossibleScore: null` and passes `signalPct` through as
 * `normalizedScore`. These tests pin BOTH halves: the null denominator (no fabrication) AND the
 * percentage passthrough (the number that must survive). Boundary covered: a row with NO stored
 * `signalPct` must yield `normalizedScore: 0` and STILL a null denominator — a missing datum
 * must not silently become a fabricated base.
 *
 * Harness note: `Object.create(ScoringService.prototype)` skips class-field initializers, so
 * every field `rankFromDb` touches is assigned explicitly (modeService, directivesService,
 * prisma, logger). Same technique as `single-scoring-path.spec.ts`.
 */
import { ScoringService } from './scoring.service';

function makeService(prisma: any) {
  const svc = Object.create(ScoringService.prototype) as any;
  svc.prisma = prisma;
  svc.modeService = { getModeInfo: () => ({ mode: 'fallback', database: true, queue: false, redis: false }) };
  svc.directivesService = { list: () => [] };
  svc.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
  return svc as ScoringService;
}

const snapshotRow = (over: Record<string, unknown> = {}) => ({
  id: 'snap-1',
  symbol: 'xauusd',
  composite: 106,
  signalPct: 11.648,
  tradingSignal: 'BUY',
  snappedAt: new Date('2026-10-09T22:10:00Z'),
  protocolId: 'xau-speed-v1',
  ...over,
});

describe('#1090 — rankFromDb emits a null denominator, never 100', () => {
  it('snapshot branch: maxPossibleScore is null and normalizedScore is the stored signalPct', async () => {
    const svc = makeService({
      isAvailable: true,
      scoreSnapshot: { findMany: async () => [snapshotRow()] },
    });

    const result: any = await svc.rankFromDb(5);

    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0].maxPossibleScore).toBeNull();
    expect(result.ranked[0].normalizedScore).toBeCloseTo(11.648, 5);
    expect(result.ranked[0].score).toBe(106);
    expect(result.ranked[0].signal).toBe('BUY');
    expect(result.strategy.maxPossibleScore).toBeNull();
  });

  it('snapshot branch: a row with NO stored signalPct gets 0 — and still no fabricated denominator', async () => {
    const svc = makeService({
      isAvailable: true,
      scoreSnapshot: { findMany: async () => [snapshotRow({ signalPct: null })] },
    });

    const result: any = await svc.rankFromDb(5);

    expect(result.ranked[0].normalizedScore).toBe(0);
    expect(result.ranked[0].maxPossibleScore).toBeNull();
  });

  it('score-table fallback branch: same contract (null + percentage from breakdown.signalPct)', async () => {
    const svc = makeService({
      isAvailable: true,
      scoreSnapshot: { findMany: async () => [] },
      score: {
        findMany: async () => [{
          symbolId: 'sym-1',
          value: 42,
          breakdown: { signalPct: 4.9 },
          symbol: { ticker: 'USDCAD' },
          timestamp: new Date('2026-10-09T21:00:00Z'),
        }],
      },
    });

    const result: any = await svc.rankFromDb(5);

    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0].maxPossibleScore).toBeNull();
    expect(result.ranked[0].normalizedScore).toBeCloseTo(4.9, 5);
    expect(result.strategy.maxPossibleScore).toBeNull();
  });

  it('boundary: TWO rows keep distinct percentages — the denominator is per-row, not a constant', async () => {
    const svc = makeService({
      isAvailable: true,
      scoreSnapshot: {
        findMany: async () => [
          snapshotRow({ id: 'a', symbol: 'BTC', composite: 30, signalPct: 3.219512 }),
          snapshotRow({ id: 'b', symbol: 'XAUUSD', composite: 10, signalPct: 1.0989 }),
        ],
      },
    });

    const result: any = await svc.rankFromDb(5);

    const btc = result.ranked.find((r: any) => r.ticker === 'BTC');
    const xau = result.ranked.find((r: any) => r.ticker === 'XAUUSD');
    expect(btc.normalizedScore).toBeCloseTo(3.219512, 5);
    expect(xau.normalizedScore).toBeCloseTo(1.0989, 5);
    expect(btc.maxPossibleScore).toBeNull();
    expect(xau.maxPossibleScore).toBeNull();
  });
});
