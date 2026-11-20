/**
 * trade-config.ts — WHERE EACH TRADE-MANAGEMENT NUMBER CAME FROM.
 *
 * ── THE QUESTION THIS ANSWERS ───────────────────────────────────────────────────────────────────
 * "The strategy lost on a +430% mover because of its 1%/1% bracket." That sentence was WRONG, and the
 * way it was wrong is the reason this module exists. Measured 2026-11-20:
 *
 *     trading_strategy "Movers V1 Long Bot": slPct 2.5 · tpPct 6 · minComposite 30
 *                                            maxHoldHours 4 · cooldownMinutes 30 · maxPositions 1
 *     the backtest that produced the sentence: slPct 1 · tpPct 1 · minComposite 0 · no hold · no cooldown
 *
 * The run used the ENGINE'S LITERALS because it was never handed the bot. So the conclusion described
 * a configuration no bot runs. Three sources can supply a trade-management value, and until they were
 * separated nothing could tell them apart:
 *
 *   `bot`            a `trading_strategy` record — the only DATA-DRIVEN source, and the only one a
 *                    live trade obeys.
 *   `request`        the caller overrode it for this run.
 *   `engine-default` a literal in `backend.service.run()` — a HARDCODED value that is correct for no
 *                    strategy in particular.
 *
 * ⚠️ `applied: false` IS NOT A POLITE WAY OF SAYING "0". It means the engine does not read that field
 * at all, so the run's result says nothing about it. Reporting the bot's 30-minute cooldown as if the
 * run honoured it would turn a 53-entry result into a claim about a strategy that takes at most two
 * trades an hour. Each `applied: false` row carries the reason and the issue that would fix it.
 *
 * Pure: the caller supplies the bot row and the request, so every branch is testable without Prisma.
 */
import { BOT_RULES } from '../trading/bot-rules';

export type TradeConfigSource = 'bot' | 'request' | 'engine-default';

/**
 * Live's own verdict on the same column, imported from `trading/bot-rules.ts` rather than restated.
 *
 * ⚠️ THIS EXISTS BECAUSE `applied: false` WAS BEING READ AS "LIVE DOES IT, THE ENGINE DOESN'T". For
 * `maxPositions` that reading is wrong in both halves: measured 2026-11-20, `strategy.maxPositions` is
 * read on the live dispatch path by nothing (only `TradingGatesService`, whose `evaluate()` is called
 * from a REST controller, and the legacy path), and the live cap is the GLOBAL
 * `risk.maxOpenPositions` (default 5, broker-wide). A reader told "the engine has no concurrency model"
 * concludes the bot's `maxPositions: 1` is protecting them live; it is not. One source for that fact —
 * `bot-rules.ts`, which is the column-by-column declaration — means this table cannot drift from it.
 */
export type LiveEnforcement = 'live' | 'legacy-only' | 'display-only' | 'none';

export interface TradeConfigField {
  id: string;
  label: string;
  /** The value the RUN used. `null` when the engine has no equivalent. */
  value: number | string | null;
  unit?: string;
  source: TradeConfigSource;
  /** FALSE means the engine ignores this field, so the result says nothing about it. */
  applied: boolean;
  /** Where the number lives — a column, a literal site, or why it cannot be applied. */
  note: string;
  /** The bot's own value when it differs from what the run used, so the divergence is visible. */
  botValue?: number | string | null;
  /** What LIVE does with the same column. Absent for values that are not bot columns. */
  live?: LiveEnforcement;
  /** Live's own caveat, verbatim from `bot-rules.ts` — never a second wording of the same fact. */
  liveNote?: string | null;
}

/** The subset of `trading_strategy` this module reads. */
export interface TradeConfigBot {
  id: string;
  name: string;
  protocolId?: string | null;
  active?: number | boolean | null;
  mode?: string | null;
  slPct?: number | null;
  tpPct?: number | null;
  minComposite?: number | null;
  maxHoldHours?: number | null;
  cooldownMinutes?: number | null;
  maxPositions?: number | null;
  sessionWindow?: string | null;
  baseSize?: number | null;
  simTslEnabled?: number | boolean | null;
  maxPyramidTiers?: number | null;
  /**
   * ⚠️ THERE IS NO `sessionTags` COLUMN. `settings-inventory.ts` listed it as an ignored bot field for
   * months, and a reader was told a knob existed and was ignored — when there was nothing to ignore.
   * Verified against the schema 2026-11-20 and removed from both files.
   */
  exitBeforeUtc?: string | null;
  exhaustionObserveEnabled?: number | boolean | null;
  /** Absolute money take-profit, in account currency. Extracted to `money-target.ts`; not modelled here. */
  takeProfitAmount?: number | null;
  brokerId?: string | null;
}

/** The subset of `SelectionRunRequest` that can override a bot value. */
export interface TradeConfigRequest {
  slPct?: number;
  tpPct?: number;
  minComposite?: number;
  accountSize?: number;
  commission?: number;
}

/**
 * The engine's own literals, read from `BacktestService.run()`'s destructure. Kept here as a NAMED
 * copy rather than re-exported, because importing the service into a pure module would drag Prisma in.
 * ⚠️ `settings-inventory.spec.ts` pins that the engine's honoured bot fields land in `overridden`; if
 * one of these literals changes there without changing here, this table starts describing a different
 * run. The values are asserted against the run's own echo (`bracketStopNominalPct`) at the call site.
 */
export const ENGINE_DEFAULTS = {
  slPct: 1,
  tpPct: 1,
  minComposite: 0,
  maxHoldHours: 0,
  accountSize: 10000,
  positionModel: 'fixedPercent',
} as const;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Build the provenance table the page renders.
 *
 * `bot === null` is a REAL state and a common one: no stored bot names this protocol. Every value is
 * then `engine-default`, and the caveat says the numbers describe no deployed configuration.
 */
export function buildTradeConfig(bot: TradeConfigBot | null, request: TradeConfigRequest = {}): TradeConfigField[] {
  const overridden = (requested: number | undefined, fromBot: number | null): TradeConfigSource =>
    requested !== undefined ? 'request' : fromBot !== null ? 'bot' : 'engine-default';

  const pick = (requested: number | undefined, fromBot: number | null, fallback: number): number =>
    requested !== undefined ? requested : fromBot !== null ? fromBot : fallback;

  const botSl = num(bot?.slPct);
  const botTp = num(bot?.tpPct);
  const botBar = num(bot?.minComposite);
  const botHold = num(bot?.maxHoldHours);

  const rows: TradeConfigField[] = [
    {
      id: 'slPct',
      label: 'Stop loss',
      value: pick(request.slPct, botSl, ENGINE_DEFAULTS.slPct),
      unit: '%',
      source: overridden(request.slPct, botSl),
      applied: true,
      note: bot ? 'trading_strategy.slPct' : 'a literal in BacktestService.run() — no bot names this protocol',
      botValue: botSl,
    },
    {
      id: 'tpPct',
      label: 'Take profit',
      value: pick(request.tpPct, botTp, ENGINE_DEFAULTS.tpPct),
      unit: '%',
      source: overridden(request.tpPct, botTp),
      applied: true,
      note: bot ? 'trading_strategy.tpPct' : 'a literal in BacktestService.run() — no bot names this protocol',
      botValue: botTp,
    },
    {
      id: 'minComposite',
      label: 'Entry bar',
      value: pick(request.minComposite, botBar, ENGINE_DEFAULTS.minComposite),
      unit: '%',
      source: overridden(request.minComposite, botBar),
      applied: true,
      note: bot
        ? 'trading_strategy.minComposite — the second, tighter gate after the protocol threshold'
        : 'a literal in BacktestService.run() — every signal the protocol emits is traded',
      botValue: botBar,
    },
    {
      id: 'maxHoldHours',
      label: 'Max hold',
      value: botHold ?? ENGINE_DEFAULTS.maxHoldHours,
      unit: 'h',
      source: botHold !== null ? 'bot' : 'engine-default',
      applied: true,
      // 0 = no limit, which is the engine's own documented default when the bot sets none.
      note: botHold !== null ? 'trading_strategy.maxHoldHours' : 'no time stop — the engine holds until stop, target or end of data',
      botValue: botHold,
    },
    {
      id: 'simTslEnabled',
      label: 'Trailing stop',
      value: bot?.simTslEnabled ? 'on' : 'off',
      source: 'bot',
      // ⚠️ `applied: true` FOR THE ENGINE AND A WARNING FOR THE READER — both facts at once. The engine
      // really does move the stop to the trail; the live guardian only records the decision point
      // (#936). A result therefore shows protection the live bot does not have, which is worse than a
      // missing feature because it reads as a safety net.
      applied: true,
      note: 'The ENGINE moves the stop to the trail. The LIVE guardian only records the decision point (#936) — '
        + 'so a run with a trailing stop shows protection the live bot does not yet have.',
      botValue: bot?.simTslEnabled ? 'on' : 'off',
    },
    {
      id: 'cooldownMinutes',
      label: 'Cooldown',
      value: num(bot?.cooldownMinutes),
      unit: 'min',
      source: 'bot',
      applied: false,
      note:
        'NOT APPLIED — the engine has no cooldown, because overlapping hypothetical positions make the window ambiguous. '
        + 'A run can therefore open one trade per bar while the live bot waits. See #1325.',
      botValue: num(bot?.cooldownMinutes),
    },
    {
      id: 'maxPositions',
      label: 'Max positions',
      value: num(bot?.maxPositions),
      source: 'bot',
      applied: false,
      note: 'NOT APPLIED — the engine has no concurrency model; it evaluates each bar against one position per symbol.',
      botValue: num(bot?.maxPositions),
    },
    {
      id: 'maxPyramidTiers',
      label: 'Pyramid tiers',
      value: num(bot?.maxPyramidTiers),
      source: 'bot',
      applied: false,
      note: 'NOT APPLIED — averaging into a winner is enforced LIVE (pyramid-policy.service.ts, called by the automation loop). The engine opens one trade per signal and has no blended-entry model, so a run cannot show what adding size would have done. The decision itself is extracted to `pyramid-decision.ts` (#1242).',
      botValue: num(bot?.maxPyramidTiers),
    },
    {
      id: 'exitBeforeUtc',
      label: 'Exit before (UTC)',
      value: bot?.exitBeforeUtc ?? null,
      source: 'bot',
      applied: false,
      note: 'NOT APPLIED — the #928 session boundary closes a live position at a wall-clock moment; the engine has no equivalent, so a run cannot show the overnight risk the bot avoids.',
      botValue: bot?.exitBeforeUtc ?? null,
    },
    {
      id: 'takeProfitAmount',
      label: 'Money target',
      value: num(bot?.takeProfitAmount),
      source: 'bot',
      applied: true,
      note: 'trading_strategy.takeProfitAmount — judged at each bar’s close against the trade’s own net-of-commission P&L, then closed at that close (exit reason TARGET; live `system:take-profit`). NULL/0 = no target, which is 77 of 78 bots.',
      botValue: num(bot?.takeProfitAmount),
    },
    {
      id: 'exhaustionObserveEnabled',
      label: 'Exhaustion observer',
      value: bot?.exhaustionObserveEnabled ? 'on' : 'off',
      source: 'bot',
      applied: false,
      note: 'NOT APPLIED — the live guardian records a decision point (#995) and acts on nothing; the engine has no observer.',
      botValue: bot?.exhaustionObserveEnabled ? 'on' : 'off',
    },
    {
      id: 'brokerId',
      label: 'Broker',
      value: typeof bot?.brokerId === 'string' ? bot.brokerId : null,
      source: 'bot',
      applied: false,
      note: 'NOT APPLIED — a run reads stored bars and places no order, so the venue cannot affect it. Its spread CAN, and that is the engine\'s own cost model, not this column.',
      botValue: typeof bot?.brokerId === 'string' ? bot.brokerId : null,
    },
    {
      id: 'sessionWindow',
      label: 'Session window',
      value: bot?.sessionWindow ?? null,
      source: bot?.sessionWindow ? 'bot' : 'engine-default',
      applied: true,
      note: 'trading_strategy.sessionWindow — the bot\'s trading clock, applied by the LIVE predicate `checkSessionWindow()`. A bar outside it is scored (and flagged `sessionClosed`) but not traded. Absent = ungated.',
      botValue: bot?.sessionWindow ?? null,
    },
    {
      id: 'baseSize',
      label: 'Position size',
      value: num(bot?.baseSize),
      unit: 'lot',
      source: 'bot',
      applied: false,
      note: 'NOT COMPARABLE — the live loop sends lots; this run sizes in units from an equity model (#843). P&L does not transfer.',
      botValue: num(bot?.baseSize),
    },
    {
      id: 'accountSize',
      label: 'Account size',
      value: request.accountSize ?? ENGINE_DEFAULTS.accountSize,
      unit: '$',
      source: request.accountSize !== undefined ? 'request' : 'engine-default',
      applied: true,
      note: 'the equity model every size is derived from',
    },
  ];

  /**
   * Attach live's verdict to every row that names a real `trading_strategy` column, using
   * `bot-rules.ts` as the ONE declaration of that fact.
   *
   * ⚠️ THE NOTE IS WHAT A READER ACTUALLY SEES, so a `legacy-only`/`display-only` row has to say so in
   * the note itself. Leaving it in a field nobody renders would keep the original misreading alive:
   * "the engine does not apply this" reads as "live does".
   */
  for (const row of rows) {
    const rule = BOT_RULES.find((r) => r.field === row.id);
    if (!rule) continue;
    row.live = rule.enforcement;
    row.liveNote = rule.caveat ?? null;
    if (rule.enforcement !== 'live') {
      const where = rule.enforcement === 'legacy-only'
        ? 'LIVE: LEGACY PATH ONLY — the live dispatch path does not read this column at all'
        : 'LIVE: DISPLAY ONLY — the column is read and recorded, but no live action follows from it';
      row.note = `${row.note} ⚠️ ${where}${rule.caveat ? `. ${rule.caveat}` : '.'}`;
    }
  }

  return rows;
}

/** One line for the top of the panel — which bot, and whether its config reached the run at all. */
export function tradeConfigSummary(bot: TradeConfigBot | null, fields: readonly TradeConfigField[]): string {
  if (!bot) {
    return (
      'No stored bot names this protocol, so this run used the ENGINE’S OWN DEFAULTS. '
      + 'Those are not a configuration any bot runs — the result describes the protocol’s signals at a '
      + 'bracket nobody chose.'
    );
  }
  const ignored = fields.filter((f) => !f.applied).map((f) => f.label.toLowerCase());
  const base =
    `Resolved from ${bot.name}${bot.active ? '' : ' (INACTIVE — ' + (bot.mode ?? 'unknown') + ' mode)'}. `
    + 'Stop, target, entry bar and max hold are the bot’s own values.';
  return ignored.length
    ? `${base} The engine does NOT apply: ${ignored.join(', ')} — see each row.`
    : base;
}
