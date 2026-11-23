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

/**
 * What the row can be EDITED as — the server's declaration, not the page's guess.
 *
 * ── DECISION (2026-11-21, owner) ──
 * WHAT:      A bot-backed row in this table is editable, and saving it writes the `trading_strategy`
 *            record that LIVE trades obey — not a run-scoped override.
 * WHY:       Owner, on this page: *"I think we should save them as live values and so the user would be
 *            editing the same bot configuration as will be used live. Anything else becomes very
 *            complex… stop protecting the user from using a rubbish strategy they didn't test well."*
 *            A run-scoped override creates a SECOND configuration, and two copies drift — only one gets
 *            the next fix.
 * INSTEAD OF: A per-run override panel (the original Backtesting screen's model), which would have left
 *            the screen able to test numbers no bot ever runs.
 * REVERSE BY: Dropping `editable` from every row — the panel then renders read-only values again and no
 *            write path exists.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 247
 * GUARD:     nest/src/modules/backtest/trade-config-editability.spec.ts
 *
 * ⚠️ `control` is declared HERE because only the server knows which column exists and what shape its
 * value has. A page that guessed would offer an input for a field the PATCH rejects.
 */
export interface TradeConfigEditable {
  control: 'number' | 'toggle' | 'time';
  /** The unit the stored number is in — the same unit as `value`, rendered beside the input. */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /**
   * The column is `Int`. A fractional value is REJECTED by the database, so the control rounds and
   * the save is refused rather than made approximate. Asserted against the Prisma DMMF in the guard.
   */
  integer?: boolean;
  /**
   * The column accepts NULL. Without this, an empty input must be an ERROR — sending `null` to a
   * required Int/Float fails at the database, and sending `0` instead would silently change the
   * strategy to "no stop loss" or "no cooldown" while appearing to save what was typed.
   */
  nullable?: boolean;
}

export interface TradeConfigField {
  id: string;
  label: string;
  /** The value the RUN used. `null` when the engine has no equivalent. */
  value: number | string | null;
  unit?: string;
  source: TradeConfigSource;
  /** FALSE means the engine ignores this field, so the result says nothing about it. */
  applied: boolean;
  /**
   * ── WHAT THE READER SEES ────────────────────────────────────────────────────────────────────────
   * A plain-English description of what this value DOES and how it changes a trade or a decision.
   *
   * ⚠️ Decided 2026-11-23: the column was too much technical information. The provenance can live in
   * comments — nothing vital is lost — but what is DISPLAYED must describe what the value does and how it
   * affects the trade or the decisions made, ideally varying with the value itself.
   *
   * So this field is BEHAVIOURAL and VALUE-AWARE: "No stop loss" when the value is null, "closed once it
   * is 6% in profit" when it is 6. It names no column, no file and no issue — `note` keeps all of that.
   *
   * ── DECISION (2026-11-23) ──
   * WHAT:      the rendered column is `effect`; `note` stays in the payload and is never rendered.
   * WHY:      the provenance told a reader which column a number came from, never what it does. The same
   *           bot at `tpPct: 25` and at no target trades oppositely, and the sentence must differ.
   * REVERSE BY: rendering `note` again in `TradeConfigPanel`'s last cell — nothing else changes.
   * REGISTER:  docs/SETTLED-DECISIONS.md row 249
   * GUARD:     nest/src/modules/backtest/trade-config-effect.spec.ts
   */
  effect: string;
  /**
   * ── THE SENTENCE MUST FOLLOW THE BOX (owner, 2026-11-23) ───────────────────────────────────────
   * *"as I changed the value to 5 the 2.5 didn't change"* — `effect` is computed server-side from the
   * STORED column, so the moment a reader types in the input the value and its description disagree.
   *
   * So the server also sends the SAME sentence as a template, with `{value}` where the number goes, and
   * the panel substitutes the value currently in the box. One place still owns the wording: a client
   * that wrote its own sentence would drift from this file and only one would get the next fix.
   *
   * ⚠️ TWO BRANCHES BECAUSE THE SENTENCES BRANCH. `slPct: 0` says "no stop loss" while `slPct: 5` says
   * how far the stop sits, so one template could not describe both. `zero` is omitted where the
   * sentence does not change with the value.
   */
  effectTemplate?: { positive?: string; zero?: string };
  /**
   * PROVENANCE — the column, the literal site, the issue. Kept in the payload for diagnosis and asserted
   * by the specs, **not rendered**: a reader deciding whether a number is sound does not need a schema
   * path, and showing one buried the behaviour under it.
   */
  note: string;
  /** The bot's own value when it differs from what the run used, so the divergence is visible. */
  botValue?: number | string | null;
  /** What LIVE does with the same column. Absent for values that are not bot columns. */
  live?: LiveEnforcement;
  /** Live's own caveat, verbatim from `bot-rules.ts` — never a second wording of the same fact. */
  liveNote?: string | null;
  /**
   * Present when this row is a real `trading_strategy` column the panel may write. Absent = read-only:
   * the value is a request field, an engine literal, or a column with no safe free-text form.
   */
  editable?: TradeConfigEditable;
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
  /**
   * The trail's two percentages (2026-11-23). They are read HERE rather than only mapped, because the
   * switch alone does not describe behaviour: measured on `Movers V1 Long Bot`, `simTslEnabled = 1`
   * with **both** percentages NULL, so `simTslPlan()` returns null and the engine applies **no trail at
   * all** — while the table said "the stop is moved up behind the price".
   */
  simTslActivationPct?: number | null;
  simTslDistancePct?: number | null;
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
  /**
   * #1325 — which population the run measures. Only `'portfolio'` makes `cooldownMinutes` applicable,
   * and the row has to say so: the same bot read in both modes must not claim the same thing.
   */
  admission?: 'independent' | 'portfolio';
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
 * Formatting for the BEHAVIOURAL sentences. Kept here rather than in the page so a wording change is one
 * edit and every row stays consistent — `6` reads as "6%" and `2.5` as "2.5%", never "6.0%".
 */
const pct = (n: number): string => `${Number.isInteger(n) ? n : Number(n.toFixed(2))}%`;
const hours = (n: number): string => `${Number.isInteger(n) ? n : Number(n.toFixed(2))} hour${n === 1 ? '' : 's'}`;
const minutes = (n: number): string => `${Number.isInteger(n) ? n : Number(n.toFixed(0))} minute${n === 1 ? '' : 's'}`;
const money = (n: number): string => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * `["us"]` → "the US session". An unreadable window is echoed rather than guessed: a sentence that
 * invents a session name is worse than one that shows the stored string.
 */
const SESSION_NAME: Record<string, string> = {
  asian: 'Asian',
  frankfurt: 'Frankfurt',
  london: 'London',
  us: 'US',
  ny: 'New York',
  sydney: 'Sydney',
};

function sessionText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) ids = parsed.filter((x) => typeof x === 'string');
    else if (typeof parsed === 'string') ids = [parsed];
  } catch {
    return raw;
  }
  if (!ids.length) return raw;
  return ids.map((id) => SESSION_NAME[id.toLowerCase()] ?? id).join(' + ');
}

/**
 * Build the provenance table the page renders.
 *
 * `bot === null` is a REAL state and a common one: no stored bot names this protocol. Every value is
 * then `engine-default`, and the caveat says the numbers describe no deployed configuration.
 */
export function buildTradeConfig(bot: TradeConfigBot | null, request: TradeConfigRequest = {}): TradeConfigField[] {
  /**
   * ── THE SENTENCES, AS TEMPLATES (owner, 2026-11-23) ─────────────────────────────────────────────
   * *"as I changed the value to 5 the 2.5 didn't change."* Each sentence is declared ONCE with
   * `{value}` where the number goes: the stored value renders `effect`, and the panel substitutes the
   * number currently in the box into `effectTemplate`. A client writing its own sentence would drift;
   * a second copy here would too. These constants ARE the wording.
   *
   * ⚠️ A `_ZERO` variant exists only where the sentence genuinely changes at zero — "no stop loss" is a
   * different fact from "closed 5% against you", not a small number.
   */
  const SL_POSITIVE = 'A losing trade is closed once it is {value} against you. This is the loss a bad entry costs.';
  const SL_ZERO = 'No stop loss: a losing trade is only closed by a time stop or the session close, so one bad entry can run a long way.';
  const TP_POSITIVE = '{value} is banked and the trade closes there. It caps a winner: the rest of the move is given up.';
  const TP_ZERO = 'No take-profit: a winner runs until the stop, the trail, the time stop or the session close — so an open profit can be given back.';
  const BAR_POSITIVE = 'A bar must score at least {value} to be traded at all. Raise it for fewer, better entries; lower it for more trades of weaker quality.';
  const HOLD_POSITIVE = 'An open position is closed after {value}, whatever its profit or loss — so no trade is carried indefinitely.';
  const HOLD_ZERO = 'No time stop: a trade runs until its stop, its target or the session close.';
  const SIZE_POSITIVE = '{value} lot per entry. It sets the money each trade risks and earns — not when or whether it opens. This run sizes in units instead, so its P&L does not carry across to this lot size.';
  const SIZE_ZERO = 'The lot size of each entry, which sets the money risked per trade. This run sizes in units instead, so its P&L does not carry across.';

  const overridden = (requested: number | undefined, fromBot: number | null): TradeConfigSource =>
    requested !== undefined ? 'request' : fromBot !== null ? 'bot' : 'engine-default';

  const pick = (requested: number | undefined, fromBot: number | null, fallback: number): number =>
    requested !== undefined ? requested : fromBot !== null ? fromBot : fallback;

  const botSl = num(bot?.slPct);
  const botTp = num(bot?.tpPct);
  const botBar = num(bot?.minComposite);
  const botHold = num(bot?.maxHoldHours);

  /**
   * The trail needs BOTH percentages, exactly as `simTslPlan()` does. Computed once here so the row's
   * value, its sentence and its note cannot disagree about whether a trail exists.
   */
  const tslPct = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const tslConfigured = tslPct(bot?.simTslActivationPct) !== null && tslPct(bot?.simTslDistancePct) !== null;

  // One computation per value, so the `value` a reader sees and the sentence describing it cannot
  // disagree about the number they are both talking about.
  const sl = pick(request.slPct, botSl, ENGINE_DEFAULTS.slPct);
  const tp = pick(request.tpPct, botTp, ENGINE_DEFAULTS.tpPct);
  const bar = pick(request.minComposite, botBar, ENGINE_DEFAULTS.minComposite);
  const hold = botHold ?? ENGINE_DEFAULTS.maxHoldHours;

  const rows: TradeConfigField[] = [
    {
      id: 'slPct',
      label: 'Stop loss',
      value: sl,
      unit: '%',
      source: overridden(request.slPct, botSl),
      applied: true,
      effect: sl > 0
        ? `A losing trade is closed once it is ${pct(sl)} against you. This is the loss a bad entry costs.`
        : SL_ZERO,
      effectTemplate: { positive: SL_POSITIVE, zero: SL_ZERO },
      note: bot ? 'trading_strategy.slPct' : 'a literal in BacktestService.run() — no bot names this protocol',
      botValue: botSl,
      editable: { control: 'number', unit: '%', min: 0, max: 100, step: 0.1, nullable: true },
    },
    /**
     * ── ORDER IS PART OF THE MEANING (owner, 2026-11-23) ─────────────────────────────────────────
     * "Trailing stop" sat several rows below "Stop loss", with take-profit and the score bar between
     * them, so the three things that decide where a loss stops being taken did not read as a group.
     * The two stop rows now sit together, in the order they act: the fixed stop first, then what moves it.
     */
    {
      id: 'simTslEnabled',
      label: 'Trailing stop',
      /**
       * ── A SWITCH THAT IS ON IS NOT A TRAIL THAT EXISTS (2026-11-23) ───────────────────────────
       * `simTslPlan()` needs THREE columns: the switch, an activation % and a distance %. Measured on
       * `Movers V1 Long Bot`: `simTslEnabled = 1` with **both percentages NULL**, so the plan was null
       * and the engine applying nothing — while this row read *"the stop is moved up behind the price"*.
       * A result showed a flat stop and the table claimed protection, which is the worse direction to
       * be wrong in: the owner was told the protection existed.
       */
      // ⚠️ `value` IS THE TOGGLE'S ACTUAL STATE, always `'on'`/`'off'` — `trade-config-editability.spec.ts`
      // holds that contract, and it is right to: the control shows a switch, so its value must be one the
      // switch can display. The "nothing is applied" fact belongs in the SENTENCE, which is the column the
      // reader was asked to read for behaviour.
      value: bot?.simTslEnabled ? 'on' : 'off',
      source: 'bot',
      // ⚠️ `applied: true` FOR THE ENGINE AND A WARNING FOR THE READER — both facts at once. The engine
      // really does move the stop to the trail; the live guardian only records the decision point
      // (#936). A result therefore shows protection the live bot does not have, which is worse than a
      // missing feature because it reads as a safety net.
      applied: true,
      effect: !bot?.simTslEnabled
        ? 'The stop never moves: the entry stop is the only protection, so a pullback can return to it and close the trade at a loss.'
        : tslConfigured
          ? 'The stop is moved up behind the price as a trade runs, so a winner is protected instead of given back. Live, a trailing stop is only recorded, not applied.'
          : 'NO trailing stop is applied: the switch is on, but the activation and distance percentages are empty, so there is nothing to apply and the stop never moves. The entry stop is the only protection.',
      note: !bot?.simTslEnabled
        ? 'The LIVE guardian only records the decision point (#936) — and this bot has the trail off.'
        : tslConfigured
          ? 'The ENGINE moves the stop to the trail. The LIVE guardian only records the decision point (#936) — '
            + 'so a run with a trailing stop shows protection the live bot does not yet have.'
          : '⚠️ `simTslEnabled` is on but `simTslActivationPct` / `simTslDistancePct` are NULL — '
            + '`simTslPlan()` returns null for a half-configured trail. Fill both to make the switch mean something.',
      botValue: bot?.simTslEnabled ? 'on' : 'off',
      editable: { control: 'toggle' },
    },
    /**
     * ── THE STOP THE LIVE ACCOUNT ACTUALLY MOVES, AND THE ENGINE DOES NOT HAVE (2026-11-23) ──────
     *
     * Measured: `stop_adjustment` holds **5,328 rows**, last written today, with reasons of the form
     * `Consensus 62 | ATR=0.00033 | dist=1.000% | slPct=1 | Wick=50`. That is the Stop Guardian
     * (`modules/automation/stop-guardian.service.ts`): it tightens the **broker's** stop when a
     * directive consensus clears **55**, places it **3 × ATR** away, and has a **wick filter** that can
     * judge a move a fakeout and deliberately leave the stop alone (`wick-fakeout`).
     *
     * ⚠️ THAT IS THE THING THE OWNER CALLED THE "SIMULATED STOP LOSS — applied by the app when it
     * decides the move was not a premature trigger". It exists and it runs. What does NOT exist is any
     * per-bot column or setting for it: **55, 3×ATR and the wick rule are code constants**, which is why
     * there is no "starting distance" field to fill in.
     *
     * ⚠️ AND THE ENGINE HAS NO EQUIVALENT. A run reports the fixed `slPct` stop and nothing that the
     * guardian would have done to it, so a live account and a backtest of the same bot do not share a
     * stop policy. This row exists so the gap is on the page instead of in a reader's head.
     */
    {
      id: 'stopGuard',
      // ⚠️ THE FULL NAME, NOT AN ABBREVIATION (2026-11-23). It was labelled "Stop guard" and the owner
      // immediately asked whether that was the Stop Guardian — a one-word difference between the table
      // and the service is exactly how a reader concludes they are two different things.
      label: 'Stop Guardian',
      value: 'live only',
      source: 'engine-default',
      applied: false,
      effect:
        'In the live account the stop keeps tightening while the trade runs: once the directives agree, the broker stop is moved in to about three times the average bar range, and a move judged to be a wick is deliberately ignored. A backtest does not do any of this — the stop it tests is the fixed one above.',
      note:
        '⚠️ NOT APPLIED IN THIS RUN — the engine has no Stop Guardian. Live: '
        + '`modules/automation/stop-guardian.service.ts`, consensus >= 55 over its directive set, '
        + 'trail = 3 * ATR, wick filter can leave the stop unchanged; every move is recorded in '
        + '`stop_adjustment` (5,328 rows measured 2026-11-23). None of those three numbers is a bot '
        + 'column or a setting — they are constants, so there is no value to show here and nothing to edit.',
    },
    {
      id: 'tpPct',
      label: 'Take profit',
      value: tp,
      unit: '%',
      source: overridden(request.tpPct, botTp),
      applied: true,
      /**
       * ⚠️ THE OWNER'S OWN QUESTION, ANSWERED IN THE CELL. 2026-11-23: *"the current data suggests that
       * our bot is configured to take profit. I think that needs to change."* The row now says what the
       * target does to a winner, and what happens without one — a reader should not have to infer a
       * trading decision from a percentage.
       */
      effect: tp > 0 ? TP_POSITIVE.replace('{value}', pct(tp)) : TP_ZERO,
      effectTemplate: { positive: TP_POSITIVE, zero: TP_ZERO },
      note: bot ? 'trading_strategy.tpPct' : 'a literal in BacktestService.run() — no bot names this protocol',
      botValue: botTp,
      editable: { control: 'number', unit: '%', min: 0, max: 100, step: 0.1, nullable: true },
    },
    {
      id: 'minComposite',
      label: 'Entry bar',
      value: bar,
      unit: '%',
      source: overridden(request.minComposite, botBar),
      applied: true,
      effect: BAR_POSITIVE.replace('{value}', pct(bar)),
      effectTemplate: { positive: BAR_POSITIVE },
      note: bot
        ? 'trading_strategy.minComposite — the second, tighter gate after the protocol threshold'
        : 'a literal in BacktestService.run() — every signal the protocol emits is traded',
      botValue: botBar,
      // Float (required) — `minComposite` is not nullable, so an empty input is refused, not zeroed.
      editable: { control: 'number', unit: '%', min: 0, max: 100, step: 1 },
    },
    {
      id: 'maxHoldHours',
      label: 'Max hold',
      value: hold,
      unit: 'h',
      source: botHold !== null ? 'bot' : 'engine-default',
      applied: true,
      effect: hold > 0 ? HOLD_POSITIVE.replace('{value}', hours(hold)) : HOLD_ZERO,
      effectTemplate: { positive: HOLD_POSITIVE, zero: HOLD_ZERO },
      // 0 = no limit, which is the engine's own documented default when the bot sets none.
      note: botHold !== null ? 'trading_strategy.maxHoldHours' : 'no time stop — the engine holds until stop, target or end of data',
      botValue: botHold,
      editable: { control: 'number', unit: 'h', min: 0, max: 720, step: 1, integer: true, nullable: true },
    },
    {
      id: 'cooldownMinutes',
      label: 'Cooldown',
      value: num(bot?.cooldownMinutes),
      unit: 'min',
      source: 'bot',
      /**
       * ⚠️ APPLIED ONLY IN `admission: 'portfolio'` MODE — and the row says which, so the same bot can be
       * read in both modes without the table lying about either. In the default (independent) mode the
       * engine still has no cooldown, because overlapping hypothetical trades make the window ambiguous;
       * the portfolio filter resolves that ambiguity the way live does (entry-to-entry, `|| 5`).
       */
      applied: request.admission === 'portfolio',
      effect: (num(bot?.cooldownMinutes) ?? 0) > 0
        ? (request.admission === 'portfolio'
          ? `After a trade opens, no further entry for ${minutes(num(bot?.cooldownMinutes) ?? 0)} — it stops one move being entered over and over.`
          : `This run does not apply the ${minutes(num(bot?.cooldownMinutes) ?? 0)} gap between entries, so overlapping trades are not filtered out.`)
        : 'No cooldown: every qualifying bar can open another trade, so the same move can be entered repeatedly.',
      note: request.admission === 'portfolio'
        ? 'APPLIED by the portfolio admission filter: entries closer than this to the previous entry are refused, entry-to-entry as the live loop measures it (`cooldownMinutes || 5`).'
        : 'NOT APPLIED in independent mode — the engine has no cooldown, because overlapping hypothetical positions make the window ambiguous. Ask for `admission: "portfolio"` to apply it. See #1325.',
      botValue: num(bot?.cooldownMinutes),
      editable: { control: 'number', unit: 'min', min: 0, max: 1440, step: 1, integer: true },
    },
    {
      id: 'maxPositions',
      label: 'Max positions',
      value: num(bot?.maxPositions),
      source: 'bot',
      applied: false,
      effect: `At most ${num(bot?.maxPositions) ?? 1} open position${(num(bot?.maxPositions) ?? 1) === 1 ? '' : 's'} at a time, so a new signal waits instead of stacking risk. Nothing reads this live either — the global open-position limit governs.`,
      note: 'NOT APPLIED — the engine has no concurrency model; it evaluates each bar against one position per symbol.',
      botValue: num(bot?.maxPositions),
      editable: { control: 'number', min: 1, max: 50, step: 1, integer: true },
    },
    {
      id: 'maxPyramidTiers',
      label: 'Pyramid tiers',
      value: num(bot?.maxPyramidTiers),
      source: 'bot',
      applied: false,
      effect: (num(bot?.maxPyramidTiers) ?? 1) <= 1
        ? 'No adding to a winner: size stays at the entry lot for the whole trade, so the loss stays fixed too. This run opens one trade per signal, so it cannot show the effect.'
        : `Up to ${num(bot?.maxPyramidTiers)} tiers: size may be added as a winner runs, which raises the reward and the loss if it reverses. This run opens one trade per signal, so it cannot show the effect.`,
      note: 'NOT APPLIED — averaging into a winner is enforced LIVE (pyramid-policy.service.ts, called by the automation loop). The engine opens one trade per signal and has no blended-entry model, so a run cannot show what adding size would have done. The decision itself is extracted to `pyramid-decision.ts` (#1242).',
      botValue: num(bot?.maxPyramidTiers),
      editable: { control: 'number', min: 1, max: 10, step: 1, integer: true },
    },
    {
      id: 'exitBeforeUtc',
      label: 'Exit before (UTC)',
      value: bot?.exitBeforeUtc ?? null,
      source: 'bot',
      applied: true,
      effect: bot?.exitBeforeUtc
        ? `Every position is flat by ${bot.exitBeforeUtc} UTC, so nothing is carried past the session close — it avoids being moved by an overnight gap.`
        : 'No flat-by time: a trade can be carried past the session close into the next day.',
      note: 'trading_strategy.exitBeforeUtc — the FLAT-BY boundary, combined with max hold by the live `decideExitTrigger()`. The position closes at the first bar past it, at that bar\'s OPEN (reason SESSION). Absent = hold through any time.',
      botValue: bot?.exitBeforeUtc ?? null,
      editable: { control: 'time', nullable: true },
    },
    {
      id: 'takeProfitAmount',
      label: 'Money target',
      value: num(bot?.takeProfitAmount),
      source: 'bot',
      applied: true,
      effect: (num(bot?.takeProfitAmount) ?? 0) > 0
        ? `The trade is closed once it is ${money(num(bot?.takeProfitAmount) ?? 0)} in profit — a money target rather than a percentage, so the percentage it needs depends on position size.`
        : 'No money target: profit is never banked at a fixed amount — a winner is closed by the percentage target, the stop or the clock.',
      note: 'trading_strategy.takeProfitAmount — judged at each bar’s close against the trade’s own net-of-commission P&L, then closed at that close (exit reason TARGET; live `system:take-profit`). NULL/0 = no target, which is 77 of 78 bots.',
      botValue: num(bot?.takeProfitAmount),
      editable: { control: 'number', unit: '$', min: 0, step: 1, nullable: true },
    },
    {
      id: 'exhaustionObserveEnabled',
      label: 'Exhaustion observer',
      value: bot?.exhaustionObserveEnabled ? 'on' : 'off',
      source: 'bot',
      applied: false,
      effect: bot?.exhaustionObserveEnabled
        ? 'Watches for a move losing pace and records the moment it looks exhausted. Nothing is closed from it — it is a note for the reader.'
        : 'Not watching for exhaustion: a fading move is not flagged, so nothing separates “still running” from “running out of buyers”.',
      note: 'NOT APPLIED — the live guardian records a decision point (#995) and acts on nothing; the engine has no observer.',
      botValue: bot?.exhaustionObserveEnabled ? 'on' : 'off',
      editable: { control: 'toggle' },
    },
    {
      id: 'brokerId',
      label: 'Broker',
      value: typeof bot?.brokerId === 'string' ? bot.brokerId : null,
      source: 'bot',
      applied: false,
      effect: 'Which account would place the order. A run places none, so the venue cannot change these numbers — only its spread would, and that is a separate cost setting.',
      note: 'NOT APPLIED — a run reads stored bars and places no order, so the venue cannot affect it. Its spread CAN, and that is the engine\'s own cost model, not this column.',
      botValue: typeof bot?.brokerId === 'string' ? bot.brokerId : null,
    },
    {
      id: 'sessionWindow',
      label: 'Session window',
      value: bot?.sessionWindow ?? null,
      source: bot?.sessionWindow ? 'bot' : 'engine-default',
      applied: true,
      effect: sessionText(bot?.sessionWindow)
        ? `Trades only during ${sessionText(bot?.sessionWindow)} hours. Outside them a signal is still scored, but no trade is opened.`
        : 'No session gate: a signal can be traded at any hour of the day.',
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
      effect: num(bot?.baseSize) != null
        ? SIZE_POSITIVE.replace('{value}', String(num(bot?.baseSize)))
        : SIZE_ZERO,
      effectTemplate: { positive: SIZE_POSITIVE, zero: SIZE_ZERO },
      note: 'NOT COMPARABLE — the live loop sends lots; this run sizes in units from an equity model (#843). P&L does not transfer.',
      botValue: num(bot?.baseSize),
      editable: { control: 'number', unit: 'lot', min: 0, step: 0.01, nullable: true },
    },
    {
      id: 'accountSize',
      label: 'Account size',
      value: request.accountSize ?? ENGINE_DEFAULTS.accountSize,
      unit: '$',
      source: request.accountSize !== undefined ? 'request' : 'engine-default',
      applied: true,
      effect: `The equity every position size is calculated from. At ${money(request.accountSize ?? ENGINE_DEFAULTS.accountSize)} a 1% risk is a different amount of money than it would be on a smaller account.`,
      note: 'the equity model every size is derived from',
    },
  ];

  /**
   * ⚠️ NO BOT, NO INPUT. `bot === null` means no `trading_strategy` record names this protocol, so
   * there is nothing for a save to land on — the panel must render values, not controls. Declaring
   * editability per row and stripping it centrally keeps that rule in ONE place: a row cannot forget.
   */
  if (!bot) for (const row of rows) delete row.editable;

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
