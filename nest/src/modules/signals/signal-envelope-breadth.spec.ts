/**
 * signal-envelope-breadth.spec.ts — the score's breadth and its point bars are derived, not typed.
 *
 * WHAT THIS PINS (#1358, measured 2026-11-26)
 * ───────────────────────────────────────────
 * `signalPct` is `composite ÷ signalMax`, and it was being presented as a strength. Measured over
 * 800 stored scores: a median of **11** directives exist per protocol and **53% of readings fire
 * exactly one of them**, so the ratio's structural ceiling is ~9–18% and its median is 7.2%. The
 * numerator counts the one or two directives that fired; the denominator sums EVERY directive,
 * ~10 of which read neutral. The quotient is a breadth share, not conviction.
 *
 * The fix is presentation, but presentation needs the two facts that were not on the payload:
 * how many directives agreed, and what the bar is in the SAME unit as `composite`. Both are
 * derived here from data the score already had.
 *
 * ⚠️ WHAT WOULD GO WRONG SILENTLY. `signalMax` is per protocol — measured 815 / 1005 / 1225 — so a
 * hardcoded `74` or a `6` re-typed in the service would look right on one protocol and be wrong on
 * the next, with no error. The canary below changes `signalMax` and asserts the bars MOVE.
 */
import { SignalEnvelopeService } from './signal-envelope.service';
import { SIGNAL_THRESHOLDS } from '../scoring/protocol-gating.service';

describe('SignalEnvelopeService — breadth and point bars (#1358)', () => {
  let scoreWithGating: jest.Mock;
  let barsByTf: Record<string, any[]>;

  const barsAt = (iso: string) => [{ timestamp: iso, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
  const fresh = () => new Date().toISOString();

  /** A breakout row as the gate emits it; only `inSignal` and `maxScore` matter to the counts. */
  const d = (inSignal: boolean, maxScore = 100) => ({
    name: 'x', score: 50, reason: '', groupId: 'technical', inSignal, maxScore,
    directiveId: 'x', signalClass: 'neutral', normalizedScore: 50,
  });

  const makeService = () => {
    const prisma: any = { symbol: { findFirst: jest.fn(async () => ({ id: 'sym-1', ticker: 'TEST' })) } };
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

  const gatedWith = (breakouts: Record<string, any[]>, signalMax: number) => jest.fn(async () => ({
    composite: 174, signal: 'STRONG_BUY', confidence: 55, breakouts, groups: [],
    subScores: {}, gateResults: [], normalizedScore: 0, gateMultiplier: 1, rarity: null,
    directionMode: 'LONG_ONLY', signalPct: (174 / signalMax) * 100, opportunityPct: 0,
    opportunityScore: 0, opportunityMax: 0, riskMultiplier: 1, riskGate: null, signalRaw: 174,
    signalMax, subRawTotals: {}, subMaxTotals: {}, oppRawTotals: {}, oppMaxTotals: {},
    observedSignalMax: 360, configuredSignalMax: signalMax,
  }));

  beforeEach(() => {
    barsByTf = { '1m': barsAt(fresh()), '1d': barsAt(fresh()), '1h': barsAt(fresh()), '15m': barsAt(fresh()) };
  });

  it('counts only the directives that actually read, out of every directive in the protocol', async () => {
    // 11 directives, 2 of them fired — the measured median shape.
    const breakouts = { technical: [d(true), d(true), d(false), d(false), d(false)], sentiment: [d(false), d(false), d(false)], risk: [d(false), d(false), d(false)] };
    scoreWithGating = gatedWith(breakouts, 815);

    const env: any = await makeService().buildEnvelope('TEST');
    expect(env.totalDirectives).toBe(11);
    expect(env.firedDirectives).toBe(2);
  });

  it('expresses the entry and strong bars in POINTS on the protocol’s own scale', async () => {
    scoreWithGating = gatedWith({ technical: [d(true)] }, 815);

    const env: any = await makeService().buildEnvelope('TEST');
    // ceil, not round: the gate compares `signalPct >= threshold`, so the bar is the smallest
    // whole-point score that clears it.
    expect(env.entryPoints).toBe(Math.ceil((SIGNAL_THRESHOLDS.entry / 100) * 815));   // 49
    expect(env.strongPoints).toBe(Math.ceil((SIGNAL_THRESHOLDS.strong / 100) * 815)); // 106
  });

  // ── Canary, the OTHER direction ───────────────────────────────────────────────────────────────
  // A bar that never moves would pass the test above on the one protocol it was written for.
  it('CANARY: the bars TRACK signalMax, so they cannot be a hardcoded number', async () => {
    scoreWithGating = gatedWith({ technical: [d(true)] }, 1005);
    const env: any = await makeService().buildEnvelope('TEST');

    expect(env.strongPoints).toBe(Math.ceil((SIGNAL_THRESHOLDS.strong / 100) * 1005)); // 131
    expect(env.strongPoints).not.toBe(Math.ceil((SIGNAL_THRESHOLDS.strong / 100) * 815)); // ≠ 106
  });

  it('CANARY: an unread envelope reports ZERO breadth, so “0 of 0 agree” cannot read as a reading', async () => {
    // No symbol row → emptyEnvelope() path. `noData` is what makes it unreadable as a score;
    // the counts must agree rather than inventing a directive population.
    const prisma: any = { symbol: { findFirst: jest.fn(async () => null) } };
    const stub = {} as any;
    const svc = new SignalEnvelopeService(
      prisma, { scoreWithGating: jest.fn() } as any,
      { getCached: jest.fn(() => null), findBySlug: jest.fn(async () => null), getRequiredBars: jest.fn(() => ({})), getBaseBarCount: jest.fn(() => 0) } as any,
      { getBars: jest.fn(async () => []) } as any,
      stub, stub, stub, stub, stub, stub,
    );
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);

    const env: any = await svc.buildEnvelope('NOT_REGISTERED');
    expect(env.noData).toBe(true);
    expect(env.firedDirectives).toBe(0);
    expect(env.totalDirectives).toBe(0);
  });
});
