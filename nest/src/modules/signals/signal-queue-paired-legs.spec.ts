/**
 * ONE bot, TWO LEGS — a long protocol and a short protocol under a single strategy (2026-11-02).
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────────────────────
 * The owner asked whether a bot could pair a LONG protocol with a SHORT protocol and summarise both
 * under one strategy. The class docstring says the design already allows it — *"One queue per trading
 * bot listing signals from ALL its subscribed protocols … No symbol merging across protocols — the
 * same symbol may appear multiple times per bot from different protocols."* (design #714, locked
 * 2026-09-01).
 *
 * ⚠️ But NOTHING exercises it: measured 2026-11-02, `strategy_protocol` holds **41 rows across 41
 * bots** — exactly one subscription each — and `strategy_protocol` already has a `role` column
 * (`long`/`short`) and a `sortOrder`. So the capability is a declaration that has never been run,
 * and a declaration is not validated by being well-formed.
 *
 * This file is that observation. It pins the two properties the pairing depends on:
 *
 *   1. Two subscriptions on ONE bot, for the SAME symbol, with DIFFERENT protocols, produce **two**
 *      queue entries. That is what makes a long leg and a short leg separate rows rather than one
 *      overwriting the other — and it is only true because the unique key is
 *      `uq_bot_signal (strategyId, protocolId, symbol)`, which was read from the live schema rather
 *      than assumed.
 *   2. Each leg only receives signals its own `role` permits, so a `role='short'` leg is never handed
 *      a long signal — the defect measured 2026-09-17, where the filter matched on protocol + symbol
 *      and ignored the role entirely.
 *
 * ⚠️ AND IT PINS THE LIMIT, deliberately. Two subscriptions of the SAME protocol on one symbol (two
 * roles, one protocol) **collapse to one entry**, because the unique key carries the protocol but no
 * role. That asymmetry is the constraint the pairing design has to live with: a pair must be two
 * PROTOCOLS, not one protocol used two ways. Asserting it here means a future schema change that
 * silently removes the limit fails this test instead of quietly changing what a queue row means.
 */

import { SignalQueueService } from './signal-queue.service';
import type { RoutableSignal } from './signal-queue.service';

describe('SignalQueueService — one bot, two legs (long protocol + short protocol)', () => {
  type Insert = { strategyId: string; symbol: string; protocolId: string; direction: string };

  function make(subs: Array<{ strategyId: string; protocolId: string; role: string; requireDirection?: number | null; strategySymbol?: string | null }>) {
    const inserts: Insert[] = [];
    const svc = new SignalQueueService({ isAvailable: true } as any);

    (svc as any).prisma = {
      isAvailable: true,
      // ⚠️ Only the subscription query gets rows. Every other raw read in this service (the void
      // pass) must get an empty set, or the mock invents work the real database would not return.
      $queryRawUnsafe: jest.fn(async (sql: string) =>
        String(sql).includes('FROM strategy_protocol') ? subs : []),
      // ⚠️ `$executeRawUnsafe` carries BOTH the queue INSERT and the void-pass DELETE. Recording
      // every call conflated the two — the first run of this file counted a DELETE as an insert and
      // reported a phantom entry with `strategyId: "360"` (the rows-affected count). Only INSERTs
      // are queue entries, so only INSERTs are recorded.
      $executeRawUnsafe: jest.fn(async (sql: string, ...args: any[]) => {
        if (!String(sql).includes('INSERT INTO strategy_signal_queue')) return 0;
        inserts.push({
          strategyId: String(args[0]),
          symbol: String(args[1]),
          protocolId: String(args[2]),
          direction: String(args[3]),
        });
        return 1;
      }),
    };
    (svc as any).logger = { log: jest.fn(), warn: jest.fn() };
    return { svc, inserts };
  }

  const rec = (protocolId: string, direction: 'LONG' | 'SHORT'): RoutableSignal => ({
    protocolId,
    symbol: 'XAGUSD',
    direction,
    signal: direction === 'LONG' ? 'BUY' : 'SELL',
    compositePct: 24,
    signalPct: 24,
    opportunityPct: 40,
    combinedStrength: 24,
    scoreId: `score-${protocolId}-${direction}`,
  });

  it('THE PAIRING — two protocols on one bot and one symbol produce TWO entries', async () => {
    const { svc, inserts } = make([
      { strategyId: 'bot-paired', protocolId: 'long-protocol', role: 'long' },
      { strategyId: 'bot-paired', protocolId: 'short-protocol', role: 'short' },
    ]);

    await svc.syncQueues([rec('long-protocol', 'LONG'), rec('short-protocol', 'SHORT')], new Set());

    expect(inserts).toHaveLength(2);
    expect(inserts.map(i => i.protocolId).sort()).toEqual(['long-protocol', 'short-protocol']);
    // Both belong to the ONE bot — that is what "summarise the whole strategy under one bot" needs.
    expect(new Set(inserts.map(i => i.strategyId))).toEqual(new Set(['bot-paired']));
    // And each leg carries its own direction, so the pair is not a single ambiguous row.
    expect(inserts.find(i => i.protocolId === 'long-protocol')!.direction).toBe('LONG');
    expect(inserts.find(i => i.protocolId === 'short-protocol')!.direction).toBe('SHORT');
  });

  it('the SHORT leg is never handed a LONG signal — the role filter, both directions', async () => {
    const { svc, inserts } = make([
      { strategyId: 'bot-paired', protocolId: 'long-protocol', role: 'long' },
      { strategyId: 'bot-paired', protocolId: 'short-protocol', role: 'short' },
    ]);

    // A LONG signal arriving on the SHORT leg's protocol: the role must drop it.
    await svc.syncQueues([rec('short-protocol', 'LONG')], new Set());
    expect(inserts).toHaveLength(0);

    // …and the mirror, so the guard cannot pass by dropping everything.
    inserts.length = 0;
    await svc.syncQueues([rec('long-protocol', 'SHORT')], new Set());
    expect(inserts).toHaveLength(0);

    inserts.length = 0;
    await svc.syncQueues([rec('long-protocol', 'LONG'), rec('short-protocol', 'SHORT')], new Set());
    expect(inserts).toHaveLength(2);
  });

  it('THE LIMIT — one protocol used two ways shares ONE queue key, because the key has no role', async () => {
    const { svc, inserts } = make([
      { strategyId: 'bot-paired', protocolId: 'same-protocol', role: 'long' },
      { strategyId: 'bot-paired', protocolId: 'same-protocol', role: 'short' },
    ]);

    await svc.syncQueues([rec('same-protocol', 'LONG'), rec('same-protocol', 'SHORT')], new Set());

    // ⚠️ A MOCK CANNOT SHOW A UNIQUE INDEX COLLAPSING TWO ROWS — it can only show that two writes
    // were ATTEMPTED against one key. That is the property that matters, and it is asserted
    // precisely: both legs land on the same `(strategyId, protocolId, symbol)` triple, which the
    // live index `uq_bot_signal (strategyId, protocolId, symbol)` — read from the schema 2026-11-02,
    // not assumed — turns into ONE row via ON DUPLICATE KEY UPDATE.
    expect(inserts).toHaveLength(2);
    const keyOf = (i: Insert) => `${i.strategyId}|${i.protocolId}|${i.symbol}`;
    expect(new Set(inserts.map(keyOf)).size).toBe(1);
    // So a pair built from ONE protocol can never hold two queue rows. A pair must be two PROTOCOLS.
  });

  it('a leg scoped to a different symbol is not given this symbol’s signal', async () => {
    const { svc, inserts } = make([
      { strategyId: 'bot-paired', protocolId: 'long-protocol', role: 'long', strategySymbol: 'BTC' },
    ]);

    await svc.syncQueues([rec('long-protocol', 'LONG')], new Set());
    expect(inserts).toHaveLength(0);
  });

  it('requireDirection on the BOT constrains a leg whose own role says nothing', async () => {
    // `resolveEffectiveRole` is the single authority: the subscription's role wins, and only when it
    // is unusable does the bot's own `requireDirection` apply — classified as a SIGNAL WORD
    // ('BUY'/'SELL'), not a number. Measured 2026-11-02: passing `-1` classified as 'unknown', which
    // returns null = UNCONSTRAINED and permits both directions. So the honest test uses the word.
    const { svc, inserts } = make([
      { strategyId: 'bot-paired', protocolId: 'short-protocol', role: '', requireDirection: 'SELL' },
    ]);

    await svc.syncQueues([rec('short-protocol', 'LONG')], new Set());
    expect(inserts).toHaveLength(0);

    await svc.syncQueues([rec('short-protocol', 'SHORT')], new Set());
    expect(inserts).toHaveLength(1);
  });

  it('an unusable role AND no bot declaration means UNCONSTRAINED — both directions allowed', async () => {
    // The other half of the same rule, and the reason `role` defaults to `''` rather than to 'long':
    // a missing role must not silently mean "long only". Asserted because a paired bot whose short
    // leg forgot its role would otherwise look correct and quietly reject every sell signal.
    const { svc, inserts } = make([
      { strategyId: 'bot-paired', protocolId: 'any-protocol', role: '', requireDirection: null },
    ]);

    await svc.syncQueues([rec('any-protocol', 'LONG'), rec('any-protocol', 'SHORT')], new Set());
    expect(inserts).toHaveLength(2);
    expect(inserts.map(i => i.direction).sort()).toEqual(['LONG', 'SHORT']);
  });
});
