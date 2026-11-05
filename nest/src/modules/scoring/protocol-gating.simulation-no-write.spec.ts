import { ProtocolGatingService } from './protocol-gating.service';

/**
 * A backtest is a SIMULATION and must write nothing to the live tables (#1183).
 *
 * ⚠️ WHY THIS EXISTS. `storeSnapshot()` runs at the end of every `scoreWithGating()` call, and a
 * backtest calls it once per bar. One 548-bar `forex-session-v1-long` / USDJPY 1h run added **+320** to
 * `score_snapshot`, **+320** to `Score`, and **+320** to `protocol.adaptiveTargetSamples` — measured
 * 2026-11-02. Two of those are correctness bugs, not untidiness:
 *
 *   · `computeRarity()` percentiles the current composite against the protocol's last 365 days of
 *     `score_snapshot`. A run that writes its own historical bars into that distribution makes the
 *     NEXT run percentile against scores the previous run invented.
 *   · `adaptiveTargetMax` is monotonic. A historical bar above the stored peak permanently raises
 *     the LIVE protocol's target and nothing ever brings it down.
 *
 * ⚠️ WHAT THIS TEST CANNOT SEE: the database. It counts CALLS to the writers, which is the property
 * that was wrong. It cannot prove the row counts — that is the acceptance measurement on the live
 * server (`SELECT COUNT(*) FROM score_snapshot` before/after a run).
 *
 * Harness note: the real service needs ~15 injected dependencies for a decision that depends on
 * `prisma` alone, so the prototype is borrowed and `prisma` is stubbed — the same approach as
 * `protocol-gating.rarity-cache.spec.ts`. Both directions (writes / does not write) stay observable
 * in one file, which is the point: a gate that has never been observed to fail is a decoration.
 */
describe('ProtocolGatingService simulation mode never writes (#1183)', () => {
  const BREAKDOWN = {
    subScores: { cci: 10 },
    subRawTotals: { cci: 10 },
    subMaxTotals: { cci: 40 },
    breakouts: {},
    riskMultiplier: 1,
    directionMode: 'LONG_ONLY',
    readinessGate: { ready: true, blockers: [], reason: undefined },
    marketStatus: { open: true, asOf: '2026-11-03T00:00:00Z', reason: undefined },
    opportunityScore: 10,
    opportunityMax: 40,
    opportunityPct: 25,
    compositePct: 25,
    denominatorMode: 'configured-capacity',
    observedSignalMax: 40,
    configuredSignalMax: 40,
    earnableSignalMax: 40,
    directionalEvidence: { bullishRaw: 10, bullishMax: 40, bearishRaw: 0, bearishMax: 0, selected: 'LONG' },
  };

  /** Every write the two persisted tables can receive, recorded in call order. */
  function makeService() {
    const writes: string[] = [];

    const svc = Object.create(ProtocolGatingService.prototype) as ProtocolGatingService;
    (svc as any).logger = { warn: () => {}, log: () => {}, error: () => {}, debug: () => {} };
    (svc as any).prisma = {
      scoreSnapshot: {
        create: async () => { writes.push('score_snapshot'); return {}; },
      },
      score: {
        create: async () => { writes.push('score'); return {}; },
      },
      // `observeAdaptiveTargetPeak()` is fire-and-forget with a single raw UPDATE.
      $executeRawUnsafe: async () => { writes.push('adaptiveTarget'); return 1; },
      protocol: {
        findFirst: async () => ({ active: true }),
      },
      symbol: {
        findFirst: async () => ({ id: 'sym-1' }),
      },
      // The canonical-symbol guard resolves through the authority service in production; here it is
      // answered directly so the test measures the WRITE decision and nothing else.
      symbolProtocolAssignment: {
        findMany: async () => [{ symbol: 'USDJPY' }],
      },
    };
    (svc as any).isCanonicalProtocolSymbol = async () => true;
    (svc as any).isActiveProtocol = async () => true;

    return { svc, writes };
  }

  const call = (svc: ProtocolGatingService, opts?: { simulation?: boolean }) =>
    (svc as any).storeSnapshot('forex-session-v1-long', 'USDJPY', 25, 'HOLD', 55, BREAKDOWN, opts);

  /** `storeSnapshot` is fire-and-forget; give its IIFE a turn to reach the writes. */
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it('writes NOTHING when simulation is set — the property that was wrong', async () => {
    const { svc, writes } = makeService();

    call(svc, { simulation: true });
    await settle();

    expect(writes).toEqual([]);
  });

  it('still writes both rows and the adaptive peak WITHOUT the flag — this must not become "stop writing"', async () => {
    const { svc, writes } = makeService();

    call(svc);
    await settle();

    // All three, and in this order: the snapshot, then the peak, then the canonical score.
    expect(writes).toContain('score_snapshot');
    expect(writes).toContain('score');
    expect(writes).toContain('adaptiveTarget');
  });

  it('refuses BEFORE the lookups, so a simulation never even reads the protocol/symbol tables', async () => {
    const { svc } = makeService();
    const touched: string[] = [];
    (svc as any).isCanonicalProtocolSymbol = async () => { touched.push('canonical'); return true; };
    (svc as any).isActiveProtocol = async () => { touched.push('active'); return true; };

    call(svc, { simulation: true });
    await settle();

    expect(touched).toEqual([]);
  });

  it('an explicit `false` is a live write — absence and falsity must behave the same', async () => {
    const { svc, writes } = makeService();

    call(svc, { simulation: false });
    await settle();

    expect(writes).toContain('score');
  });

  it('`skipRaritySnapshot` and `simulation` are independent: the NO_READING path still records a Score row', async () => {
    // The NO_READING exit passes `skipRaritySnapshot: true` and no `simulation`, so a live tick with
    // no directional evidence must still appear in `score` while staying out of the rarity
    // distribution. If `simulation` were ever derived from `skipRaritySnapshot`, this would break.
    const { svc, writes } = makeService();

    call(svc, { skipRaritySnapshot: true } as any);
    await settle();

    expect(writes).not.toContain('score_snapshot');
    expect(writes).toContain('score');
  });
});
