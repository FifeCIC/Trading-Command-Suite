import { ProtocolGatingService } from './protocol-gating.service';
import { RARITY_MIN_SAMPLES, rarityPercentile } from './rarity-bands';

/**
 * The rarity-distribution read, cached per protocol (#1182).
 *
 * ⚠️ WHY THIS EXISTS. `computeRarity()` read the protocol's whole 365-day `score_snapshot`
 * distribution on EVERY `scoreWithGating()` call — which is once per bar in a backtest. MEASURED
 * 2026-11-02 on `forex-session-v1-long`: **118,360 rows / 601 ms per read**, and a 548-bar USDJPY 1h run
 * spent ~165 s of its 192 s inside 548 reads of a table that cannot change between two bars a second
 * apart. A 1h backtest that should take ~30 s took over three minutes, and the user-visible effect was
 * the Backtesting Protocols view hanging after "Run".
 *
 * ⚠️ WHAT THIS TEST CANNOT SEE: the database. It counts CALLS to the read, which is the property that
 * was wrong. It cannot tell you the query is fast — that is `/api/backtest/run` wall time, measured
 * separately. A cache that fires correctly but wraps a slow query would still pass here.
 *
 * Harness note: the real service needs ~15 injected dependencies to be constructed, for a decision
 * that depends on one (`prisma.scoreSnapshot`) plus a clock. The prototype is borrowed and only those
 * two are stubbed — the same approach as `protocol-gating.venue-standby.spec.ts` — so both directions
 * (read once / read again after expiry) stay observable in one file.
 */
describe('ProtocolGatingService rarity distribution cache (#1182)', () => {
  /**
   * 60 ascending composites — above `RARITY_MIN_SAMPLES` so a band is always produced, and drawn from
   * real low-and-high values so the percentile lands somewhere checkable rather than at a boundary.
   */
  const DISTRIBUTION = Array.from({ length: 60 }, (_, i) => i);

  function makeService(options: { rows?: number[]; onRead?: () => void } = {}) {
    const reads: Array<{ protocolId: string; at: number }> = [];
    const rows = options.rows ?? DISTRIBUTION;

    const svc = Object.create(ProtocolGatingService.prototype) as ProtocolGatingService;
    (svc as any).logger = { warn: () => {}, log: () => {}, error: () => {}, debug: () => {} };
    (svc as any).prisma = {
      scoreSnapshot: {
        findMany: async (args: any) => {
          reads.push({ protocolId: args.where.protocolId, at: Date.now() });
          options.onRead?.();
          return rows.map(composite => ({ composite }));
        },
      },
    };
    return { svc, reads };
  }

  const rarityOf = (svc: ProtocolGatingService, protocolId: string, composite: number) =>
    (svc as any).computeRarity(protocolId, 'USDJPY', composite);

  it('reads the distribution ONCE for many calls — the property that was wrong', async () => {
    const { svc, reads } = makeService();

    for (let i = 0; i < 548; i++) await rarityOf(svc, 'forex-session-v1-long', 40);

    expect(reads).toHaveLength(1);
  });

  it('READS AGAIN once the TTL has expired — the other direction, so the cache cannot be a stale freeze', async () => {
    const { svc, reads } = makeService();
    const realNow = Date.now;

    try {
      let now = 1_000_000;
      Date.now = () => now;

      await rarityOf(svc, 'forex-session-v1-long', 40);
      expect(reads).toHaveLength(1);

      now += 59_000; // still inside the 60 s window
      await rarityOf(svc, 'forex-session-v1-long', 40);
      expect(reads).toHaveLength(1);

      now += 2_000; // 61 s — expired
      await rarityOf(svc, 'forex-session-v1-long', 40);
      expect(reads).toHaveLength(2);
    } finally {
      Date.now = realNow;
    }
  });

  it('keys by PROTOCOL, not by symbol — two protocols do not share one distribution', async () => {
    const { svc, reads } = makeService();

    await rarityOf(svc, 'forex-session-v1-long', 40);
    await rarityOf(svc, 'xau-speed-v1-long', 40);
    await rarityOf(svc, 'forex-session-v1-long', 40);

    expect(reads.map(r => r.protocolId)).toEqual(['forex-session-v1-long', 'xau-speed-v1-long']);
  });

  it('returns the SAME percentile the uncached path would — caching must not move the number', async () => {
    const { svc } = makeService();

    // Three calls: the first populates, the next two are served from the cache. All three must agree
    // with the pure function applied to the same distribution.
    const first = await rarityOf(svc, 'forex-session-v1-long', 40);
    const second = await rarityOf(svc, 'forex-session-v1-long', 40);
    const third = await rarityOf(svc, 'forex-session-v1-long', 12);

    expect(first.percentile).toBe(rarityPercentile(DISTRIBUTION, 40));
    expect(second).toEqual(first);
    expect(third.percentile).toBe(rarityPercentile(DISTRIBUTION, 12));
    expect(first.sampleSize).toBe(DISTRIBUTION.length);
  });

  it('still returns undefined below the minimum sample count — the cache must not bypass that guard', async () => {
    const { svc, reads } = makeService({ rows: DISTRIBUTION.slice(0, RARITY_MIN_SAMPLES - 1) });

    expect(await rarityOf(svc, 'thin-protocol', 40)).toBeUndefined();
    // Cached even when too thin: re-reading a table that we already know is too small is the exact
    // waste this change removes.
    expect(await rarityOf(svc, 'thin-protocol', 40)).toBeUndefined();
    expect(reads).toHaveLength(1);
  });

  it('does NOT cache a failed read — a transient database error must not freeze an empty distribution', async () => {
    let failNext = true;
    const rows = DISTRIBUTION;
    const reads: number[] = [];

    const svc = Object.create(ProtocolGatingService.prototype) as ProtocolGatingService;
    (svc as any).logger = { warn: () => {}, log: () => {}, error: () => {}, debug: () => {} };
    (svc as any).prisma = {
      scoreSnapshot: {
        findMany: async () => {
          reads.push(1);
          if (failNext) {
            failNext = false;
            throw new Error('connection reset');
          }
          return rows.map(composite => ({ composite }));
        },
      },
    };

    expect(await rarityOf(svc, 'forex-session-v1-long', 40)).toBeUndefined(); // failed read → no rarity
    const afterRecovery = await rarityOf(svc, 'forex-session-v1-long', 40);     // must have retried
    expect(reads).toHaveLength(2);
    expect(afterRecovery.percentile).toBe(rarityPercentile(DISTRIBUTION, 40));
  });
});
