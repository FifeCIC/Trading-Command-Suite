import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeBotConfig, type BotForBacktest } from './backtest.service';
import { buildSettingsInventory, DECLARED } from './settings-inventory';
// ⚠️ The bar comes from its OWNER, not from a literal. `validate-threshold-literals` fails the build
// on an out-of-scale number here (#839) — and it was right to: a fixture that writes `55` teaches the
// next reader that 55 is a bar this system uses. `BOT_BAR_DEFAULT` is the real one.
import { BOT_BAR_DEFAULT } from '../../common/utils/style-thresholds';

/**
 * The settings inventory's `applied` column is a CLAIM about the engine, so it is checked against the
 * engine rather than trusted.
 *
 * ⚠️ TWO DIRECTIONS, and both are needed:
 *
 *   1. **BEHAVIOURAL** — drive `mergeBotConfig()`, the real pure function `run()` calls, and prove each
 *      `honoured` bot field changes the merged request while each `ignored` field cannot.
 *   2. **SOURCE** — read `backtest.service.ts` and prove it never mentions a field this inventory calls
 *      `ignored`, and still mentions the ones it calls `honoured`. Direction 1 alone would miss a field
 *      honoured somewhere OTHER than `mergeBotConfig` (the engine reads `slPct` in the trade loop too),
 *      and direction 2 alone would miss a field that is mentioned but never actually used.
 *
 * Without this file the Lab could tell an operator "the backtest honours your stop loss" when it does
 * not — the fabricated-claim defect, on the one surface whose whole purpose is measurement.
 */

const SERVICE_PATH = join(__dirname, 'backtest.service.ts');
const serviceSource = readFileSync(SERVICE_PATH, 'utf8');
const serviceCode = stripComments(serviceSource);

/** Comments describe fields that are NOT read; leaving them in would make every `ignored` entry fail. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** A bot as `run()` receives it — every field the inventory lists, all set to a distinctive value. */
function bot(overrides: Partial<Record<string, unknown>> = {}): BotForBacktest {
  return {
    id: 'bot-1',
    name: 'Probe 1-Directive',
    symbol: 'EURUSD',
    timeframe: '1h',
    protocolId: 'probe-1dir-rsi',
    slPct: 1.5,
    tpPct: 3,
    baseSize: 0.01,
    mode: 'auto',
    active: true,
    minComposite: BOT_BAR_DEFAULT,
    maxPositions: 2,
    cooldownMinutes: 30,
    maxHoldHours: 12,
    maxPyramidTiers: 3,
    exhaustionObserveEnabled: true,
    exhaustionDecelPct: 40,
    simTslEnabled: true,
    simTslActivationPct: 1,
    simTslDistancePct: 0.5,
    sessionTags: ['london'],
    sessionWindow: 'london',
    exitBeforeUtc: '21:00',
    brokerId: 2,
    ...overrides,
  } as unknown as BotForBacktest;
}

const honouredBotFields = DECLARED.botFields.filter((f) => f.applied === 'honoured');
const ignoredBotFields = DECLARED.botFields.filter((f) => f.applied === 'ignored');
const reportedBotFields = DECLARED.botFields.filter((f) => f.applied === 'reported-only');

describe('passesBotEntryBar — the bot’s own entry gate (#1136)', () => {
  const { passesBotEntryBar } = require('./backtest.service');

  it('skips a score below the bar, passes one above it', () => {
    expect(passesBotEntryBar(8.6, 10)).toBe(false);
    expect(passesBotEntryBar(12, 10)).toBe(true);
  });

  it('PASSES a score exactly equal to the bar — the live path uses `<`, not `<=`', () => {
    // ⚠️ THE BOUNDARY, asserted because getting it wrong is invisible: `automation-loop.service.ts`
    // skips only when `gatePct < minComposite`, so a score ON the bar trades. A `<=` here would drop
    // every trade sitting exactly on the bar and nothing would report it.
    expect(passesBotEntryBar(10, 10)).toBe(true);
    expect(passesBotEntryBar(9.999, 10)).toBe(false);
  });

  it('applies no bar when the value is 0, null or undefined — "no bar" is a decision, not a gap', () => {
    expect(passesBotEntryBar(0.1, 0)).toBe(true);
    expect(passesBotEntryBar(0.1, null)).toBe(true);
    expect(passesBotEntryBar(0.1, undefined)).toBe(true);
  });

  it('treats a non-finite bar as no bar rather than skipping every trade', () => {
    // A NaN bar would make every comparison false and silently produce a run with zero trades.
    expect(passesBotEntryBar(5, Number.NaN)).toBe(true);
  });
});

describe('settings inventory — the bot fields a backtest HONOURS, proven behaviourally', () => {
  it.each(honouredBotFields.map((f) => f.key))(
    'an explicit request value for %s reaches the merged request',
    (field) => {
      // The request supplies a value different from the bot's, so `pick()` must take the request's.
      const requestValue = field === 'protocolId' ? 'another-protocol' : 'REQUEST-WINS';
      const merged = mergeBotConfig(
        { botId: 'bot-1', [field]: requestValue } as any,
        bot(),
      );
      const landed = (merged.request as Record<string, unknown>)[field];
      expect(landed).toBe(requestValue);
      expect(merged.drivenBy.overridden).toContain(field);
    },
  );

  it.each(honouredBotFields.map((f) => f.key))(
    'with no request override, %s is taken from the bot',
    (field) => {
      const merged = mergeBotConfig({ botId: 'bot-1' } as any, bot());
      expect((merged.request as Record<string, unknown>)[field]).toEqual(
        (bot() as unknown as Record<string, unknown>)[field],
      );
    },
  );

  it('the honoured set is exactly symbol, timeframe, protocolId, slPct, tpPct and minComposite', () => {
    // ⚠️ THE CANARY FOR A SILENT WIDENING **AND** FOR A SILENT REMOVAL. `minComposite` joined this set
    // on 2026-10-22 (#1136): the bot's own entry bar now gates entries, so a run cannot take a trade
    // the bot would skip. If that wire is ever removed, this fails rather than the inventory quietly
    // reverting to "ignored".
    expect(honouredBotFields.map((f) => f.key).sort()).toEqual(
      ['minComposite', 'protocolId', 'slPct', 'symbol', 'timeframe', 'tpPct'].sort(),
    );
  });
});

describe('settings inventory — the bot fields a backtest IGNORES cannot influence a run', () => {
  it.each(ignoredBotFields.map((f) => f.key))(
    '%s never appears on the merged request, whatever the bot says',
    (field) => {
      const merged = mergeBotConfig({ botId: 'bot-1' } as any, bot());
      // The merged request is a spread of the incoming request with a fixed pick() list, so a field
      // the inventory calls ignored must be absent unless the CALLER supplied it — and the caller
      // here supplied nothing.
      expect(merged.request).not.toHaveProperty(field);
    },
  );

  it.each(ignoredBotFields.map((f) => f.key))(
    '%s is never read by backtest.service at all',
    (field) => {
      // `bot.<field>` or `.<field>` — the forms a real read takes. A comment mentioning the name is
      // stripped above, so only code counts.
      const reference = new RegExp(`\\b(bot|strategy|config)\\s*\\.\\s*${field}\\b|\\b${field}\\s*:`);
      expect(serviceCode).not.toMatch(reference);
    },
  );

  it('minComposite — the entry bar an operator sets on the bot — IS carried into the run (#1136)', () => {
    // This assertion used to be the opposite (`not.toHaveProperty`), guarding the omission. Flipped
    // 2026-10-22 when the bar was wired to the same percentage comparison the live loop makes.
    const merged = mergeBotConfig({ botId: 'bot-1' } as any, bot({ minComposite: BOT_BAR_DEFAULT }));
    expect(merged.request).toHaveProperty('minComposite', BOT_BAR_DEFAULT);
    // And the field is genuinely READ by the engine now, not merely carried.
    expect(serviceCode).toMatch(/minComposite/);
  });
});

describe('settings inventory — REPORTED-ONLY fields are echoed, not obeyed', () => {
  it('mode, active and baseSize appear on drivenBy and nowhere on the request', () => {
    const merged = mergeBotConfig({ botId: 'bot-1' } as any, bot());
    expect(merged.drivenBy.mode).toBe('auto');
    expect(merged.drivenBy.active).toBe(true);
    expect(merged.drivenBy.baseSize).toBe(0.01);
    for (const f of reportedBotFields) {
      expect(merged.request).not.toHaveProperty(f.key);
    }
  });

  it('baseSize is read only to state the #843 sizing caveat', () => {
    expect(mergeBotConfig({ botId: 'bot-1' } as any, bot()).caveats.join(' ')).toMatch(/0\.01 lot/);
  });
});

describe('settings inventory — the per-protocol directive-override claims', () => {
  it('declares maxScore as the ONE applied field and the other four as inert', () => {
    const applied = DECLARED.directiveOverrideFields.filter((f) => f.applied === 'honoured');
    expect(applied.map((f) => f.key)).toEqual(['maxScore']);
    expect(DECLARED.directiveOverrideFields.map((f) => f.key).sort()).toEqual(
      ['category', 'directionBias', 'maxScore', 'minScore', 'priority'].sort(),
    );
  });

  it('matches the scorer: `maxScore` is consumed per protocol and the others are not', () => {
    // Source check against the ONE scoring path, so the claim is tied to the consumer rather than to
    // this file's opinion of it.
    const gating = stripComments(
      readFileSync(join(__dirname, '..', 'scoring', 'protocol-gating.service.ts'), 'utf8'),
    );
    expect(gating).toMatch(/override\w*\.\s*maxScore|maxScore\s*\?\?|\bmaxScore\b/);
    // ⚠️ A per-protocol `directionBias` would appear as an override lookup. If that ever lands, this
    // inventory must change with it — so the assertion states the CURRENT truth explicitly.
    expect(gating).not.toMatch(/getProtocolOverrides\(\)\s*\.get\([^)]*\)\s*\?\.\s*directionBias/);
  });
});

describe('settings inventory — the builder never fabricates a value', () => {
  it('reports an unset knob as null, not 0 or an empty string', () => {
    const { groups } = buildSettingsInventory({
      bot: { symbol: 'EURUSD', minComposite: 0 },
      protocol: { directionMode: 'LONG_ONLY' },
      settings: [],
    });
    const strategy = groups.find((g) => g.id === 'strategy')!;
    expect(strategy.rows.find((r) => r.key === 'symbol')!.value).toBe('EURUSD');
    // Set to zero — a real value, not a gap. `minComposite: 0` means "no bar", which is a decision.
    expect(strategy.rows.find((r) => r.key === 'minComposite')!.value).toBe(0);
    // Never set at all — distinct from zero, and must not collapse into it.
    expect(strategy.rows.find((r) => r.key === 'maxPositions')!.value).toBeNull();
  });

  it('an absent subject yields an EMPTY group with a note, never a missing group', () => {
    const { groups, counts } = buildSettingsInventory({ settings: [] });
    const strategy = groups.find((g) => g.id === 'strategy')!;
    expect(strategy).toBeDefined();
    expect(strategy.rows).toEqual([]);
    // "[] is information; absence is not" — the note must explain the emptiness.
    expect(strategy.note).toMatch(/select a strategy/i);
    expect(counts.total).toBe(DECLARED.runFields.length + DECLARED.directiveOverrideFields.length);
  });

  it('the RUN group exists with no subject at all, showing the engine defaults', () => {
    // ⚠️ This is the group that makes the page editable for a protocol run. Listing `slPct`/`tpPct`
    // only under "Strategy" hid the one genuinely editable pair whenever no bot was selected — found
    // by driving the live page, where the inputs were simply absent.
    const { groups } = buildSettingsInventory({ settings: [] });
    const run = groups.find((g) => g.id === 'run')!;
    expect(run.rows.map((r) => r.key)).toEqual(['minComposite', 'slPct', 'tpPct', 'timeframe']);
    expect(run.rows.every((r) => r.applied === 'honoured')).toBe(true);
    // The engine's own defaults — no bar, 1% / 1% — not null. A blank here would imply "no value"
    // while a run silently brackets at 1% and applies no entry bar.
    expect(run.rows.find((r) => r.key === 'minComposite')!.value).toBe(0);
    expect(run.rows.find((r) => r.key === 'slPct')!.value).toBe(1);
    expect(run.rows.find((r) => r.key === 'tpPct')!.value).toBe(1);
  });

  it('the RUN group shows the BOT’s entry bar — the field the operator actually set', () => {
    // ⚠️ This is the owner's requirement in one assertion: "the fields are wired to the same as used
    // by each strategy loaded". A bot set to skip anything under 10% must show 10, not the engine
    // default of 0.
    const { groups } = buildSettingsInventory({
      bot: { minComposite: 10, slPct: 1.5, tpPct: 3, timeframe: '1h' },
      settings: [],
    });
    const run = groups.find((g) => g.id === 'run')!;
    expect(run.rows.find((r) => r.key === 'minComposite')!.value).toBe(10);
  });

  it('the RUN group shows the BOT values when a bot is selected', () => {
    const { groups } = buildSettingsInventory({
      bot: { slPct: 1.5, tpPct: 3, timeframe: '1h' },
      settings: [],
    });
    const run = groups.find((g) => g.id === 'run')!;
    expect(run.rows.find((r) => r.key === 'slPct')!.value).toBe(1.5);
    expect(run.rows.find((r) => r.key === 'timeframe')!.value).toBe('1h');
  });

  it('counts every declared row and never claims more honoured than it lists', () => {
    const { groups, counts } = buildSettingsInventory({
      bot: bot() as unknown as Record<string, unknown>,
      protocol: { directionMode: 'LONG_ONLY', active: true },
      settings: [{ key: 'risk.maxDailyLossPct', label: 'Max daily loss', value: 5, source: 'db', owner: 'risk' }],
    });
    const all = groups.flatMap((g) => g.rows);
    expect(counts.total).toBe(all.length);
    expect(counts.honoured).toBe(all.filter((r) => r.applied === 'honoured').length);
    expect(counts.ignored + counts.honoured + counts.reportedOnly).toBe(counts.total);
  });
});
