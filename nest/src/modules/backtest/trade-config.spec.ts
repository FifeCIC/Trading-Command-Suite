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
  it('▶ CANARY — a column LIVE does not honour says so in the row a reader actually sees', () => {
    // Measured 2026-11-20: `strategy.maxPositions` is read on the live dispatch path by nothing — the
    // live cap is the GLOBAL `risk.maxOpenPositions`. Before this case the row said only "the engine
    // has no concurrency model", which a reader takes as "live enforces my maxPositions: 1". It does not.
    const rows = buildTradeConfig(BOT);
    const maxPos = get(rows, 'maxPositions');
    expect(maxPos.live).toBe('legacy-only');
    expect(maxPos.note).toMatch(/LIVE: LEGACY PATH ONLY/);
    // The other direction: a column live DOES honour must not carry the warning, or every row is noise.
    expect(get(rows, 'slPct').live).toBe('live');
    expect(get(rows, 'slPct').note).not.toMatch(/LIVE: /);
  });

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
    // `sessionWindow` and `exitBeforeUtc` both moved OUT of this list on 2026-11-20 (#1242) — the engine
    // now applies the bot's trading clock and its flat-by boundary. They are asserted in the honoured
    // direction above instead, so the change is recorded rather than the assertions being dropped.
    expect(get(rows, 'sessionWindow').applied).toBe(true);
    expect(get(rows, 'exitBeforeUtc').applied).toBe(true);
  });

  it('▶ CANARY — a trailing stop is reported applied BY THE ENGINE and flagged as absent live', () => {
    // Two facts, both required. Collapsing them either hides a real mechanism from the reader or
    // implies live protection that does not exist.
    const on = get(buildTradeConfig({ ...BOT, simTslEnabled: 1, simTslActivationPct: 2, simTslDistancePct: 1 }), 'simTslEnabled');
    expect(on).toMatchObject({ value: 'on', applied: true });
    expect(on.note).toMatch(/LIVE guardian only records/);
    expect(on.note).toContain('#936');

    const off = get(buildTradeConfig({ ...BOT, simTslEnabled: 0 }), 'simTslEnabled');
    expect(off.value).toBe('off');
  });

  /**
   * ⚠️ MEASURED, 2026-11-23 — `Movers V1 Long Bot` has `simTslEnabled = 1` with BOTH percentages NULL.
   * `simTslPlan()` returns null for that, so the engine applied no trail at all, while this row said
   * "the stop is moved up behind the price". A reader was told the protection existed.
   */
  it('▶ CANARY — a switch with empty percentages says NO trail is applied, not that one is', () => {
    const inert = get(buildTradeConfig({ ...BOT, simTslEnabled: 1 }), 'simTslEnabled');
    expect(inert.value).toBe('on');
    expect(inert.effect).toMatch(/NO trailing stop is applied/);
    expect(inert.effect).not.toMatch(/moved up behind the price/);
    expect(inert.note).toContain('simTslDistancePct');
  });

  it('a half-configured trail (activation only) is still reported as no trail', () => {
    const half = get(buildTradeConfig({ ...BOT, simTslEnabled: 1, simTslActivationPct: 2 }), 'simTslEnabled');
    expect(half.effect).toMatch(/NO trailing stop is applied/);
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

describe('trade-config — the stop rows read as one group (2026-11-23)', () => {
  /**
   * ⚠️ ORDER IS THE REQUEST. "Trailing stop" sat below take-profit and the entry bar, so the three
   * things that decide where a loss stops being taken did not read as a group. This asserts the order
   * so a later tidy cannot silently separate them again.
   */
  it('▶ CANARY — the fixed stop, then what moves it, then what live does that the engine does not', () => {
    const rows = buildTradeConfig(BOT);
    const iSl = rows.findIndex((r) => r.id === 'slPct');
    const iTrail = rows.findIndex((r) => r.id === 'simTslEnabled');
    const iGuard = rows.findIndex((r) => r.id === 'stopGuard');
    expect(iSl).toBeGreaterThanOrEqual(0);
    expect(iTrail).toBe(iSl + 1);
    expect(iGuard).toBe(iTrail + 1);
  });

  /**
   * ⚠️ MEASURED 2026-11-23: `stop_adjustment` holds 5,328 rows written by the Stop Guardian
   * (consensus >= 55, trail = 3 x ATR, wick filter can leave the stop alone). The engine has none of it,
   * and none of the three numbers is a bot column or a setting — so there is nothing to edit and the
   * absence of a value is correct, not a missing field.
   */
  it('▶ CANARY — the live-only stop guard says NOT APPLIED and names its three constants', () => {
    const g = get(buildTradeConfig(BOT), 'stopGuard');
    expect(g.applied).toBe(false);
    expect(g.note).toContain('NOT APPLIED');
    expect(g.note).toContain('55');
    expect(g.note).toContain('ATR');
    expect(g.note).toContain('stop_adjustment');
  });
});

describe('trade-config — the description follows the box (2026-11-23)', () => {
  /**
   * ⚠️ MEASURED: the owner changed Stop loss to 5 and the sentence still read "closed once it is 2.5%
   * against you". `effect` is computed from the STORED column, so it described the old number from the
   * moment a value was typed. The panel now substitutes the box's value into `effectTemplate`, and these
   * cases hold the two halves the panel depends on.
   */
  it('▶ CANARY — every value-embedding row carries a {value} template, and the stored sentence IS that template rendered', () => {
    const rows = buildTradeConfig(BOT);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ['slPct', 'tpPct', 'minComposite', 'maxHoldHours', 'baseSize']) {
      const r = byId.get(id);
      expect(r?.effectTemplate?.positive).toContain('{value}');
    }
    const sl = byId.get('slPct')!;
    // The stored effect and the template must be the SAME sentence, or the page would change wording the
    // instant someone typed — which is worse than not following the value at all.
    expect(sl.effect).toBe(sl.effectTemplate!.positive!.replace('{value}', '2.5%'));
  });

  it('▶ CANARY — a zero value selects the ZERO sentence, and it is the same string both ways', () => {
    const sl = buildTradeConfig({ ...BOT, slPct: 0 }).find((r) => r.id === 'slPct')!;
    expect(sl.effect).toMatch(/No stop loss/);
    expect(sl.effectTemplate!.zero).toBe(sl.effect);
    const tp = buildTradeConfig({ ...BOT, tpPct: 0 }).find((r) => r.id === 'tpPct')!;
    expect(tp.effectTemplate!.zero).toBe(tp.effect);
  });
});
