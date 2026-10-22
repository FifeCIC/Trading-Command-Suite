/**
 * settings-inventory.ts — WHAT CAN BE SET, AND WHAT A BACKTEST ACTUALLY MEASURES (#1136).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * The Backtest Lab lets you change a thing and measure it. That is only useful if you know WHICH
 * things exist, where they live, and whether the run in front of you honours them. Without this list
 * the operator is guessing: the bot view offers ~20 knobs, the protocol view offers 5 override
 * fields, the settings registry declares 20 more — and the backtester reads a small subset of each.
 *
 * ── THE MEASUREMENT THAT MADE IT NECESSARY (2026-10-22) ─────────────────────────────────────────
 * Grep of `backtest.service.ts` for each bot column:
 *
 *     timeframe 21 · protocolId 15 · baseSize 4 · slPct 3 · tpPct 3 · mode 1 · active 2
 *     minComposite 0 · maxPositions 0 · cooldownMinutes 0 · maxHoldHours 0
 *     maxPyramidTiers 0 · exhaustionDecelPct 0 · simTslEnabled 0 · sessionTags 0
 *     sessionWindow 0 · exitBeforeUtc 0
 *
 * and for settings-registry usage: **none**. So a bot's `minComposite` — the entry bar an operator
 * deliberately set — is NOT what a backtest measures. A run reports a signal count against the
 * PROTOCOL's threshold, and the bot's own bar never enters the calculation.
 *
 * ⚠️ THAT IS NOT A BUG TO FIX HERE, IT IS A FACT TO STATE. Whether the backtester *should* honour
 * `minComposite` is a modelling decision (#1136), and silently making it honour more would change
 * every stored run's meaning. What this file does is make the current boundary legible before anyone
 * reads a difference between two runs as a result.
 *
 * ── HOW THE CLAIMS ARE KEPT HONEST ──────────────────────────────────────────────────────────────
 * `applied` is a CLAIM, so it is guarded mechanically rather than by good intentions:
 *   · `bot-settings-inventory.spec.ts` drives `mergeBotConfig()` — the real function `run()` calls —
 *     and asserts each `honoured` field changes the merged request while each `ignored` field cannot.
 *   · The same spec reads `backtest.service.ts` and fails if it ever mentions a field this file calls
 *     `ignored`, or stops honouring one this file calls `honoured`.
 * A declaration is not validated by being well-formed, only by being checked against the thing it
 * names.
 */

export type Applied = 'honoured' | 'ignored' | 'reported-only';

export interface InventoryRow {
  /** Dotted identifier a future editor would use. */
  key: string;
  label: string;
  value: unknown;
  applied: Applied;
  /** Where the value lives and which consumer decides `applied`. Short by design. */
  why: string;
}

export interface InventoryGroup {
  id: 'run' | 'settings' | 'strategy' | 'protocol' | 'directive-override';
  label: string;
  note: string;
  rows: InventoryRow[];
}

export interface InventoryCounts {
  total: number;
  honoured: number;
  ignored: number;
  reportedOnly: number;
}

/**
 * Fields on the RUN REQUEST itself.
 *
 * ⚠️ THIS GROUP EXISTS BECAUSE THE OTHER GROUPS CANNOT REPRESENT IT. `slPct`/`tpPct`/`timeframe` live
 * on `BacktestRunRequest`, are read from the request BEFORE the subject's own values
 * (`mergeBotConfig` → `pick()`), and work for a PROTOCOL run too — where there is no bot at all. Listing
 * them only under "Strategy" hid the one genuinely editable pair whenever a protocol was selected.
 *
 * Values are the EFFECTIVE ones: the bot's when a bot is selected, otherwise the engine's own defaults
 * (`run()` destructures `slPct = 1.0`, `tpPct = 1.0`). Showing a blank there would imply "no value",
 * when in fact a run silently uses 1% / 1%.
 */
const RUN_FIELDS: ReadonlyArray<{ key: string; label: string; applied: Applied; why: string; fallback: unknown }> = [
  { key: 'minComposite', label: 'Entry bar % (minComposite)', applied: 'honoured', why: 'The bot’s own entry gate. A score below it produces no trade — the same comparison the live loop makes, on the same percentage. Change it here to test a different bar without editing the bot.', fallback: 0 },
  { key: 'slPct', label: 'Stop loss %', applied: 'honoured', why: 'BacktestRunRequest.slPct — read before the bot’s own value and recorded in drivenBy.overridden. The bracket exit uses it.', fallback: 1 },
  { key: 'tpPct', label: 'Take profit %', applied: 'honoured', why: 'BacktestRunRequest.tpPct — same precedence. `doBrackets` is false unless BOTH are above zero.', fallback: 1 },
  { key: 'timeframe', label: 'Timeframe', applied: 'honoured', why: 'BacktestRunRequest.timeframe — only used when the window is a bar count; a stored period owns the timeframe.', fallback: '1d' },
];

/**
 * The bot columns that are EDITABLE SETTINGS — as opposed to identity, derived state and output.
 *
 * ⚠️ Derived values are deliberately absent (`totalPnl`, `profitRatio`, `lastComposite`,
 * `evaluationCount`, `lastSignal`, `lastEvaluatedAt`, `daysActive`, `magic`, `version`). Listing an
 * output beside a setting is how a surface starts implying you can edit a result.
 */
const BOT_FIELDS: ReadonlyArray<{ key: string; label: string; applied: Applied; why: string }> = [
  { key: 'symbol', label: 'Symbol', applied: 'honoured', why: 'mergeBotConfig() → merged.symbol. The period overrides it when one is chosen.' },
  { key: 'timeframe', label: 'Timeframe', applied: 'honoured', why: 'mergeBotConfig() → merged.timeframe. The period overrides it when one is chosen.' },
  { key: 'protocolId', label: 'Protocol', applied: 'honoured', why: 'mergeBotConfig() → merged.protocolId; the run is REFUSED when it resolves to none.' },
  { key: 'slPct', label: 'Stop loss %', applied: 'honoured', why: 'mergeBotConfig() → merged.slPct; the bracket exit uses it.' },
  { key: 'tpPct', label: 'Take profit %', applied: 'honoured', why: 'mergeBotConfig() → merged.tpPct; the bracket exit uses it.' },
  { key: 'mode', label: 'Mode (auto / semi-auto / manual)', applied: 'reported-only', why: 'Echoed in drivenBy.mode so a comparison states which bot it measured. It decides nothing inside a run.' },
  { key: 'active', label: 'Active', applied: 'reported-only', why: 'Echoed in drivenBy.active. The Lab BLOCKS a run against an active bot; the run itself is identical.' },
  { key: 'baseSize', label: 'Base size (lots)', applied: 'reported-only', why: 'Read only to write the #843 caveat. The run sizes in per-unit shares, so this number does NOT drive the P&L.' },
  { key: 'minComposite', label: 'Entry threshold (minComposite)', applied: 'honoured', why: 'The bot’s own entry bar, applied as a PERCENTAGE gate before a signal is recorded — the same comparison the live loop makes. A run cannot take an entry the bot would skip.' },
  { key: 'maxPositions', label: 'Max positions', applied: 'ignored', why: 'Zero references in backtest.service; the engine opens one position at a time per trade record.' },
  { key: 'cooldownMinutes', label: 'Cooldown (minutes)', applied: 'ignored', why: 'Zero references. The live loop enforces it between trades; the backtester does not.' },
  { key: 'maxHoldHours', label: 'Max hold (hours)', applied: 'ignored', why: 'Zero references. The position time-stop is a live-loop service, not part of a run.' },
  { key: 'maxPyramidTiers', label: 'Max pyramid tiers', applied: 'ignored', why: 'Zero references. Pyramiding is applied live only.' },
  { key: 'exhaustionObserveEnabled', label: 'Exhaustion observe mode', applied: 'ignored', why: 'Zero references.' },
  { key: 'exhaustionDecelPct', label: 'Exhaustion deceleration %', applied: 'ignored', why: 'Zero references.' },
  { key: 'simTslEnabled', label: 'Simulated trailing stop', applied: 'ignored', why: 'Zero references.' },
  { key: 'simTslActivationPct', label: 'Trailing activation %', applied: 'ignored', why: 'Zero references.' },
  { key: 'simTslDistancePct', label: 'Trailing distance %', applied: 'ignored', why: 'Zero references.' },
  { key: 'sessionTags', label: 'Session tags', applied: 'ignored', why: 'Zero references. Session gating is live-loop only.' },
  { key: 'sessionWindow', label: 'Session window', applied: 'ignored', why: 'Zero references.' },
  { key: 'exitBeforeUtc', label: 'Exit before (UTC)', applied: 'ignored', why: 'Zero references.' },
  { key: 'brokerId', label: 'Broker', applied: 'ignored', why: 'Zero references. A run reads stored bars, not a broker.' },
];

/**
 * The directive fields `PATCH /api/scoring/protocols/:slug/directive-config` ACCEPTS, and which of
 * them the scorer APPLIES per protocol.
 *
 * ⚠️ Measured 2026-10-22: `getProtocolOverrides()` reads five; `protocol-gating.service.ts` consumes
 * `maxScore` only, at the `resolveEffectiveMaxScores()` call site. The other four are stored and
 * served and do nothing — the endpoint now returns `notApplied` for them so the no-op is visible.
 */
const DIRECTIVE_OVERRIDE_FIELDS: ReadonlyArray<{ key: string; label: string; applied: Applied; why: string }> = [
  { key: 'maxScore', label: 'Ceiling (maxScore)', applied: 'honoured', why: 'resolveEffectiveMaxScores() per protocol → the capacity the percentage is measured against. THE ONE FIELD THAT WORKS.' },
  { key: 'minScore', label: 'Minimum score', applied: 'ignored', why: 'Stored per protocol; only the GLOBAL value is applied (directives.service). The per-protocol one is inert.' },
  { key: 'priority', label: 'Priority', applied: 'ignored', why: 'Stored per protocol; only the global value is applied. Inert per protocol.' },
  { key: 'category', label: 'Category', applied: 'ignored', why: 'Stored per protocol; only the global value is applied. Inert per protocol.' },
  { key: 'directionBias', label: 'Direction bias', applied: 'ignored', why: 'Stored per protocol; only the global value is applied. Inert per protocol — the most valuable field to wire next.' },
];

/**
 * Protocol-level values a run reads.
 *
 * ⚠️ ONLY VERIFIED COLUMNS. `protocol.maxScore`, `protocol.directiveCount` and `protocol.resolvedSymbols`
 * are NOT columns — they are computed by `GET /api/scoring/gated/protocols` from the directive entries
 * and the symbol assignments. Listing them here would have meant either guessing a column name or
 * re-deriving a value the gated endpoint already publishes, and both are the duplication this repo
 * keeps paying for. `maxScore` appears once, in the directive-override group, where it is a SETTING.
 */
const PROTOCOL_FIELDS: ReadonlyArray<{ key: string; label: string; applied: Applied; why: string }> = [
  { key: 'directionMode', label: 'Direction mode', applied: 'honoured', why: 'LONG_ONLY / SHORT_ONLY decide which directives contribute to the numerator.' },
  { key: 'recommendedTimeframe', label: 'Recommended timeframe', applied: 'reported-only', why: 'Defaults the picker when no stored period is chosen. A period owns symbol + timeframe, so it overrides this.' },
  { key: 'tradingStyle', label: 'Trading style', applied: 'ignored', why: 'A descriptive tag the picker filters on. Nothing in the scoring path branches on it.' },
  { key: 'active', label: 'Active', applied: 'ignored', why: 'A run scores an inactive protocol identically — `active` is a live-loop switch, not a scoring input.' },
  { key: 'version', label: 'Version', applied: 'reported-only', why: 'Identity. It travels with results so two runs can be attributed to different protocol versions.' },
];

const EMPTY: readonly InventoryRow[] = Object.freeze([]);

function rowsFrom(
  declared: ReadonlyArray<{ key: string; label: string; applied: Applied; why: string }>,
  record: Record<string, unknown> | null | undefined,
): InventoryRow[] {
  if (!record) return [...EMPTY];
  return declared.map((d) => ({
    key: d.key,
    label: d.label,
    // ⚠️ `undefined` is reported as null, never as 0 or "". An unset knob and a knob set to zero are
    // different facts, and collapsing them is the fabricated-number defect in another costume.
    value: record[d.key] === undefined ? null : record[d.key],
    applied: d.applied,
    why: d.why,
  }));
}

export interface BuildInventoryInput {
  settings?: Array<Record<string, unknown>> | null;
  bot?: Record<string, unknown> | null;
  protocol?: Record<string, unknown> | null;
}

/**
 * Build the inventory. Pure — no database, no clock — so the spec can drive every branch.
 *
 * When no bot or protocol is selected the corresponding group is present but EMPTY, with a `note`
 * saying why. An absent group and an empty group must not render the same: `[]` is information,
 * absence is not.
 */
export function buildSettingsInventory(input: BuildInventoryInput): {
  groups: InventoryGroup[];
  counts: InventoryCounts;
} {
  const settings = Array.isArray(input.settings) ? input.settings : [];

  const groups: InventoryGroup[] = [
    {
      id: 'run',
      label: 'This run',
      note:
        'Read from the RUN REQUEST before the subject’s own values, so changing one here changes the '
        + 'run and writes nothing. Leave an input blank to use the value shown.',
      rows: RUN_FIELDS.map((f) => ({
        key: f.key,
        label: f.label,
        value: (input.bot?.[f.key] ?? f.fallback) as unknown,
        applied: f.applied,
        why: f.why,
      })),
    },
    {
      id: 'strategy',
      label: 'Strategy',
      note: input.bot
        ? 'The selected bot’s own knobs. A run honours five of them; the rest belong to the live loop.'
        : 'Select a strategy to list its knobs.',
      rows: rowsFrom(BOT_FIELDS, input.bot),
    },
    {
      id: 'protocol',
      label: 'Protocol',
      note: input.protocol
        ? 'Values the scorer reads for every bar of a run.'
        : 'Select a protocol to list its values.',
      rows: rowsFrom(PROTOCOL_FIELDS, input.protocol),
    },
    {
      id: 'directive-override',
      label: 'Per-protocol directive overrides',
      note:
        'Fields `PATCH /api/scoring/protocols/:slug/directive-config` accepts. ONE of the five is applied '
        + 'per protocol; the endpoint returns `notApplied` for the others.',
      rows: rowsFrom(DIRECTIVE_OVERRIDE_FIELDS, Object.fromEntries(
        DIRECTIVE_OVERRIDE_FIELDS.map((f) => [f.key, undefined]),
      )),
    },
    {
      id: 'settings',
      label: 'Declared global settings',
      note:
        'Every value the settings registry declares, with its provenance. ⚠️ None of them is read by a '
        + 'backtest run — they are consumed by the live loop, the scheduler and the log system.',
      rows: settings.map((s) => ({
        key: String(s.key ?? ''),
        label: String(s.label ?? s.key ?? ''),
        value: s.value === undefined ? null : s.value,
        applied: 'ignored' as Applied,
        why: `Registry source: ${s.source ?? 'unknown'}${s.owner ? ` · owner ${s.owner}` : ''}. Not read by backtest.service.`,
      })),
    },
  ];

  const all = groups.flatMap((g) => g.rows);
  return {
    groups,
    counts: {
      total: all.length,
      honoured: all.filter((r) => r.applied === 'honoured').length,
      ignored: all.filter((r) => r.applied === 'ignored').length,
      reportedOnly: all.filter((r) => r.applied === 'reported-only').length,
    },
  };
}

/** Exported for the guard spec — the declared lists are the thing that must not drift silently. */
export const DECLARED = {
  runFields: RUN_FIELDS,
  botFields: BOT_FIELDS,
  directiveOverrideFields: DIRECTIVE_OVERRIDE_FIELDS,
  protocolFields: PROTOCOL_FIELDS,
} as const;
