/**
 * Trading212 Ticker Normalizer
 * =============================
 * Decodes Trading212 instrument codes like "3LNVl_EQ", "AIRp_EQ",
 * "8XPd_EQ" into standard symbols ("3LNV", "AIR", "8XPD").
 *
 * ── Anatomy of a T212 ticker ───────────────────────────────
 *   [BASE][MODIFIER?]_[EXCHANGE]_[TYPE]
 *   Example: 3LNVl_US_EQ
 *            ^^^^ ^^  ^^
 *            Base Mod Exch Type
 *
 * ── Known modifiers ────────────────────────────────────────
 *   l = Long (leveraged ETP — e.g., 3LNVl = 3x Long NVDA)
 *   d = Unknown modifier (seen on 8XPd, R3NKd — possibly CFD)
 *   p = Paris/Euronext exchange residual
 *
 * ── Strategy ───────────────────────────────────────────────
 *   1. Split on "_" → separate exchange suffix
 *   2. Check explicit overrides table
 *   3. Strip known modifier suffixes from the base
 *   4. Return clean symbol
 */

// ── Known Modifier Suffixes ────────────────────────────────

export interface T212Modifier {
  /** Characters to strip (e.g. "l") */
  strip: string;
  /** Human-readable meaning */
  meaning: string;
}

export const T212_MODIFIER_MAP: Record<string, T212Modifier> = {
  l: { strip: 'l', meaning: 'Long (leveraged ETP)' },
  d: { strip: 'd', meaning: 'CFD or unknown modifier' },
  p: { strip: 'p', meaning: 'Paris/Euronext exchange' },
  s: { strip: 's', meaning: 'Short (inverse ETP)' },
};

// ── Known Ticker Overrides ─────────────────────────────────
//
// When the automated stripping rules aren't enough, add explicit
// mappings here. These are checked BEFORE modifier stripping.

export const T212_TICKER_OVERRIDES: Record<string, string> = {
  '3LNVl': '3LNV',   // 3x Long NVDA ETP (GraniteShares)
  '3NVDl': '3NVD',   // 3x NVDA (GraniteShares)
  '3TSLl': '3TSL',   // 3x Long Tesla ETP
  '3SQl': '3SQ',     // 3x Short Nasdaq
  'AIRp': 'AIR',     // Airbus SE (Paris)
  'EEEl': 'EEE',     // Unknown leveraged
};

// ── Normalized Ticker Result ────────────────────────────────

export interface NormalizedTicker {
  /** Clean standard symbol (e.g. "AAPL", "3LNV") */
  symbol: string;
  /** Exchange code (e.g. "US", "EQ", "DE") */
  exchange: string;
  /** Instrument type (e.g. "EQ" for equity, "ETF") */
  type: string;
  /** Original raw ticker (for debugging) */
  raw: string;
  /** Detected modifier(s) if any */
  modifiers: string[];
}

// ── Core Function ──────────────────────────────────────────

/**
 * Normalize a Trading212 instrument code to a standard symbol.
 *
 * Examples:
 *   "NVDA_US_EQ"   → { symbol: "NVDA", exchange: "US", type: "EQ", modifiers: [] }
 *   "3LNVl_EQ"     → { symbol: "3LNV", exchange: "", type: "EQ", modifiers: ["l"] }
 *   "AIRp_EQ"      → { symbol: "AIR", exchange: "", type: "EQ", modifiers: ["p"] }
 *   "AAPL"         → { symbol: "AAPL", exchange: "", type: "", modifiers: [] }
 */
export function normalizeT212Ticker(raw: string): NormalizedTicker {
  const parts = raw.split('_');

  let base = parts[0] || '';
  // Reconstruct exchange + type from remaining parts
  const suffixParts = parts.slice(1);

  // Deduce exchange and type from suffix parts
  // Common patterns: US_EQ, GB_EQ, DE_EQ, _EQ, _ETF
  let exchange = '';
  let type = '';

  if (suffixParts.length >= 2) {
    exchange = suffixParts[0];
    type = suffixParts.slice(1).join('_');
  } else if (suffixParts.length === 1) {
    type = suffixParts[0];
  }

  // Step 1: Check explicit overrides on the base
  const modifiers: string[] = [];
  if (T212_TICKER_OVERRIDES[base]) {
    return {
      symbol: T212_TICKER_OVERRIDES[base],
      exchange,
      type,
      raw,
      modifiers: detectModifiers(base),
    };
  }

  // Step 2: Strip known modifier suffixes from the base
  let clean = base;
  for (const [modChar, modInfo] of Object.entries(T212_MODIFIER_MAP)) {
    if (clean.endsWith(modChar) && clean.length > modChar.length) {
      modifiers.push(modChar);
      clean = clean.slice(0, -modChar.length);
    }
  }

  return {
    symbol: clean,
    exchange,
    type,
    raw,
    modifiers,
  };
}

/** Convenience: return just the clean symbol string */
export function cleanT212Ticker(raw: string): string {
  return normalizeT212Ticker(raw).symbol;
}

// ── Helpers ────────────────────────────────────────────────

function detectModifiers(base: string): string[] {
  const found: string[] = [];
  for (const modChar of Object.keys(T212_MODIFIER_MAP)) {
    if (base.endsWith(modChar) && base.length > modChar.length) {
      found.push(modChar);
    }
  }
  return found;
}
