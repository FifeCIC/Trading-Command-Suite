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
}

/** Canonical bars per style. Higher = stricter. */
export const STYLE_THRESHOLDS: Record<StyleCategory, number> = {
  scalp: 75,
  speed: 80,
  'day-trade': 65,
  swing: 55,
  position: 45,
};

export type StyleCategory = 'scalp' | 'speed' | 'day-trade' | 'swing' | 'position';

/**
 * Consumer defaults — deliberately different, and that is preserved:
 *   - SIGNALS_GATE_DEFAULT: the historical Signals pre-trade gate (65).
 *   - BOT_BAR_DEFAULT:      the legacy automation-loop bot bar (60).
 * Unifying these would change trading behaviour in one of the two paths.
 */
export const SIGNALS_GATE_DEFAULT = 65;
export const BOT_BAR_DEFAULT = 60;

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
