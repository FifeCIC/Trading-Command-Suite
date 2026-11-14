/**
 * signal-envelope-stale-symbol.spec.ts — the WIRING for #827.
 *
 * `timeframe.spec.ts` proves the RULE (`everyCadenceStale`) is right. It cannot prove that
 * `buildEnvelope` CALLS it, with the right cadences, in the right direction — and the near-miss on
 * this issue was exactly a wiring mistake: checking the base cadence alone skipped 11 live symbols
 * (SPY, QQQ, XAUUSD, every index). So this drives the real service.
 *
 * The guard returns BEFORE `scoreWithGating`, so "was gating called?" is a direct, observable proof
 * of whether the symbol was scored — not an inference from the response shape.
 */
import { SignalEnvelopeService } from './signal-envelope.service';

const NOW = Date.parse('2026-09-16T07:43:00.000Z');
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

describe('SignalEnvelopeService — stale symbols are not scored (#827)', () => {
  let service: SignalEnvelopeService;
  let scoreWithGating: jest.Mock;
  let barsByTf: Record<string, any[]>;
  let warns: string[];
  let prismaStub: any;
  let notifications: { send: jest.Mock };

  const barsAt = (iso: string) => [{ timestamp: iso, open: 1, high: 1, low: 1, close: 1, volume: 1 }];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));

    warns = [];
    // Default: every cadence FRESH, so a test only has to deviate where it means to.
    barsByTf = { '1m': barsAt(at(0.1)), '1d': barsAt(at(1)), '1h': barsAt(at(0.5)), '15m': barsAt(at(0.2)) };

    // Only reached in the ALIVE cases — the dead cases return before gating. `subScores` must be an
    // object because `computeConfidence` calls `Object.values` on it.
    scoreWithGating = jest.fn(async () => ({
      composite: 12,
      maxPossible: 100,
      signal: 'HOLD',
      confidence: 0,
      breakouts: {},
      groups: [],
      subScores: {},
      gateResults: [],
      normalizedScore: 0,
      gateMultiplier: 1,
      rarity: null,
      directionMode: 'LONG_ONLY',
    }));

    const prisma: any = { symbol: { findFirst: jest.fn(async () => ({ id: 'sym-1', ticker: 'TEST' })) } };
    // #1264 — no position unless a test says so; `position.count` is how "do we hold this?" is asked.
    prisma.position = { count: jest.fn(async () => 0) };
    prismaStub = prisma;
    notifications = { send: jest.fn(async () => undefined) };
    // ⚠️ `recommendedTimeframe: '1m'` is DELIBERATE, not incidental: `selectBaseTimeframe` resolves
    // it to the base cadence the guard checks, and the four cadences the guard inspects are then
    // exactly 1m/1d/1h/15m — the four this spec controls. With '5m' the base cadence would be one
    // the spec never populates, `marketBars` would be empty, and every case would return early
    // through the EMPTY branch instead of the staleness branch (which is what first happened here).
    const protocolDb: any = {
      getCached: jest.fn(() => ({ recommendedTimeframe: '1m', groups: [] })),
      findBySlug: jest.fn(async () => ({ recommendedTimeframe: '1m', groups: [] })),
      getRequiredBars: jest.fn(() => ({})),
      // ⚠️ #1013 — the base cadence window now comes from `getBaseBarCount()`, which folds the
      // generic `'1d'` requirement into the base cadence (the old `requiredBars[tf] || 200`
      // returned a small base-cadence declaration and never consulted the larger generic one).
      // Here `getRequiredBars()` returns `{}`, so the real method falls through to its `|| 100`
      // default. The COUNT is irrelevant to this spec: the mocked `getBars` returns
      // `barsByTf[tf]` whatever count is requested. Without this the service throws
      // `getBaseBarCount is not a function` and the staleness path is never exercised.
      getBaseBarCount: jest.fn(() => 100),
    };
    const marketData: any = {
      getBars: jest.fn(async (_id: string, tf: string) => barsByTf[tf] ?? []),
    };
    const stub = {} as any;

    // ⚠️ SIX stubs, not five. The constructor now ends `…outcomeTracker, tradeDefaults?, notifications?`
    // — positional construction means an omitted `tradeDefaults` silently hands the notification stub
    // to the WRONG parameter, and the symptom is "no notification was sent" rather than a type error.
    service = new SignalEnvelopeService(
      prisma, { scoreWithGating } as any, protocolDb, marketData,
      stub, stub, stub, stub, stub, { recordOutcomes: jest.fn(async () => 0) } as any, stub,
      notifications as any,
    );
    jest.spyOn((service as any).logger, 'warn').mockImplementation((m: any) => { warns.push(String(m)); });
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  describe('a DEAD symbol is skipped', () => {
    it('does not score at all when every cadence is stale', async () => {
      // The 17 July cohort: 1h ended 31 July, 1d ended 21 July. Nothing is alive.
      barsByTf = {
        '1m': barsAt('2026-07-31T21:00:00.000Z'),
        '1d': barsAt('2026-07-21T21:00:00.000Z'),
        '1h': barsAt('2026-07-31T21:00:00.000Z'),
        '15m': barsAt('2026-07-31T21:00:00.000Z'),
      };

      const env = await service.buildEnvelope('HOOD', 'test-v1');

      // The decisive assertion: gating never ran, so no score and no outcome row were produced.
      expect(scoreWithGating).not.toHaveBeenCalled();
      expect(env.preTradeReady).toBe(false);
      expect(String(env.preTradeBlockers.join(' '))).toContain('every cadence is stale');
    });

    it('surfaces it with a warning naming the cadences, rather than skipping silently', async () => {
      barsByTf = {
        '1m': barsAt('2026-07-31T21:00:00.000Z'),
        '1d': barsAt('2026-07-21T21:00:00.000Z'),
        '1h': barsAt('2026-07-31T21:00:00.000Z'),
        '15m': barsAt('2026-07-31T21:00:00.000Z'),
      };

      await service.buildEnvelope('HOOD', 'test-v1');

      const warn = warns.find((w) => w.includes('Skipped scoring'));
      expect(warn).toBeDefined();
      expect(warn).toContain('HOOD');
      expect(warn).toContain('EVERY cadence is stale');
    });
  });

  describe('⚠️ an ALIVE symbol is NOT skipped — the over-rejection regression', () => {
    it('scores SPY with a stale 1m because its other cadences are current', async () => {
      // THE CASE THAT BROKE THE FIRST IMPLEMENTATION. Measured live: SPY 1m=12h, 5m=0.1h, 15m=12h,
      // 1h=4.7h, 1d=35h. The US market was closed, so the 1m feed was legitimately quiet — but the
      // symbol was trading. A base-cadence-only check drops SPY from the ladder entirely.
      barsByTf = {
        '1m': barsAt(at(12)),   // stale (tol 1h)
        '15m': barsAt(at(12)),  // stale (tol 4h)
        '1h': barsAt(at(4.7)),  // fresh
        '1d': barsAt(at(35)),   // fresh (tol 72h) <- the cadence that keeps it alive
      };

      await service.buildEnvelope('SPY', 'test-v1');

      expect(scoreWithGating).toHaveBeenCalled();
      expect(warns.some((w) => w.includes('Skipped scoring'))).toBe(false);
    });

    it('scores XAUUSD while its 1m is quiet — the tightest real measurement', async () => {
      // Measured: XAUUSD 1m=8.6h, 15m=0.0h, 1h=0.7h, 1d=11h. Gold was trading at the time.
      barsByTf = {
        '1m': barsAt(at(8.6)),  // stale
        '15m': barsAt(at(0.0)), // forming
        '1h': barsAt(at(0.7)),
        '1d': barsAt(at(11)),
      };

      await service.buildEnvelope('XAUUSD', 'test-v1');

      expect(scoreWithGating).toHaveBeenCalled();
    });

    it('still scores a healthy symbol normally', async () => {
      await service.buildEnvelope('SPY', 'test-v1');
      expect(scoreWithGating).toHaveBeenCalled();
    });
  });

  describe('#1264 — a stale BASE cadence scores on the freshest cadence that has data', () => {
    // The GER40 measurement, 2026-11-13T20:09Z. The old behaviour scored the 1m series — frozen for
    // 7.6 h — and produced the SAME composite (89) on all 108 snapshots in two hours, against an
    // entry threshold of 10 on six `auto` bots.
    const GER40 = { '1m': at(7.6), '15m': at(7.8), '1h': at(8.3), '1d': at(23.3) };

    it('scores GER40 on 1h, not on its frozen 1m base', async () => {
      barsByTf = {
        '1m': barsAt(GER40['1m']),
        '15m': barsAt(GER40['15m']),
        '1h': barsAt(GER40['1h']),
        '1d': barsAt(GER40['1d']),
      };

      await service.buildEnvelope('GER40', 'test-v1');

      expect(scoreWithGating).toHaveBeenCalledTimes(1);
      const args = scoreWithGating.mock.calls[0];
      // arg[1] = the bars to score, arg[5] = the cadence label. BOTH must be the 1h series: a score
      // computed from 1h bars but stamped `1m` is the same lie in a different place.
      expect(args[1][0].timestamp).toBe(GER40['1h']);
      expect(args[5]).toBe('1h');
    });

    it('says so in the log rather than switching silently', async () => {
      barsByTf = {
        '1m': barsAt(GER40['1m']),
        '15m': barsAt(GER40['15m']),
        '1h': barsAt(GER40['1h']),
        '1d': barsAt(GER40['1d']),
      };
      const logs: string[] = [];
      jest.spyOn((service as any).logger, 'log').mockImplementation((m: any) => { logs.push(String(m)); });

      await service.buildEnvelope('GER40', 'test-v1');

      expect(logs.some((l) => l.includes('instead of its base'))).toBe(true);
    });

    it('leaves a healthy symbol alone — no switch, base cadence used', async () => {
      await service.buildEnvelope('SPY', 'test-v1');

      const args = scoreWithGating.mock.calls[0];
      expect(args[5]).toBe('1m');
      expect(args[1][0].timestamp).toBe(barsByTf['1m'][0].timestamp);
    });

    it('warns IMMEDIATELY when we hold a position in a symbol scoring off a stale base', async () => {
      prismaStub.position.count.mockResolvedValue(1);
      barsByTf = {
        '1m': barsAt(GER40['1m']),
        '15m': barsAt(GER40['15m']),
        '1h': barsAt(GER40['1h']),
        '1d': barsAt(GER40['1d']),
      };

      await service.buildEnvelope('GER40', 'test-v1');

      expect(notifications.send).toHaveBeenCalledTimes(1);
      const msg = notifications.send.mock.calls[0][0];
      expect(msg.symbol).toBe('GER40');
      expect(msg.event).toBe('provider-degraded');
      expect(msg.title).toContain('held symbol');
      expect(msg.metadata.held).toBe(true);
    });

    it('does NOT warn for a stale base we hold nothing in', async () => {
      await service.buildEnvelope('GER40', 'test-v1');
      expect(notifications.send).not.toHaveBeenCalled();
    });

    it('warns about a starved symbol nobody holds, once everything is stale', async () => {
      barsByTf = {
        '1m': barsAt('2026-07-31T21:00:00.000Z'),
        '1d': barsAt('2026-07-21T21:00:00.000Z'),
        '1h': barsAt('2026-07-31T21:00:00.000Z'),
        '15m': barsAt('2026-07-31T21:00:00.000Z'),
      };

      await service.buildEnvelope('HOOD', 'test-v1');

      expect(notifications.send).toHaveBeenCalledTimes(1);
      expect(notifications.send.mock.calls[0][0].title).toBe('No market data for HOOD');
    });

    it('sends ONE notice per symbol per hour, not one per tick', async () => {
      barsByTf = {
        'm1': [],
        '1m': barsAt('2026-07-31T21:00:00.000Z'),
        '1d': barsAt('2026-07-21T21:00:00.000Z'),
        '1h': barsAt('2026-07-31T21:00:00.000Z'),
        '15m': barsAt('2026-07-31T21:00:00.000Z'),
      };

      await service.buildEnvelope('HOOD', 'test-v1');
      await service.buildEnvelope('HOOD', 'test-v1');
      await service.buildEnvelope('HOOD', 'test-v1');

      expect(notifications.send).toHaveBeenCalledTimes(1);

      // …and the hour passing re-arms it, so a lasting gap is not reported once and forgotten.
      jest.setSystemTime(new Date(NOW + 61 * 60_000));
      await service.buildEnvelope('HOOD', 'test-v1');
      expect(notifications.send).toHaveBeenCalledTimes(2);
    });

    it('a notification failure never takes the scoring loop with it', async () => {
      notifications.send.mockRejectedValue(new Error('smtp is down'));
      prismaStub.position.count.mockResolvedValue(1);
      barsByTf = {
        '1m': barsAt(at(7.6)),
        '15m': barsAt(at(7.8)),
        '1h': barsAt(at(8.3)),
        '1d': barsAt(at(23.3)),
      };

      await expect(service.buildEnvelope('GER40', 'test-v1')).resolves.toBeDefined();
      expect(scoreWithGating).toHaveBeenCalled();
      expect(warns.some((w) => w.includes('Could not send the data-starvation notification'))).toBe(true);
    });
  });

  describe('#915 Option C — the conviction reading is read safely off `meta`', () => {
    // ⚠️ These live HERE because this spec already drives the REAL service with a light mock; a
    // second harness would be a copy of this one.
    //
    // ⚠️ WHY THE FIRST CASE IS NOT CEREMONY. The #758 NO_DATA return in
    // `protocol-gating.service.ts` is cast `as any` and omits `meta` — so typing `meta` as required
    // on `GatedScore` does NOT make it present at runtime. Reading
    // `gated.meta.observedSignalMax` unconditionally threw on that path and took 3 cases of THIS
    // spec down (measured 2026-10-13), which is how the hole was found.
    const noMetaShape = {
      composite: 0, maxPossible: 0, signal: 'NO_DATA', confidence: 0,
      breakouts: {}, groups: [], subScores: {}, rarity: null, directionMode: 'LONG_ONLY',
      signalRaw: 0, signalPct: 0, noData: true,
    } as any;

    it('does NOT throw, and reports no conviction, when the scorer returned no `meta` (NO_DATA)', async () => {
      scoreWithGating.mockResolvedValue(noMetaShape);

      const env = await service.buildEnvelope('SPY', 'test-v1');

      // `null` — never 0. NO_DATA is the scorer's own judgement that the tick produced no
      // directional reading, so there is no conviction figure to report.
      expect(env.convictionPct).toBeNull();
      expect(env.observedSignalMax).toBeNull();
    });

    it('carries the observed reading through when `meta` IS present', async () => {
      // The live XAUUSD / gold-macro-v1-long figures, 2026-10-13: raw 51 against a configured 795 and
      // an observed 90 — the same tick that reads 6.42% as breadth.
      scoreWithGating.mockResolvedValue({
        composite: 51, maxPossible: 795, signal: 'BUY', confidence: 0,
        breakouts: {}, groups: [], subScores: {}, rarity: null, directionMode: 'LONG_ONLY',
        signalRaw: 51, signalPct: 6.415,
        meta: { observedSignalMax: 90, configuredSignalMax: 795 },
      } as any);

      const env = await service.buildEnvelope('XAUUSD', 'test-v1');

      expect(env.observedSignalMax).toBe(90);
      expect(env.convictionPct).toBeCloseTo(56.67, 2);
    });
  });
});
