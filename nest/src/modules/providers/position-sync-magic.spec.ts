/**
 * position-sync-magic.spec.ts — the broker's magic must reach the `position` row (#1354).
 *
 * ── THE DEFECT, MEASURED 2026-11-26 ───────────────────────────────────────────────────────────────
 * The MT5 bridge reported a real magic for **all 6** of its open positions:
 *
 *     GBPUSD 152962577615 → 234193      XAUUSD 152965776114 → 234181
 *     EURUSD 152968654517 → 234143      EURJPY 152968744005 → 234120
 *     USDJPY 152968854019 → 234109      GBPJPY 152971057521 → 234117
 *
 * and the database held `magic: NULL` on **all 14** rows, including three opened that same morning.
 * `position.magic` had therefore never held a value — the sync's payload never named the column, and
 * a payload that does not name a column cannot write it however many times it runs.
 *
 * ⚠️ WHY IT MATTERS, and it is money: `stop-guardian.service.ts` attributes a position to a bot by
 * magic FIRST and falls back to the order comment, which MT5 truncates. A row with no magic loses the
 * primary owner key and depends entirely on that truncated string — the shape of the #1018 incident,
 * where a live position sat unmanaged for 341 consecutive ticks.
 *
 * ⚠️ THE THREE CASES BELOW ARE THE WHOLE CONTRACT, and the third is the one a careless fix breaks:
 *   create  → write `magic: null` when the broker reported none (an honest "unknown")
 *   update  → write a non-null magic (this is the REPAIR path for rows that already exist)
 *   update  → write NOTHING when the adapter reports null, because null means "not reported" and an
 *             unconditional write would ERASE an attribution the guardian needs
 *
 * ⚠️ CANARY BOTH WAYS: delete `magic: pos.magic ?? null` from the create payload and test 1 fails;
 * make the update unconditional (`magic: pos.magic ?? null`) and test 3 fails.
 */
import { PositionSyncService } from './position-sync.service';
import { normaliseBrokerPosition } from '../automation/automation-loop.service';

function make() {
  const calls: Array<{ kind: string; args: Record<string, unknown> }> = [];
  const svc = Object.create(PositionSyncService.prototype) as PositionSyncService;
  (svc as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  (svc as any).adapterFactory = {};
  (svc as any).prisma = {
    isAvailable: true,
    position: {
      upsert: jest.fn(async (a: Record<string, unknown>) => { calls.push({ kind: 'upsert', args: a }); return {}; }),
      update: jest.fn(async (a: Record<string, unknown>) => { calls.push({ kind: 'update', args: a }); return {}; }),
      create: jest.fn(async (a: Record<string, unknown>) => { calls.push({ kind: 'create', args: a }); return {}; }),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async () => ({ count: 0 })),
      count: jest.fn(async () => 0),
    },
    trade: { findMany: jest.fn(async () => []), updateMany: jest.fn(async () => ({ count: 0 })) },
  };
  return { svc, calls };
}

const base = {
  symbol: 'XAUUSD',
  brokerTicket: '152965776114',
  side: 'buy' as const,
  quantity: 0.01,
  avgPrice: 4100,
  currentPrice: 4102,
  pnl: 2,
  sl: null,
  tp: null,
  comment: 'TCS Gold MTF Conservative B',
  openedAt: new Date('2026-11-25T15:21:18.000Z'),
  accountId: '2',
};

describe('syncPositions() persists the broker magic', () => {
  it('CREATE carries the magic the bridge reported', async () => {
    const { svc, calls } = make();
    await svc.syncPositions('mt5', [{ ...base, magic: 234181 } as never], { authoritative: true });
    const upsert = calls.find((c) => c.kind === 'upsert');
    expect(upsert).toBeDefined();
    expect((upsert!.args.create as Record<string, unknown>).magic).toBe(234181);
  });

  it('CREATE carries an explicit null when the broker reported none — "unknown" is a value', async () => {
    const { svc, calls } = make();
    await svc.syncPositions('mt5', [{ ...base } as never], { authoritative: true });
    const upsert = calls.find((c) => c.kind === 'upsert');
    // ⚠️ `hasOwnProperty`, not `!== undefined`: the question is whether the column was NAMED.
    expect(Object.prototype.hasOwnProperty.call(upsert!.args.create, 'magic')).toBe(true);
    expect((upsert!.args.create as Record<string, unknown>).magic).toBeNull();
  });

  it('UPDATE carries a magic, because that is how the 14 existing NULL rows are repaired', async () => {
    const { svc, calls } = make();
    await svc.syncPositions('mt5', [{ ...base, magic: 234181 } as never], { authoritative: true });
    const upsert = calls.find((c) => c.kind === 'upsert');
    expect((upsert!.args.update as Record<string, unknown>).magic).toBe(234181);
  });

  it('UPDATE never ERASES a known magic when the adapter reports null', async () => {
    const { svc, calls } = make();
    await svc.syncPositions('mt5', [{ ...base } as never], { authoritative: true });
    const upsert = calls.find((c) => c.kind === 'upsert');
    expect(Object.prototype.hasOwnProperty.call(upsert!.args.update, 'magic')).toBe(false);
  });
});

/**
 * ⚠️ THE SECOND HALF OF THE FIX, AND THE ONE THAT ACTUALLY LOST THE DATA (#1354).
 *
 * The adapter mapped `magic` correctly; `BrokerPosition` now declares it; but the automation loop
 * re-builds each position as a FIELD-BY-FIELD literal before calling `syncPositions()`, and that
 * literal did not copy the field. A fix in `syncPositions()` alone would have written
 * `magic: null` forever from an object that never carried one — the store would be correct and the
 * value would still be missing. This is the same shape as the `findAll()` mapping defect: a
 * hand-written field list is a contract, and a column it does not name cannot be saved.
 */
describe('normaliseBrokerPosition() — the REAL mapping, imported, not mirrored', () => {
  // ⚠️ An earlier version of this block re-typed the literal to test it, which proves nothing: a test
  // that duplicates the code tests the duplicate. The mapping is now an exported function precisely so
  // this suite exercises the code that runs.
  it('carries the adapter’s magic into the normalised object', () => {
    const out = normaliseBrokerPosition({
      symbol: 'XAUUSD', brokerTicket: '152965776114', side: 'buy', quantity: 0.01,
      avgCost: 4100, currentPrice: 4102, unrealizedPnl: 2, sl: null, tp: null,
      magic: 234181, comment: 'TCS Gold MTF Conservative B', openedAt: '2026-11-25T15:21:18.000Z',
      brokerId: 'mt5', brokerName: 'metaquotes', ticker: 'XAUUSD',
      marketValue: 41, unrealizedPnlPct: 0.05, currency: 'USD',
    } as never, '2');
    expect(out.magic).toBe(234181);
    expect(out.brokerTicket).toBe('152965776114');
    expect(out.accountId).toBe('2');
  });

  it('carries an explicit null when the broker reported none', () => {
    const out = normaliseBrokerPosition({ symbol: 'ACIC', quantity: 1, avgCost: 1, currentPrice: 1, magic: null } as never);
    expect(out.magic).toBeNull();
  });

  it('every field the trade path reads survives the normalisation', () => {
    // A field dropped from this literal is invisible to the compiler if the object is built loosely,
    // so the SET is asserted rather than one member — the same lesson as the findAll() mapping.
    const out = normaliseBrokerPosition({
      symbol: 'GBPUSD', brokerTicket: 152962577615, side: 'sell', quantity: 0.5,
      avgCost: 1.2, currentPrice: 1.3, unrealizedPnl: -3, sl: 1.35, tp: 1.1,
      magic: 234193, comment: 'TCS GBPUSD Session Core4 Bo', openedAt: '2026-11-25T09:59:23.000Z',
    } as never);
    expect(out).toMatchObject({
      symbol: 'GBPUSD', brokerTicket: '152962577615', side: 'sell', quantity: 0.5,
      avgPrice: 1.2, currentPrice: 1.3, pnl: -3, sl: 1.35, tp: 1.1,
      magic: 234193, accountId: null,
    });
  });
});