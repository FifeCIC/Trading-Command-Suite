import { TradeHistoryController } from './trade-history.controller';

/**
 * getProtocolProfitability() — per-protocol P&L (#777).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS FILE GUARDS (measured live 2026-09-17)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The endpoint was first written with the attribution chain the COLUMN NAME suggests:
 *
 *     trade.scoringStrategyId  ->  scoring_strategy.protocolId  ->  protocol.slug
 *
 * It resolved **0 of 26** trades and reported every single one as `unattributed`. Nothing threw.
 * The response looked like a normal result — one protocol, 26 trades, a net figure — which is
 * exactly the defect class #777 exists to remove ("plausible numbers, no error").
 *
 * Measurement found TWO wrong assumptions:
 *
 *   1. `trade.scoringStrategyId` does NOT hold a `scoring_strategy.id`. Over the 31 distinct
 *      values on `trade`: **0 of 31** match `scoring_strategy.id`, **16 of 31** match
 *      `trading_strategy.id` (the BOT id). The column is DUAL-MEANING because two writers
 *      disagree — `automation-loop.service.ts:1758` writes a bot id,
 *      `signal-actions.service.ts:235` writes a protocol slug.
 *   2. `trading_strategy.protocolId` holds a **SLUG**, not a `protocol.id` (26 of 27 rows).
 *      Joining on `protocol.id` returns nothing at all.
 *
 * With both corrections the chain resolves **26 of 26**.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THESE TESTS ARE SHAPED THIS WAY
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Test 1 is the regression guard for the bug above, and it canaries by construction: it asserts
 * attribution lands on the protocol reached through `trading_strategy`. Reverting the resolver to
 * the old chain makes it fail with `unattributed` — it cannot pass by accident, because the fake
 * data deliberately gives the bot id and the scoring-strategy id DIFFERENT values, and only the
 * bot id resolves.
 *
 * The remaining tests exist because #777's whole point is that an EXCLUDED row must be COUNTED,
 * and an UNMEASURED cost must not be reported as zero. Those are the two ways this endpoint could
 * quietly lie while returning HTTP 200.
 */
describe('getProtocolProfitability — attribution + honest numbers (#777)', () => {
  type Row = Record<string, any>;

  /**
   * Build the controller with a fake Prisma. Only the three models this endpoint reads are
   * stubbed; anything else throws, so a new dependency is a loud failure rather than a silent
   * `undefined`.
   */
  function build(data: {
    trades?: Row[];
    bots?: Row[];
    protocols?: Row[];
    botLookupThrows?: boolean;
    account?: Row | null;
    accountThrows?: boolean;
  }) {
    const prisma = {
      trade: {
        findMany: jest.fn(async () => data.trades ?? []),
      },
      tradingStrategy: {
        findMany: jest.fn(async () => {
          if (data.botLookupThrows) throw new Error('relation "trading_strategy" does not exist');
          return data.bots ?? [];
        }),
      },
      protocol: {
        findMany: jest.fn(async () => data.protocols ?? []),
      },
      scoringStrategy: {
        findMany: jest.fn(async () => {
          throw new Error('the old chain must not be used');
        }),
      },
    };

    // Arg order: tradeRecorder, prisma, mt5, swapCost, weekendDefense, positionSync
    const mt5 = {
      getAccount: jest.fn(async () => {
        if (data.accountThrows) throw new Error('bridge unreachable');
        return data.account === undefined ? { currency: 'GBP' } : data.account;
      }),
    };
    const controller = new TradeHistoryController(
      {} as any, prisma as any, mt5 as any, {} as any, {} as any, {} as any,
    );
    return { controller, prisma, mt5 };
  }

  const PROTOCOL = { id: 'proto-uuid-1', slug: 'forex-session-v1', name: 'Forex Session V1' };
  /** A closed, trustworthy (pnlValid, exited) trade. */
  const goodTrade = (over: Row = {}): Row => ({
    id: 't1', symbol: 'EURUSD', side: 'buy', pnl: 10, exitPrice: 1.1,
    pnlInvalid: 0, scoringStrategyId: 'bot-uuid-1',
    openedAt: new Date('2026-09-01T00:00:00Z'), closedAt: new Date('2026-09-01T01:00:00Z'),
    ...over,
  });

  it('attributes a trade to the protocol via trading_strategy, NOT scoring_strategy (#777 regression)', async () => {
    const { controller } = build({
      trades: [goodTrade()],
      // The bot id and the scoring-strategy id are DIFFERENT, and only the bot id resolves.
      bots: [{ id: 'bot-uuid-1', name: 'London EURUSD Macro', protocolId: 'forex-session-v1', scoringStrategyId: 'ss-not-this-one' }],
      protocols: [PROTOCOL],
    });

    const res: any = await controller.getProtocolProfitability();

    expect(res.attribution.resolvedByPath).toEqual({ trading_strategy: 1 });
    expect(res.attribution.unresolvedCount).toBe(0);
    expect(res.protocols).toHaveLength(1);
    expect(res.protocols[0].protocolSlug).toBe('forex-session-v1');
    expect(res.protocols[0].trades).toBe(1);
    // The old chain must never even be consulted.
    expect(res.attribution.lookupFailures).toHaveLength(0);
  });

  it('counts a trade whose id resolves to nothing, and names the raw value instead of hiding it', async () => {
    const { controller } = build({
      trades: [goodTrade({ scoringStrategyId: 'ghost-bot-id' })],
      bots: [],
      protocols: [PROTOCOL],
    });

    const res: any = await controller.getProtocolProfitability();

    expect(res.attribution.resolvedByPath).toEqual({ unresolved: 1 });
    expect(res.attribution.unresolvedCount).toBe(1);
    // The raw value is visible. `unattributed` alone would look like a healthy result.
    expect(res.attribution.unresolvedIds).toEqual(['ghost-bot-id']);
    expect(res.protocols[0].protocolSlug).toBe('unattributed');
  });

  it('surfaces a failed lookup rather than rendering it as an empty table', async () => {
    const { controller } = build({
      trades: [goodTrade()],
      botLookupThrows: true,
      protocols: [PROTOCOL],
    });

    const res: any = await controller.getProtocolProfitability();

    // An empty list and a failed query must never look the same.
    expect(res.attribution.lookupFailures).toHaveLength(1);
    expect(res.attribution.lookupFailures[0]).toContain('trading_strategy');
    expect(res.attribution.unresolvedCount).toBe(1);
  });

  it('EXCLUDES quarantined and no-exit rows from every figure, but counts them', async () => {
    const { controller } = build({
      trades: [
        goodTrade({ id: 'ok', pnl: 10 }),
        goodTrade({ id: 'fab', pnl: 9999, pnlInvalid: 1 }),   // fabricated row
        goodTrade({ id: 'noexit', pnl: 500, exitPrice: null }), // never closed
      ],
      bots: [{ id: 'bot-uuid-1', name: 'B', protocolId: 'forex-session-v1' }],
      protocols: [PROTOCOL],
    });

    const res: any = await controller.getProtocolProfitability();

    expect(res.dataQuality.strategyTradeRows).toBe(3);
    expect(res.dataQuality.quarantined).toBe(1);
    expect(res.dataQuality.exitUnknown).toBe(1);
    expect(res.dataQuality.usable).toBe(1);
    expect(res.dataQuality.excluded).toBe(2);
    // The fabricated 9999 must not reach any performance figure.
    expect(res.protocols[0].netPnl).toBe(10);
  });

  it('treats pnl === 0 with a known exit as a real result (flat), not as unknown', async () => {
    const { controller } = build({
      trades: [
        goodTrade({ id: 'flat1', pnl: 0 }),
        goodTrade({ id: 'flat2', pnl: 0 }),
        goodTrade({ id: 'win', pnl: 4 }),
      ],
      bots: [{ id: 'bot-uuid-1', name: 'B', protocolId: 'forex-session-v1' }],
      protocols: [PROTOCOL],
    });

    const res: any = await controller.getProtocolProfitability();
    const p = res.protocols[0];

    expect(p.trades).toBe(3);
    expect(p.flat).toBe(2);
    expect(p.wins).toBe(1);
    expect(p.losses).toBe(0);
    // 1 win of 3 = 33.33%, NOT 100%. Counting flats as wins would be the flattering lie.
    expect(p.winRate).toBe(33.33);
  });

  it('reports costs as UNMEASURED (null + available:false), never as zero', async () => {
    const { controller } = build({
      trades: [goodTrade({ pnl: 10 })],
      bots: [{ id: 'bot-uuid-1', name: 'B', protocolId: 'forex-session-v1' }],
      protocols: [PROTOCOL],
    });

    const res: any = await controller.getProtocolProfitability();

    expect(res.costs.available).toBe(false);
    expect(res.costs.commission).toBeNull();
    expect(res.costs.swap).toBeNull();
    // A 0 here would be the fabrication this endpoint exists to prevent.
    expect(res.costs.commission).not.toBe(0);
    expect(res.costs.swap).not.toBe(0);
  });

  it('labels the currency the money is in, and does not assume USD', async () => {
    const { controller } = build({
      trades: [goodTrade({ pnl: 10 })],
      bots: [{ id: 'bot-uuid-1', name: 'B', protocolId: 'forex-session-v1' }],
      protocols: [PROTOCOL],
    });

    const res: any = await controller.getProtocolProfitability();

    // MEASURED: the bot account on bridge :5000 is GBP, so this is NOT dollars.
    expect(res.denomination.currency).toBe('GBP');
    expect(res.denomination.resolved).toBe(true);
    expect(res.denomination.currency).not.toBe('USD');
  });

  it('reports the currency as unresolved (null) when the bridge is down, never as USD', async () => {
    const { controller } = build({
      trades: [goodTrade({ pnl: 10 })],
      bots: [{ id: 'bot-uuid-1', name: 'B', protocolId: 'forex-session-v1' }],
      protocols: [PROTOCOL],
      accountThrows: true,
    });

    const res: any = await controller.getProtocolProfitability();

    expect(res.denomination.currency).toBeNull();
    expect(res.denomination.resolved).toBe(false);
    // Guessing a currency would be the same defect as guessing a cost of zero.
    expect(res.denomination.currency).not.toBe('USD');
    // The P&L itself is still reported — unknown denomination does not blank the numbers.
    expect(res.protocols[0].netPnl).toBe(10);
  });

  it('flags a sample below the verdict threshold as inconclusive', async () => {
    const trades = Array.from({ length: 19 }, (_, i) => goodTrade({ id: `t${i}`, pnl: 1 }));
    const { controller } = build({
      trades,
      bots: [{ id: 'bot-uuid-1', name: 'B', protocolId: 'forex-session-v1' }],
      protocols: [PROTOCOL],
    });

    const small: any = await controller.getProtocolProfitability();
    expect(small.protocols[0].trades).toBe(19);
    expect(small.protocols[0].inconclusive).toBe(true);
    expect(small.protocols[0].inconclusive).toBe(small.protocols[0].trades < small.threshold.minSampleForVerdict);

    const { controller: big } = build({
      trades: [...trades, goodTrade({ id: 't20', pnl: 1 })],
      bots: [{ id: 'bot-uuid-1', name: 'B', protocolId: 'forex-session-v1' }],
      protocols: [PROTOCOL],
    });
    const ok: any = await big.getProtocolProfitability();
    expect(ok.protocols[0].trades).toBe(20);
    expect(ok.protocols[0].inconclusive).toBe(false);
  });

  it('separates the protocols rather than pooling them', async () => {
    const { controller } = build({
      trades: [
        goodTrade({ id: 'a1', pnl: 5, scoringStrategyId: 'bot-A' }),
        goodTrade({ id: 'b1', pnl: -3, scoringStrategyId: 'bot-B' }),
        goodTrade({ id: 'b2', pnl: -3, scoringStrategyId: 'bot-B' }),
      ],
      bots: [
        { id: 'bot-A', name: 'A', protocolId: 'xau-speed-m5' },
        { id: 'bot-B', name: 'B', protocolId: 'forex-session-v1' },
      ],
      protocols: [PROTOCOL, { id: 'proto-uuid-2', slug: 'xau-speed-m5', name: 'XAU M5' }],
    });

    const res: any = await controller.getProtocolProfitability();
    const bySlug = Object.fromEntries(res.protocols.map((p: any) => [p.protocolSlug, p]));

    expect(bySlug['xau-speed-m5'].netPnl).toBe(5);
    expect(bySlug['forex-session-v1'].netPnl).toBe(-6);
    // Sorted by sample size, largest first.
    expect(res.protocols[0].protocolSlug).toBe('forex-session-v1');
  });

  it('reports the MEDIAN hold time, so one stale row cannot move it', async () => {
    const at = (h: number) => new Date(Date.UTC(2026, 8, 1, h, 0, 0));
    const { controller } = build({
      trades: [
        goodTrade({ id: 'h1', openedAt: at(0), closedAt: at(1) }),    // 60 min
        goodTrade({ id: 'h2', openedAt: at(0), closedAt: at(1) }),    // 60 min
        goodTrade({ id: 'h3', openedAt: at(0), closedAt: at(2) }),    // 120 min
        goodTrade({ id: 'h4', openedAt: at(0), closedAt: at(3) }),    // 180 min
        goodTrade({ id: 'stale', openedAt: at(0), closedAt: at(23) }), // 1380 min — a #773 stale row
      ],
      bots: [{ id: 'bot-uuid-1', name: 'B', protocolId: 'forex-session-v1' }],
      protocols: [PROTOCOL],
    });

    const res: any = await controller.getProtocolProfitability();
    const p = res.protocols[0];

    expect(p.medianHoldMinutes).toBe(120);
    // The mean would be 360 — the stale row would drag it 3x off the truth.
    const mean = (60 + 60 + 120 + 180 + 1380) / 5;
    expect(mean).toBe(360);
    expect(p.medianHoldMinutes).not.toBe(mean);
  });
});
