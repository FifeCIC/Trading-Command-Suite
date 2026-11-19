/**
 * signal-envelope-unread-and-unresolved.spec.ts — two ways the drilldown answered a question it
 * had not been able to ask (#1267, measured 2026-11-19).
 *
 * 1 · CONFIDENCE ON AN UNREAD TICK
 * `GET /api/signals/envelope/{GER40,XAUUSD,EURUSD}?protocol=euro-stoxx-v1-long` returned
 * `signal: NO_DATA, composite: 0, confidence: 35, groups: 3` for all three. Three unrelated
 * symbols agreeing on 35 is arithmetic over an ABSENCE, not a measurement:
 * `computeConfidence()` starts at a base of 50 and subtracts `min(|0 − 65| * 0.3, 15)` = 15.
 *
 * ⚠️ THE SCORER ALREADY ANSWERED CORRECTLY. `protocol-gating.service.ts` returns `confidence: 0`
 * on its NO_DATA path; `enrichEnvelope()` overwrote it. Confidence is a claim about evidence.
 *
 * 2 · A NAMED PROTOCOL THAT CANNOT BE RESOLVED SILENTLY USED DEFAULTS
 * The cold/warm difference in the issue is the protocol REGISTRY cache, not a score cache:
 * `getCached() ?? findBySlug()` — when both missed, `protocol` was `undefined`, and the code below
 * substituted `selectBaseTimeframe(undefined)` and `{ '1d': 200 }` for the protocol's real cadence
 * and bar requirements. A different cadence reads a different bar array and scores differently, so
 * the same question had two answers depending on cache temperature, and neither said which.
 */
import { SignalEnvelopeService } from './signal-envelope.service';

describe('SignalEnvelopeService — unread and unresolved answers (#1267)', () => {
  let scoreWithGating: jest.Mock;
  let barsByTf: Record<string, any[]>;
  let protocolCacheHit: any;

  const barsAt = (iso: string) => [{ timestamp: iso, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
  const fresh = () => new Date().toISOString();

  /** A gated result shaped like the scorer's NO_DATA return (confidence 0, composite 0). */
  const noDataGated = () => ({
    composite: 0, maxPossible: 100, signal: 'NO_DATA', confidence: 0, breakouts: {}, groups: [],
    subScores: {}, gateResults: [], normalizedScore: 0, gateMultiplier: 1, rarity: null,
    directionMode: 'LONG_ONLY', signalPct: 0, opportunityPct: 0, opportunityScore: 0,
    opportunityMax: 0, riskMultiplier: 1, riskGate: null, signalRaw: 0, signalMax: 100,
    subRawTotals: {}, subMaxTotals: {}, oppRawTotals: {}, oppMaxTotals: {},
    observedSignalMax: 100, configuredSignalMax: 100,
  });

  const makeService = (protocolExists = true) => {
    const prisma: any = { symbol: { findFirst: jest.fn(async () => ({ id: 'sym-1', ticker: 'TEST' })) } };
    const row = protocolExists ? { recommendedTimeframe: '1m', groups: [] } : undefined;
    const protocolDb: any = {
      getCached: jest.fn(() => protocolCacheHit),
      findBySlug: jest.fn(async () => row),
      getRequiredBars: jest.fn(() => ({})),
      getBaseBarCount: jest.fn(() => 100),
    };
    const marketData: any = { getBars: jest.fn(async (_id: string, tf: string) => barsByTf[tf] ?? []) };
    const stub = {} as any;
    const svc = new SignalEnvelopeService(
      prisma, { scoreWithGating } as any, protocolDb, marketData,
      stub, stub, stub, stub, stub, { recordOutcomes: jest.fn(async () => 0) } as any,
    );
    for (const level of ['warn', 'log', 'debug'] as const) {
      jest.spyOn((svc as any).logger, level).mockImplementation(() => undefined);
    }
    return { svc, protocolDb };
  };

  beforeEach(() => {
    protocolCacheHit = { recommendedTimeframe: '1m', groups: [] };
    barsByTf = { '1m': barsAt(fresh()), '1d': barsAt(fresh()), '1h': barsAt(fresh()), '15m': barsAt(fresh()) };
    scoreWithGating = jest.fn(async () => noDataGated());
  });

  // ── 1 · the unread tick ─────────────────────────────────────────────────────────────────────
  it('reports confidence 0 — not a computed 35 — when the scorer said NO_DATA', async () => {
    const { svc } = makeService();
    const env: any = await svc.buildEnvelope('TEST', 'euro-stoxx-v1-long');

    expect(env.signal).toBe('NO_DATA');
    // The scorer's own answer survives. 35 was `50 − min(|0 − 65| * 0.3, 15)`.
    expect(env.confidence).toBe(0);
    expect(env.confidence).not.toBe(35);
  });

  it('CANARY: a READ tick still gets a computed confidence, so the rule is not blanket-zero', async () => {
    scoreWithGating = jest.fn(async () => ({
      ...noDataGated(),
      composite: 80,
      signal: 'BUY' as any,
      signalPct: 80,
      subScores: { technical: 80, momentum: 82 },
    }));
    const { svc } = makeService();
    const env: any = await svc.buildEnvelope('TEST', 'euro-stoxx-v1-long');

    expect(env.signal).toBe('BUY');
    expect(env.confidence).toBeGreaterThan(0);
  });

  // ── 2 · the unresolved protocol ─────────────────────────────────────────────────────────────
  it('refuses a named protocol it cannot resolve, instead of scoring with defaults', async () => {
    protocolCacheHit = undefined;          // ← cold registry cache
    const { svc } = makeService(false);    // ← and findBySlug misses too
    const env: any = await svc.buildEnvelope('TEST', 'no-such-protocol-v1');

    expect(env.preTradeBlockerCodes).toContain('UNKNOWN_PROTOCOL');
    // ⚠️ The load-bearing assertion: scoring must not have run. If it had, it would have used
    // `selectBaseTimeframe(undefined)` and `{ '1d': 200 }` — a different cadence from the one asked
    // for — and the caller could not tell that answer from a real one.
    expect(scoreWithGating).not.toHaveBeenCalled();
    // …and it must not pass as a neutral reading either.
    expect(env.noData).toBe(true);
  });

  it('CANARY: a protocol resolved from a COLD cache is scored normally', async () => {
    protocolCacheHit = undefined;          // cold cache…
    const { svc, protocolDb } = makeService(true); // …but findBySlug resolves it
    const env: any = await svc.buildEnvelope('TEST', 'euro-stoxx-v1-long');

    expect(protocolDb.findBySlug).toHaveBeenCalled();
    expect(scoreWithGating).toHaveBeenCalled();      // the cold-but-findable path still works
    expect(env.preTradeBlockerCodes ?? []).not.toContain('UNKNOWN_PROTOCOL');
  });
});
