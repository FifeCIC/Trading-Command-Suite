import { SignalQueueService } from './signal-queue.service';

/**
 * #1314 — ROUTING under feed scope, exercised against `syncQueues()` itself.
 *
 * ⚠️ WHY THIS EXISTS IN ADDITION TO `feed-scope.spec.ts`: that file proves the DECISION is right.
 * This one proves the queue USES it — that the decision is actually wired between the subscription
 * query and the queue insert. A correct pure function that nothing calls is exactly the defect the
 * repo keeps paying for, and it would pass `feed-scope.spec.ts` perfectly.
 *
 * ⚠️ It is also the only way to observe the routing branch end to end: the two movers bots are
 * `active = 0` on purpose (#1314 item 5), and `syncQueues()` selects `WHERE ts.active = 1`. Activating
 * a bot to watch it route would be doing the forbidden thing in order to test it.
 */

const FEED = {
  entryAllowed: true,
  entryRefusalReason: null,
  winners: [{ ticker: 'NXXT' }, { ticker: 'BGS' }],
  losers: [{ ticker: 'CUE' }],
};

const SIGNAL = {
  protocolId: 'movers-v1-long',
  symbol: 'NXXT',
  direction: 'LONG',
  signal: 'BUY',
  compositePct: 72,
  signalPct: 72,
  opportunityPct: 60,
  combinedStrength: 66,
  scoreId: 'score-1',
};

/** A prisma stub that answers the subscription query and records every queue insert. */
function makePrisma(sub: Record<string, unknown>) {
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  return {
    inserts,
    isAvailable: true,
    $queryRawUnsafe: async (sql: string) => {
      if (sql.includes('FROM strategy_protocol sp')) return [sub];
      // Every other read (the void pass, lineage) is empty — nothing to void.
      return [];
    },
    $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
      inserts.push({ sql, params });
      return 1;
    },
  };
}

const sub = (over: Record<string, unknown> = {}) => ({
  strategyId: 'bot-1',
  protocolId: 'movers-v1-long',
  role: 'long',
  requireDirection: null,
  strategySymbol: 'AAPL', // the PLACEHOLDER both movers bots carry
  strategyScopeMode: 'feed',
  strategyFeedList: 'winners',
  ...over,
});

const movers = (feed: typeof FEED | null) => ({ getMovers: async () => feed });

async function run(subRow: Record<string, unknown>, feed: typeof FEED | null) {
  const prisma = makePrisma(subRow);
  const svc = new SignalQueueService(prisma as any, undefined, movers(feed) as any);
  await svc.syncQueues([SIGNAL], new Set(['movers-v1-long|NXXT']));
  return prisma.inserts.filter((i) => i.sql.includes('INSERT INTO strategy_signal_queue'));
}

describe('syncQueues — feed scope reaches the queue (#1314)', () => {
  it('QUEUES a ticker that is on today\'s list, despite the bot\'s placeholder symbol', async () => {
    const inserts = await run(sub(), FEED);
    expect(inserts).toHaveLength(1);
    // The row is written for the FEED ticker, not the placeholder.
    expect(inserts[0].params).toContain('NXXT');
    expect(inserts[0].params).not.toContain('AAPL');
  });

  it('QUEUES NOTHING when the ticker is not on today\'s list', async () => {
    const inserts = await run(sub(), { ...FEED, winners: [{ ticker: 'BGS' }] });
    expect(inserts).toHaveLength(0);
  });

  it('QUEUES NOTHING when the feed says entry is not allowed — it never widens', async () => {
    const inserts = await run(sub(), { ...FEED, entryAllowed: false, entryRefusalReason: 'stale' });
    expect(inserts).toHaveLength(0);
  });

  it('QUEUES NOTHING when the feed cannot be read at all', async () => {
    const inserts = await run(sub(), null);
    expect(inserts).toHaveLength(0);
  });

  it('QUEUES NOTHING when a feed-scoped bot declares no list', async () => {
    const inserts = await run(sub({ strategyFeedList: null }), FEED);
    expect(inserts).toHaveLength(0);
  });

  it('reads the LOSERS list for a feedList of losers, not the winners list', async () => {
    const short = {
      ...SIGNAL,
      protocolId: 'movers-v1-short',
      symbol: 'CUE',
      direction: 'SHORT',
      signal: 'SELL',
    };
    const prisma = makePrisma(sub({ protocolId: 'movers-v1-short', role: 'short', strategyFeedList: 'losers' }));
    const svc = new SignalQueueService(prisma as any, undefined, movers(FEED) as any);
    await svc.syncQueues([short], new Set(['movers-v1-short|CUE']));
    const inserts = prisma.inserts.filter((i) => i.sql.includes('INSERT INTO strategy_signal_queue'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params).toContain('CUE');
  });
});

describe('syncQueues — fixed scope is unchanged by #1314', () => {
  it('still queues the pinned symbol', async () => {
    const prisma = makePrisma(sub({ strategyScopeMode: 'fixed', strategyFeedList: null, strategySymbol: 'NXXT' }));
    const svc = new SignalQueueService(prisma as any);
    await svc.syncQueues([SIGNAL], new Set(['movers-v1-long|NXXT']));
    const inserts = prisma.inserts.filter((i) => i.sql.includes('INSERT INTO strategy_signal_queue'));
    expect(inserts).toHaveLength(1);
  });

  it('still refuses a different symbol', async () => {
    const prisma = makePrisma(sub({ strategyScopeMode: 'fixed', strategyFeedList: null, strategySymbol: 'AAPL' }));
    const svc = new SignalQueueService(prisma as any);
    await svc.syncQueues([SIGNAL], new Set(['movers-v1-long|NXXT']));
    expect(prisma.inserts.filter((i) => i.sql.includes('INSERT INTO strategy_signal_queue'))).toHaveLength(0);
  });

  it('does NOT call the movers service at all — a fixed deployment pays nothing for #1314', async () => {
    let calls = 0;
    const prisma = makePrisma(sub({ strategyScopeMode: 'fixed', strategyFeedList: null, strategySymbol: 'NXXT' }));
    const svc = new SignalQueueService(prisma as any, undefined, {
      getMovers: async () => {
        calls += 1;
        return FEED;
      },
    } as any);
    await svc.syncQueues([SIGNAL], new Set(['movers-v1-long|NXXT']));
    expect(calls).toBe(0);
  });
});
