/**
 * trade-config-effect.spec.ts — THE COLUMN A READER READS MUST DESCRIBE BEHAVIOUR, NOT SCHEMA.
 *
 * ⚠️ Decided 2026-11-23: the column a reader reads must describe BEHAVIOUR, not schema. The hint text is
 * kept in the note so nothing is lost, but the displayed value says what it does to the trade or the
 * decision — and where it can, it reflects the actual settings value rather than a fixed sentence.
 *
 * So `effect` is a sentence about the TRADING, and `note` keeps the provenance. The guard has two jobs:
 *
 *   1. **No row is silent.** Every row must say what its value does.
 *   2. **No schema leaks into it.** `trading_strategy.tpPct`, `bot-rules.ts`, `#1325` and `NOT APPLIED`
 *      belong in `note`; in the behavioural column they bury the sentence the reader came for.
 *
 * ⚠️ AND IT MUST BE VALUE-AWARE, which is the part a static string cannot do: a bot with no take-profit
 * and a bot with 6% must not read the same, because the difference is a trading decision.
 *
 * Canaried in both directions at the bottom: a fabricated schema leak is reported, and the real set is
 * clean.
 */
import { buildTradeConfig, type TradeConfigBot, type TradeConfigField } from './trade-config';

const BOT: TradeConfigBot = {
  id: 'bot-1',
  name: 'Movers V1 Long Bot',
  protocolId: 'movers-v1-long',
  active: 0,
  mode: 'manual',
  slPct: 2.5,
  tpPct: 6,
  minComposite: 30,
  maxHoldHours: 4,
  cooldownMinutes: 30,
  maxPositions: 1,
  sessionWindow: '["us"]',
  baseSize: 0.01,
  simTslEnabled: 0,
  maxPyramidTiers: 1,
  exitBeforeUtc: null,
  exhaustionObserveEnabled: 0,
  takeProfitAmount: null,
  brokerId: '2',
};

const rows = buildTradeConfig(BOT);
const get = (id: string, list: TradeConfigField[] = rows) => list.find((r) => r.id === id)!;

/**
 * The shapes that make a sentence technical. Each is something that was literally in the old column.
 * ⚠️ `[a-z]+_[a-z]` is the snake_case column check — it also catches `trading_strategy`.
 */
const TECHNICAL_LEAKS: Array<{ name: string; re: RegExp }> = [
  { name: 'a schema path or table.column', re: /\b[a-z]+\.[a-zA-Z]+\b/ },
  { name: 'a snake_case identifier', re: /[a-z]+_[a-z]+/ },
  { name: 'a camelCase identifier', re: /\b[a-z]+[A-Z][a-zA-Z]+\b/ },
  { name: 'a source filename', re: /\.(ts|js|prisma|json)\b/ },
  { name: 'an issue reference', re: /#\d+/ },
  { name: 'caps verdict prose', re: /\bNOT APPLIED\b|\bNOT COMPARABLE\b/ },
  { name: 'a route or endpoint', re: /\/(api|scoring|backtest)\// },
];

/** Effects that read as plumbing rather than trading. Pure, so it can be canaried. */
const leaksIn = (list: readonly TradeConfigField[]): string[] => {
  const out: string[] = [];
  for (const row of list) {
    for (const leak of TECHNICAL_LEAKS) {
      // ⚠️ `applied` rows are allowed to say "this run" — that is behaviour. Only the identifier shapes
      // and the verdict caps are leaks.
      if (leak.re.test(row.effect ?? '')) out.push(`${row.id}: ${leak.name}`);
    }
  }
  return out;
};

describe('trade-config effect column', () => {
  it('every row says what its value does', () => {
    // Guard against the guard: an empty table would pass every assertion below.
    expect(rows.length).toBeGreaterThan(12);
    const silent = rows.filter((r) => !r.effect || r.effect.trim().length < 30);
    expect(silent.map((r) => r.id)).toEqual([]);
  });

  it('no row explains the schema, the file or the issue number', () => {
    expect(leaksIn(rows)).toEqual([]);
  });

  it('▶ CANARY — a schema leak is reported', () => {
    const dirty = rows.map((r) =>
      r.id === 'tpPct' ? { ...r, effect: 'Read from trading_strategy.tpPct — see #1325' } : r,
    );
    expect(leaksIn(dirty).length).toBeGreaterThan(0);
    expect(leaksIn(dirty).some((x) => x.startsWith('tpPct:'))).toBe(true);
  });

  it('the take-profit sentence follows the VALUE — banking and riding cannot read alike', () => {
    const banking = get('tpPct');
    expect(banking.effect).toContain('6%');
    expect(banking.effect).toMatch(/banked/i);

    // 0 is the bot saying "no target", and the sentence must say the opposite thing about the trade.
    const riding = get('tpPct', buildTradeConfig({ ...BOT, tpPct: 0 }));
    expect(riding.effect).toMatch(/No take-profit/i);
    expect(riding.effect).not.toBe(banking.effect);
  });

  it('▶ CANARY — an UNSET bot value is the engine’s 1%, never “no target”', () => {
    // ⚠️ The distinction this guards: `tpPct: null` does NOT mean "no take-profit". The run falls back
    // to the engine literal (1%), and the sentence must describe the number that was actually used.
    // Reporting "no target" here would invent a strategy that does not exist — the exact defect
    // `trade-config.spec.ts` was written for.
    const unset = get('tpPct', buildTradeConfig({ ...BOT, tpPct: null }));
    expect(unset.source).toBe('engine-default');
    expect(unset.value).toBe(1);
    expect(unset.effect).toContain('1%');
    expect(unset.effect).not.toMatch(/No take-profit/i);
  });

  it('the stop-loss sentence follows the VALUE', () => {
    expect(get('slPct').effect).toContain('2.5%');
    expect(get('slPct', buildTradeConfig({ ...BOT, slPct: 0 })).effect).toMatch(/No stop loss/i);
  });

  it('a zero time stop and a real one are different sentences', () => {
    expect(get('maxHoldHours').effect).toContain('4 hours');
    expect(get('maxHoldHours', buildTradeConfig({ ...BOT, maxHoldHours: 0 })).effect).toMatch(/No time stop/i);
  });

  it('a cooldown that this run ignores says so, in trading words', () => {
    const independent = get('cooldownMinutes');
    expect(independent.applied).toBe(false);
    expect(independent.effect).toMatch(/does not apply/i);
    const portfolio = get('cooldownMinutes', buildTradeConfig(BOT, { admission: 'portfolio' }));
    expect(portfolio.applied).toBe(true);
    expect(portfolio.effect).toMatch(/no further entry/i);
  });

  it('the session window names the session instead of printing the stored JSON', () => {
    expect(get('sessionWindow').effect).toContain('US');
    expect(get('sessionWindow').effect).not.toContain('["us"]');
  });

  it('the provenance is still there — moving it out of the column must not lose it', () => {
    expect(get('slPct').note).toContain('trading_strategy.slPct');
    expect(get('cooldownMinutes').note).toContain('#1325');
  });
});
