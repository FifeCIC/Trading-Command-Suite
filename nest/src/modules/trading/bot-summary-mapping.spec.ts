/**
 * bot-summary-mapping.spec.ts — every column the ORDER/EXIT path reads must SURVIVE `findAll()`.
 *
 * ⚠️ THE DEFECT THIS GUARDS (measured 2026-09-29).
 *
 * `findAll()` does not return the Prisma row — it builds an EXPLICIT field list, one property at a
 * time. `magic` was not in that list, so:
 *
 *     trading_strategy.magic   (seeded 234100+, accepted by the bridge, forwarded by the adapter)
 *        ↓  findAll() maps an explicit list
 *        ✗  magic is NOT in it                        ← THE BREAK — and NOTHING failed
 *     strategy.magic === undefined
 *        ↓  automation-loop passes `undefined`
 *        ↓  mt5.adapter omits it (`...(params.magic != null ? … : {})`)
 *        ↓  mt5_bridge_v2.py falls back to DEFAULT_MAGIC
 *     EVERY live position carried 234000 = "no bot attributed", and `trade.magic` was NULL on every
 *     open row.
 *
 * THREE LAYERS WERE CORRECT AND ONE HAND-WRITTEN LIST DROPPED THE VALUE. A seed, a bridge contract
 * and an adapter all agreeing proves nothing about a mapping that never named the field.
 *
 * The cost was a live position: `XAUUSD #152698800224`, owned by `Gold Swing 1H (copy)`, had NO
 * working owner key at all — its magic was the default and MT5 had stripped the parentheses from
 * its comment — so it sat UNMANAGED for **341 consecutive ticks**.
 *
 * ⚠️ THE SAME SHAPE HAS BITTEN THIS FILE BEFORE. The `maxHoldHours` docblock on `StrategySummary`
 * records that omitting it made the position time-stop silently no-op (#773). So this suite asserts
 * a SET, not one field: the defect is "a mapping that drops a column", and any member of that set
 * can be the next one dropped.
 *
 * ⚠️ CANARY: delete `magic: (s as any).magic ?? null,` from the mapping in `findAll()` and this
 * suite fails, NAMING the field and what breaks without it.
 */
import { TradingStrategyService } from './trading-strategy.service';

/**
 * Every summary field the trade/exit path READS, paired with what breaks SILENTLY if it is dropped.
 * The second element exists so a failure names the consequence, not just the column.
 */
const PATH_FIELDS: Array<[string, string]> = [
  ['id', 'nothing can address the bot at all'],
  ['name', 'the MT5 order comment becomes `TCS undefined`, so the guardian cannot resolve an owner'],
  ['symbol', 'the bot cannot be matched to the position it is meant to manage'],
  ['magic', 'every order falls back to DEFAULT_MAGIC (234000) — NO position is attributable (#1018)'],
  ['slPct', "the #927 declared-distance floor is computed from a default, not the bot's own risk"],
  ['tpPct', 'the target bracket is wrong or absent'],
  ['baseSize', 'order size falls back to a default'],
  ['minComposite', 'the entry gate cannot be applied to what the bot is trading'],
  ['active', 'an inactive bot is treated as live, or a live one as inactive'],
  ['maxHoldHours', 'the position time-stop silently NO-OPS (#773 — this exact defect)'],
  ['mode', 'auto / semi-auto dispatch cannot be decided'],
];

function make(row: Record<string, any>) {
  const svc = Object.create(TradingStrategyService.prototype) as TradingStrategyService;
  (svc as any).prisma = {
    tradingStrategy: {
      findMany: jest.fn(async () => [{ evaluations: [], protocols: [], ...row }]),
    },
    // ⚠️ THROWING ON PURPOSE. The watchlist enrichment is documented as BEST-EFFORT ("a market-scope
    // lookup must never be able to blank the strategies list"), so this doubles as the test for
    // that claim: the summary must still be produced when the enrichment cannot run.
    protocol: { findMany: jest.fn(async () => { throw new Error('no protocol table'); }) },
    watchlist: { findMany: jest.fn(async () => { throw new Error('no watchlist table'); }) },
  };
  return svc;
}

const BOT_ROW: Record<string, any> = {
  id: 'bot-1',
  name: 'Gold Swing 1H (copy)',
  symbol: 'XAUUSD',
  timeframe: '15m',
  mode: 'auto',
  active: true,
  brokerId: 'mt5',
  magic: 234138,
  slPct: 1.5,
  tpPct: 3,
  baseSize: 0.1,
  minComposite: 10,
  maxHoldHours: 24,
  cooldownMinutes: 15,
  maxPositions: 1,
};

describe('findAll() must carry every column the trade path reads', () => {
  it('no PATH_FIELD is dropped by the explicit mapping', async () => {
    const [summary] = await make(BOT_ROW).findAll();

    // ⚠️ `hasOwnProperty`, NOT `!== undefined`. A mapped field may legitimately be null, and the
    // question here is "was it CARRIED", not "is it truthy". Asserting non-undefined would pass for
    // a mapping that always writes null — the same silent defect wearing a different hat.
    const missing = PATH_FIELDS
      .filter(([field]) => !Object.prototype.hasOwnProperty.call(summary, field))
      .map(([field, breaks]) => `${field} — without it: ${breaks}`);

    expect(missing).toEqual([]);
  });

  it('magic carries the VALUE, not merely the key — a mapping that always nulls is the same defect', async () => {
    const [summary] = await make(BOT_ROW).findAll();
    expect(summary.magic).toBe(234138);
  });

  it('a bot with no magic reports null, so "unattributable" stays distinguishable from "dropped"', async () => {
    const [summary] = await make({ ...BOT_ROW, magic: null }).findAll();
    expect(Object.prototype.hasOwnProperty.call(summary, 'magic')).toBe(true);
    expect(summary.magic).toBeNull();
  });

  it('the summary still renders when the watchlist enrichment FAILS (best-effort, not required)', async () => {
    const [summary] = await make(BOT_ROW).findAll();
    expect(summary.id).toBe('bot-1');
    expect(summary.symbol).toBe('XAUUSD');
  });
});
