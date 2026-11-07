/**
 * signal-envelope-empty-not-scored.spec.ts — a measurement that never happened must not count as one.
 *
 * THE DEFECT THIS PINS (#1236, measured 2026-11-07)
 * ─────────────────────────────────────────────────
 * `leverage-v2-long` reported `state: 'scoring', symbolsScored: 79, symbolsResolved: 79` while
 * `score_snapshot` held **zero** rows for it, all time, and `score` held zero too. Its symbol list was
 * 79 leveraged ETP tickers, of which only **11 exist in the `symbol` table** — so 68 of them resolve
 * to no symbol row and no bars.
 *
 * The mechanism: `emptyEnvelope()` returned `signal: 'HOLD'` with **no `noData` flag at all**. The
 * counter in `buildBestLadder` is
 *
 *     const noData = (env as any).noData === true || env.signal === 'NO_DATA';
 *     if (noData) continue;
 *     protoScored++;                       // ← an empty envelope passed the test and was counted
 *
 * so every symbol the pipeline had merely *looked at* was reported as a **score**. That is #758's
 * defect re-entering through the one path #758 did not mark — and it is the worse half of it,
 * because #758's fix is what makes `symbolsScored` a number anyone trusts.
 *
 * ⚠️ The `noData` field is accessed with `as any` in the service and was **absent from the
 * `SignalEnvelope` interface**, so nothing could complain when a new empty path omitted it. Both are
 * fixed here: the field is typed, and every empty path sets it.
 *
 * ⚠️ WHY BOTH DIRECTIONS. A flag that is always `true` would make these first two tests pass while
 * breaking every real score — the canary below asserts a LIVE envelope does NOT carry `noData`, so
 * the guard cannot be satisfied by blanket-true.
 */
import { SignalEnvelopeService } from './signal-envelope.service';

describe('SignalEnvelopeService — an empty envelope is an ABSENCE, not a score (#1236)', () => {
  let scoreWithGating: jest.Mock;
  let barsByTf: Record<string, any[]>;
  let symbolRow: any;

  const barsAt = (iso: string) => [{ timestamp: iso, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
  const fresh = () => new Date().toISOString();

  const makeService = () => {
    const prisma: any = { symbol: { findFirst: jest.fn(async () => symbolRow) } };
    const protocolDb: any = {
      getCached: jest.fn(() => ({ recommendedTimeframe: '1m', groups: [] })),
      findBySlug: jest.fn(async () => ({ recommendedTimeframe: '1m', groups: [] })),
      getRequiredBars: jest.fn(() => ({})),
      getBaseBarCount: jest.fn(() => 100),
    };
    const marketData: any = { getBars: jest.fn(async (_id: string, tf: string) => barsByTf[tf] ?? []) };
    const stub = {} as any;
    const svc = new SignalEnvelopeService(
      prisma, { scoreWithGating } as any, protocolDb, marketData,
      stub, stub, stub, stub, stub, { recordOutcomes: jest.fn(async () => 0) } as any,
    );
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((svc as any).logger, 'debug').mockImplementation(() => undefined);
    return svc;
  };

  beforeEach(() => {
    barsByTf = {};
    symbolRow = { id: 'sym-1', ticker: 'TEST' };
    scoreWithGating = jest.fn(async () => ({
      composite: 12, maxPossible: 100, signal: 'HOLD', confidence: 0, breakouts: {}, groups: [],
      subScores: {}, gateResults: [], normalizedScore: 0, gateMultiplier: 1, rarity: null,
      directionMode: 'LONG_ONLY', signalPct: 0, opportunityPct: 0, opportunityScore: 0,
      opportunityMax: 0, riskMultiplier: 1, riskGate: null, signalRaw: 0, signalMax: 100,
      subRawTotals: {}, subMaxTotals: {}, oppRawTotals: {}, oppMaxTotals: {},
      observedSignalMax: 100, configuredSignalMax: 100,
    }));
  });

  it('a symbol that is NOT in the registry is marked noData and never reaches scoring', async () => {
    symbolRow = null;                       // ← the 68-of-79 case
    const env: any = await makeService().buildEnvelope('NOT_REGISTERED');
    expect(env.noData).toBe(true);
    expect(scoreWithGating).not.toHaveBeenCalled();
  });

  it('a registered symbol with NO bars is marked noData and never reaches scoring', async () => {
    barsByTf = {};                          // ← no rows on any cadence
    const env: any = await makeService().buildEnvelope('TEST');
    expect(env.noData).toBe(true);
    expect(scoreWithGating).not.toHaveBeenCalled();
  });

  it('…and BOTH are counted as no-data by the ladder counter’s own predicate', async () => {
    // This is the assertion that would have caught the defect: the counter skips on
    // `env.noData === true || env.signal === 'NO_DATA'`, so an empty envelope must satisfy it.
    symbolRow = null;
    const env: any = await makeService().buildEnvelope('NOT_REGISTERED');
    const wouldBeCountedAsScored = !(env.noData === true || env.signal === 'NO_DATA');
    expect(wouldBeCountedAsScored).toBe(false);
  });

  // ── Canary, the OTHER direction ──────────────────────────────────────────────────────────────
  it('CANARY: a live envelope is NOT marked noData (the flag is not blanket-true)', async () => {
    barsByTf = { '1m': barsAt(fresh()), '1d': barsAt(fresh()), '1h': barsAt(fresh()), '15m': barsAt(fresh()) };
    const env: any = await makeService().buildEnvelope('TEST');
    expect(scoreWithGating).toHaveBeenCalled();
    expect(env.noData).toBeFalsy();
  });
});
