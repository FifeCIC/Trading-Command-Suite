/**
 * trade-config.spec.ts — the provenance table must not be able to say "the strategy's bracket" about
 * a number the strategy does not own.
 *
 * ⚠️ THE CASE THAT MATTERS IS `bot: null`. That is what produced a wrong conclusion on 2026-11-20: a
 * run with no bot measured the engine's 1%/1% literals and the result was read as the strategy's
 * configuration. The test asserts the table calls those numbers what they are.
 */
import { buildTradeConfig, tradeConfigSummary, ENGINE_DEFAULTS } from './trade-config';

const BOT = {
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
  maxPyramidTiers: 1,
};

const get = (rows, id) => rows.find((r) => r.id === id);

describe('buildTradeConfig', () => {
  it('takes the bot’s own stop, target, entry bar and max hold, and names the columns', () => {
    const rows = buildTradeConfig(BOT);
    expect(get(rows, 'slPct')).toMatchObject({ value: 2.5, source: 'bot', applied: true });
    expect(get(rows, 'tpPct')).toMatchObject({ value: 6, source: 'bot', applied: true });
    expect(get(rows, 'minComposite')).toMatchObject({ value: 30, source: 'bot', applied: true });
    expect(get(rows, 'maxHoldHours')).toMatchObject({ value: 4, source: 'bot', applied: true });
    expect(get(rows, 'slPct').note).toContain('trading_strategy.slPct');
  });

  it('▶ CANARY — with no bot, every number is declared an engine default, not a strategy setting', () => {
    // This is the defect the whole module exists for. If this ever reports `source: 'bot'` with no
    // bot, the page is again presenting a hardcoded literal as the strategy's configuration.
    const rows = buildTradeConfig(null);
    expect(get(rows, 'slPct')).toMatchObject({ value: ENGINE_DEFAULTS.slPct, source: 'engine-default', botValue: null });
    expect(get(rows, 'tpPct')).toMatchObject({ value: ENGINE_DEFAULTS.tpPct, source: 'engine-default' });
    expect(get(rows, 'minComposite')).toMatchObject({ value: 0, source: 'engine-default' });
    expect(get(rows, 'slPct').note).toContain('no bot names this protocol');
    expect(tradeConfigSummary(null, rows)).toContain('ENGINE’S OWN DEFAULTS');
  });

  it('an explicit request beats the bot and says so, keeping the bot value beside it', () => {
    const rows = buildTradeConfig(BOT, { slPct: 5 });
    expect(get(rows, 'slPct')).toMatchObject({ value: 5, source: 'request', botValue: 2.5 });
    expect(get(rows, 'tpPct').source).toBe('bot'); // untouched fields still come from the bot
  });

  it('▶ CANARY — a field the engine ignores is reported `applied: false`, with its own reason', () => {
    // The 53-entry run is only explicable because the engine has no cooldown. Reporting the bot's 30
    // minutes as if the run honoured it would make the result a claim about a different strategy.
    const rows = buildTradeConfig(BOT);
    expect(get(rows, 'cooldownMinutes')).toMatchObject({ value: 30, applied: false });
    expect(get(rows, 'cooldownMinutes').note).toMatch(/NOT APPLIED/);
    expect(get(rows, 'cooldownMinutes').note).toContain('#1325');
    expect(get(rows, 'maxPositions').applied).toBe(false);
    expect(get(rows, 'maxPyramidTiers').applied).toBe(false);
    expect(get(rows, 'baseSize').applied).toBe(false);
    expect(get(rows, 'sessionWindow').applied).toBe(false);
  });

  it('▶ CANARY — a trailing stop is reported applied BY THE ENGINE and flagged as absent live', () => {
    // Two facts, both required. Collapsing them either hides a real mechanism from the reader or
    // implies live protection that does not exist.
    const on = get(buildTradeConfig({ ...BOT, simTslEnabled: 1 }), 'simTslEnabled');
    expect(on).toMatchObject({ value: 'on', applied: true });
    expect(on.note).toMatch(/LIVE guardian only records/);
    expect(on.note).toContain('#936');

    const off = get(buildTradeConfig({ ...BOT, simTslEnabled: 0 }), 'simTslEnabled');
    expect(off.value).toBe('off');
  });

  it('the summary names the bot and lists what it could not apply', () => {
    const rows = buildTradeConfig(BOT);
    const text = tradeConfigSummary(BOT, rows);
    expect(text).toContain('Movers V1 Long Bot');
    expect(text).toContain('INACTIVE'); // the movers bots really are active=0
    expect(text).toContain('cooldown');
  });

  it('an unset bot field falls back to the engine default rather than to null', () => {
    const rows = buildTradeConfig({ ...BOT, maxHoldHours: null });
    expect(get(rows, 'maxHoldHours')).toMatchObject({ value: 0, source: 'engine-default' });
  });

  it('never reports a NaN or undefined value as a number', () => {
    const rows = buildTradeConfig({ ...BOT, slPct: undefined, cooldownMinutes: undefined });
    expect(get(rows, 'slPct').value).toBe(ENGINE_DEFAULTS.slPct);
    expect(get(rows, 'cooldownMinutes').value).toBeNull();
  });
});
