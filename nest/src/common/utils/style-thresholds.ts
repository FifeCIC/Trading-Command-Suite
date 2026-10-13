/**
 * style-thresholds.ts — Canonical protocol trading-style → strength-bar map.
 * ========================================================================
 * SINGLE SOURCE OF TRUTH for "what quality bar does this trading style need".
 *
 * Why this file exists
 * --------------------
 * The same five thresholds were duplicated in two services, each with its own
 * fallback default:
 *   - automation-loop.service.ts   STYLE_THRESHOLDS  (fallback 60)  ← bot bar
 *   - signal-envelope.service.ts   STYLE_GATE        (fallback 65)  ← pre-trade gate
 * The comments even admitted it ("mirrors automation-loop STYLE_THRESHOLDS").
 * Two copies of one table always drift, and only one gets the next fix.
 *
 * Why classification is now TOTAL
 * -------------------------------
 * `styleGateFallback()` matched on only five keywords (scalp/tick, speed, day,
 * swing, position). Any other wording silently fell through to the default.
 * Measured 2026-09-10: 2 of 17 active protocols hit that hole — `signals-workbench`
 * (NULL style) and **`forex-session-v1`** (`'Session / Mean Reversion'`), the
 * protocol driving all six FX pairs. Its symbols scored ~54 against a gate of 65
 * that no one could explain, because the value was a fallback, not a decision.
 *
 * Behaviour-preservation contract
 * -------------------------------
 * The LEGACY pass below reproduces the original keyword order EXACTLY, so every
 * style that resolved before still returns the identical number. The EXTENDED
 * pass only runs for strings the legacy set could not classify, and the final
 * fallback is the caller's own default. Net effect: zero behaviour change for
 * previously-classified styles; previously-silent fall-throughs become explicit
 * and labelled. Resolutions always carry provenance so a gate value can explain
 * itself in logs instead of being reverse-engineered.
 */

export interface StyleGateResolution {
  /** The resolved strength bar. */
  threshold: number;
  /** Which layer produced the number. */
  source: 'override' | 'style' | 'default';
  /** The raw style string that drove it, when source === 'style'. */
  style?: string | null;
  /** Short human-readable provenance for logs/blocker text. */
  label: string;
  /**
   * The ACTIVE bots subscribing to the protocol (via `strategy_protocol`), captured by the
   * reconciliation so the envelope can state the BOT VERDICT from the same lookup (#911 →
   * single-service, 2026-10-12). `undefined` = no lookup ran (override path, no protocol),
   * which must stay distinguishable from `{ count: 0 }` = looked up, nobody subscribes.
   */
  participatingBots?: { count: number; thresholds: number[] };
}

/**
 * Canonical bars per style. Higher = stricter.
 *
 * ⚠️ RESCALED 2026-09-15 — the values below are NOT the historic ones, and the
 * reason matters more than the numbers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE OLD VALUES (75/80/65/55/45) MADE THE APP UNABLE TO TRADE
 * ─────────────────────────────────────────────────────────────────────────────
 * ADR-011 (#758, second pass, deployed ~2026-09-10) changed the percentage
 * DENOMINATOR from the OBSERVED directional sum to the CONFIGURED directional
 * capacity. For a typical protocol that moved the divisor from ~130 to ~725-815,
 * i.e. **~6.3x larger**, and therefore divided EVERY percentage by that factor.
 *
 * The bars in this table were calibrated against the old scale, where readings
 * reached 60-100. After the denominator change the same readings became ~10-33.
 * Measured peak `compositePct` per protocol (2026-09-15):
 *
 *     hourly-3dir-v1 33.3   vix-short-v1 25.8   xau-speed-v1/m5/m15 23-24
 *     gold-macro-v1  21.6   vix-spike-v1 18.8   spy-speed-v1 18.7
 *     qqq-speed-v1   17.2   xau-speed-4h 16.6   forex-session-v1 15.0
 *     ftse/dax/cac   13.5-16.4                   china-speed-v1 10.2
 *
 * Against a bar of 65-80, **nothing could ever clear the gate**, and live trading
 * stopped on 2026-09-10 — the last queue entry and the last closed trade are both
 * from that date. The app was not broken; it was measuring on a new scale and
 * comparing against old numbers.
 *
 * The repo already carried the diagnosis twice in comments
 * (`protocol-gating.service.ts` "SCALE WARNING", `automation-loop.service.ts`
 * "these thresholds were calibrated for the OLD 0-100 composite scale") — and one
 * bot, `VIX Spike Short`, was seeded with `minComposite: 0` specifically to dodge
 * it. This table is the same defect, fixed at source.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW THE NEW VALUES WERE DERIVED — a units migration, not a tuning decision
 * ─────────────────────────────────────────────────────────────────────────────
 * Every bar is the old value divided by the denominator ratio (~6.3), rounded to
 * an integer, with the ORDERING PRESERVED exactly (scalp < speed, and
 * day-trade > swing > position). No value was picked by feel.
 *
 * ⚠️ These are ENTRY-QUALITY bars, not risk limits. The risk engine
 * (`riskMultiplier`, `hardGateTriggered`), SL/TP and position sizing are
 * unchanged and still apply — lowering an entry bar admits more trades, it does
 * not remove a guard.
 *
 * ⚠️ MAKING THE APP TRADE IS NOT THE SAME AS MAKING IT PROFITABLE. Directional
 * accuracy measured on `directiveoutcome` was 39-48% over 2026-09-08..15, i.e.
 * at or below chance. These bars exist so the pipeline can produce trades TO BE
 * MEASURED — they are not evidence of edge, and must not be read as such. Raise
 * them from measured outcomes (#817), never by intuition.
 */
export const STYLE_THRESHOLDS: Record<StyleCategory, number> = {
  scalp: 12,
  speed: 13,
  'day-trade': 10,
  swing: 9,
  position: 7,
};

export type StyleCategory = 'scalp' | 'speed' | 'day-trade' | 'swing' | 'position';

/**
 * Consumer defaults — deliberately different, and that is preserved:
 *   - SIGNALS_GATE_DEFAULT: the historical Signals pre-trade gate (was 65).
 *   - BOT_BAR_DEFAULT:      the legacy automation-loop bot bar (was 60).
 * Unifying these would change trading behaviour in one of the two paths, so they
 * stay separate — but both are rescaled on the same basis as the table above
 * (old / ~6.3), because both were compared against the same percentage.
 */
export const SIGNALS_GATE_DEFAULT = 10;
export const BOT_BAR_DEFAULT = 10;

/** Original keyword set and order — DO NOT reorder, see behaviour contract above. */
const LEGACY_PASS: Array<[string[], StyleCategory]> = [
  [['scalp', 'tick'], 'scalp'],
  [['speed'], 'speed'],
  [['day'], 'day-trade'],
  [['swing'], 'swing'],
  [['position'], 'position'],
];

/**
 * Extended vocabulary for styles the legacy set cannot classify. Each maps to the
 * closest existing horizon so no new bar values are invented:
 *   intraday-horizon styles → day-trade (65); multi-day horizon styles → swing (55).
 * 'Session / Mean Reversion' resolves here to day-trade, which is the SAME value
 * it fell through to before — the gain is that it is now an explicit, labelled
 * classification rather than an accident. Calibrating this number further is a
 * deliberate decision for the operator, not something a matcher should guess.
 */
const EXTENDED_PASS: Array<[string[], StyleCategory]> = [
  [['mean reversion', 'mean-reversion', 'session', 'intraday', 'range', 'breakout', 'event', 'news'], 'day-trade'],
  [['momentum', 'trend', 'monitor', 'carry', 'arbitrage'], 'swing'],
];

function firstMatch(passes: Array<[string[], StyleCategory]>, style: string): StyleCategory | null {
  for (const [keys, category] of passes) {
    if (keys.some((k) => style.includes(k))) return category;
  }
  return null;
}

/**
 * Resolve the strength bar for a protocol's trading style.
 *
 * @param tradingStyle protocol.tradingStyle (e.g. 'Tick Scalp', 'Swing / Position')
 * @param fallback     the CALLER's default — preserved so neither path changes
 */
export function resolveStyleThreshold(
  tradingStyle?: string | null,
  fallback: number = SIGNALS_GATE_DEFAULT,
): StyleGateResolution {
  const raw = (tradingStyle ?? '').trim();
  const style = raw.toLowerCase();

  const legacy = firstMatch(LEGACY_PASS, style);
  if (legacy) {
    return {
      threshold: STYLE_THRESHOLDS[legacy],
      source: 'style',
      style: raw,
      label: `style '${raw}' → ${legacy}`,
    };
  }

  const extended = firstMatch(EXTENDED_PASS, style);
  if (extended) {
    return {
      threshold: STYLE_THRESHOLDS[extended],
      source: 'style',
      style: raw,
      label: `style '${raw}' → ${extended} (extended vocabulary)`,
    };
  }

  return {
    threshold: fallback,
    source: 'default',
    style: raw || null,
    label: raw ? `default ${fallback} — style '${raw}' unrecognised` : `default ${fallback} — no style set`,
  };
}

/** Convenience wrapper for callers that only need the number. */
export function getStyleThreshold(tradingStyle?: string | null, fallback: number = SIGNALS_GATE_DEFAULT): number {
  return resolveStyleThreshold(tradingStyle, fallback).threshold;
}
