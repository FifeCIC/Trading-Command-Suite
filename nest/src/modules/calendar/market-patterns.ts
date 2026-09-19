/**
 * market-patterns.ts — WHICH trading window governs an instrument.
 * ================================================================
 * The VENUE axis. Answers "is this instrument tradeable right now" (see #851 for how this
 * relates to the FX-session, bot-window and data-freshness axes — they are different questions).
 *
 * ⚠️ WHY THIS FILE EXISTS (#850)
 * ---------------------------------------------------------------------------------------------
 * `protocol-gating.service.ts` decided market-open with a HARDCODED exchange:
 *
 *     const cal = this.marketCalendar.getMarketStatus('US');   // for EVERY symbol
 *
 * and `MarketCalendarService.SESSIONS` contains only `US`. So every non-24h instrument was judged
 * on US hours. Measured live 2026-09-16, verbatim from the API log:
 *
 *     Queue skip: ftse-speed-v1 signalled but blocked pre-trade [UK100 (Market unavailable: US market after-hours)]
 *     Queue skip: cac-speed-v1  signalled but blocked pre-trade [FRA40 (Market unavailable: US market after-hours)]
 *
 * A French index blocked by "US market after-hours" is wrong on its face, and the reason string
 * sends the reader to the wrong component.
 *
 * ⚠️ THE MEASUREMENT THAT SETS THESE WINDOWS — AND WHAT IT DOES *NOT* SAY
 * ---------------------------------------------------------------------------------------------
 * The instrument's OWN bars were measured (30 days, Pepperstone route, 2026-09-17):
 *
 *     instrument   15m / 1h / 5m distinct UTC hours covered     flat bars
 *     UK100        24 / 24 / 24                                 0 / 0 / 90
 *     FRA40        24 / 24 / 24                                 1 / 0 / 40
 *     GER40        24 / 24 / 24                                 0 / 0 / 90
 *     US500        24 / 24 / 24                                 0 / 3 / 34
 *     VIX          22 / 24 (1m/5m)                              ** 3408 of 4588 / 1754 of 4842 **
 *
 * Individual hours are populated on 22-27 of ~30 days with a realistic profile (busy 15:00-19:00
 * UTC, thin 22:00-03:00) — genuine market data, not machine-filled placeholders.
 *
 * **These are ~24-hour instruments on this broker.** That is the fact this file encodes. It is NOT
 * a claim that they are equally TRADEABLE at all hours — see the VIX note below.
 *
 * ⚠️ An earlier version of #850 argued these should get London/Frankfurt/Paris cash hours
 * (08:00-16:30 etc). The measurement contradicts that: a cash-hours calendar would block roughly
 * two thirds of the window in which the instrument demonstrably trades. Do not "fix" this by adding
 * narrower exchange hours.
 */

export interface MarketPattern {
  /** Stable id. */
  id: string;
  /** Human label, for UI and log lines. */
  label: string;
  /**
   * Exchange calendar governing this pattern. MUST exist in `MarketCalendarService.SESSIONS`
   * — an unknown exchange fails CLOSED there, which is worse than no calendar at all.
   */
  exchange?: string;
  /** The instrument quotes around the clock; no exchange calendar applies. */
  continuous?: boolean;
  /** Why this pattern exists. Provenance, so the next reader does not have to re-derive it. */
  note: string;
}

export const MARKET_PATTERNS: Record<string, MarketPattern> = {
  'us-exchange': {
    id: 'us-exchange',
    label: 'US exchange hours',
    exchange: 'US',
    note:
      'A genuine US-listed instrument. The US calendar (with its holidays) is authoritative and is ' +
      'the one thing MarketCalendarService already models correctly.',
  },
  'cfd-continuous': {
    id: 'cfd-continuous',
    label: 'Continuous CFD (broker-quoted)',
    continuous: true,
    note:
      'A CFD whose window is the BROKER’s, not the underlying cash exchange’s. Measured 2026-09-17: ' +
      'these quote in 24 distinct UTC hours at 15m/1h/5m with genuine data. Gating them on the cash ' +
      'exchange — or on US hours — is what #850 was. ' +
      '⚠️ 2026-09-19 update (venueForSymbol): `continuous` means the BROKER\'s week, which is the ' +
      'FX week (Sun 22:00 → Fri 22:00 Europe/London) — these still close for the weekend, and a ' +
      'dead weekend feed was still producing signals. venueForSymbol() therefore routes them to ' +
      'the FX venue, which preserves the measured weekday coverage and blocks only the weekend.',
  },
};

/**
 * Symbol → pattern.
 *
 * ⚠️ This covers only the instruments NOT already handled by `is24HourMarket()` (forex, metals,
 * crypto). Those bypass this file entirely and legitimately.
 *
 * A symbol absent from this map returns `null` and the gate FAILS LOUD rather than silently
 * inheriting US hours — that silence is the defect this file exists to remove.
 */
const SYMBOL_PATTERN: Record<string, string> = {
  // ── Index CFDs on the Pepperstone route (broker 3). Measured continuous; see the header. ──
  UK100: 'cfd-continuous', // FTSE 100
  FRA40: 'cfd-continuous', // CAC 40
  GER40: 'cfd-continuous', // DAX
  US500: 'cfd-continuous', // S&P 500
  // ⚠️ VIX is included on the same measured basis (22-24 distinct hours) BUT ITS DATA IS THIN:
  // 74% of its 1m bars are flat (avg range 0.0121). It quotes around the clock without moving.
  // That is a LIQUIDITY problem, not a window problem, and a calendar is the wrong tool for it —
  // worth its own issue. Recorded here so the decision is visible rather than implied.
  VIX: 'cfd-continuous',
  // ── Energy CFDs — same broker week as the index CFDs. Listed explicitly because they are
  //    letter-only tickers that would otherwise fall to the US rule below (WRONG: energy trades
  //    the FX week).
  WTI: 'cfd-continuous',
  USOIL: 'cfd-continuous',
  BRENT: 'cfd-continuous',
  UKOIL: 'cfd-continuous',
  // ── US index CFDs on the same Pepperstone route, same class as the measured five. Not
  //    individually measured (the 30-day study covered the five above), included because the
  //    FX venue blocks ONLY the weekend — a superset that cannot narrow any measured window.
  US30: 'cfd-continuous', // Dow 30 CFD
  USTEC: 'cfd-continuous', // Nasdaq 100 CFD
  NAS100: 'cfd-continuous', // same instrument, common MT5 alias
};

/**
 * venueForSymbol() — THE shared answer to "which venue window governs this instrument".
 * =====================================================================================
 * This is the single classifier the pipeline uses to share ONE market state from the gate
 * down: scoring eligibility (signal-envelope.buildBestLadder), per-envelope marketStatus
 * (protocol-gating), and queue dispatch all ask THIS function, so they cannot disagree.
 *
 * ⚠️ WHY IT EXISTS (2026-09-19). The user's observation, verbatim:
 *
 *     "there is a XAUUSD card on signals-overview despite the market for that symbol being
 *      closed. So there shouldn't be a signal, because there shouldn't be a fresh score either."
 *
 * The chain that produced it: `is24HourMarket(XAUUSD)` is TRUE (forex/metals/crypto are all
 * "24h" for session-penalty purposes), so the gate took a freshness-ONLY branch and never
 * consulted a calendar; `bar-refresh` writes synthetic quote-stamped bars so MAX(timestamp)
 * stayed "now"; so a Saturday XAUUSD scored, was enveloped, and reached the card layer —
 * blocked only later at queue dispatch ("last real bar 60m old"). Three layers each had a
 * piece of the truth and none shared it.
 *
 * Semantics (all fail-SOFT: "cannot judge" never becomes "closed"):
 *   • crypto       — genuinely 24/7, no calendar. Never standby.
 *   • venue+exchange — consult MarketCalendarService for that exchange.
 *   • unknown      — no calendar. The gate logs once and falls back to freshness (fail loud,
 *                    same contract as before); the standby check refuses to pause it.
 */
export type VenueKind = 'crypto' | 'venue' | 'unknown';

export interface SymbolVenue {
  kind: VenueKind;
  /** Present when kind === 'venue'. MUST exist in MarketCalendarService.SESSIONS. */
  exchange?: string;
  /** Human label for log lines and UI copy ("Metals", "FX week", "US listed", ...). */
  label: string;
}

/** Same currency list as `is24HourMarket()` — keep the two in step when adding a currency. */
const FX_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF',
  'SEK', 'NOK', 'DKK', 'SGD', 'HKD', 'TRY', 'ZAR', 'MXN',
  'PLN', 'HUF', 'CZK', 'CNH', 'ILS', 'THB', 'RUB', 'INR',
]);

/** Crypto prefixes — same basis as `is24HourMarket()`. Crypto trades 24/7; no calendar applies. */
const CRYPTO_PREFIX = /^(BTC|ETH|XRP|SOL|DOGE|ADA|AVAX|MATIC|LINK|DOT|LTC|BCH|UNI)/;

/**
 * Classify a symbol onto the venue axis.
 *
 * ⚠️ ORDER MATTERS. SYMBOL_PATTERN wins first (an explicit assignment is a decision), then
 * crypto (24/7, never closes), then metals, then FX pairs, then the letter-only US rule.
 *
 * The letter-only rule (`^[A-Z]{1,5}$` → US) is a DELIBERATE default: every letter-only
 * instrument on this stack that is not already caught above is US-listed (stocks, SPY/QQQ,
 * inverse ETFs). Anything with digits (3AMZ, X3) or longer names stays `unknown` and keeps
 * the gate's fail-loud warning — European leveraged ETPs have genuinely unclear venues and
 * must not silently inherit US hours (#850). If a letter-only symbol is ever added that is
 * NOT US-listed, add it to SYMBOL_PATTERN explicitly.
 */
export function venueForSymbol(symbol: string): SymbolVenue {
  const s = (symbol || '').toUpperCase().trim();
  if (!s) return { kind: 'unknown', label: 'unassigned' };

  // 1. Explicit assignment wins — an entry in SYMBOL_PATTERN is a decision, not a default.
  const pattern = patternForSymbol(s);
  if (pattern) {
    if (pattern.exchange) return { kind: 'venue', exchange: pattern.exchange, label: pattern.label };
    if (pattern.continuous) {
      // The broker's week for a continuous CFD is the FX week (see the pattern note).
      return { kind: 'venue', exchange: 'FX', label: 'CFD (broker week)' };
    }
    return { kind: 'unknown', label: pattern.label };
  }

  // 2. Crypto — 24/7, no calendar any day of the week.
  if (CRYPTO_PREFIX.test(s)) return { kind: 'crypto', label: 'Crypto (24/7)' };

  // 3. Metals — trade the FX week (closed weekends), NOT 24/7.
  if (/^X(AU|AG|PT|PD)/.test(s)) return { kind: 'venue', exchange: 'FX', label: 'Metals (FX week)' };

  // 4. FX pairs — 6 letters, both sides a known currency.
  if (/^[A-Z]{6}$/.test(s)) {
    const base = s.substring(0, 3);
    const quote = s.substring(3, 6);
    if (FX_CURRENCIES.has(base) && FX_CURRENCIES.has(quote)) {
      return { kind: 'venue', exchange: 'FX', label: 'FX week' };
    }
  }

  // 5. Letter-only leftovers are US-listed on this stack (see the note above).
  if (/^[A-Z]{1,5}$/.test(s)) return { kind: 'venue', exchange: 'US', label: 'US listed' };

  return { kind: 'unknown', label: 'unassigned' };
}

/** Resolve an instrument's market pattern, or `null` when unassigned. */
export function patternForSymbol(symbol: string): MarketPattern | null {
  const key = (symbol || '').toUpperCase().trim();
  if (!key) return null;
  const id = SYMBOL_PATTERN[key];
  if (!id) return null;
  return MARKET_PATTERNS[id] ?? null;
}

/** Every symbol this map knows about — for diagnostics and guards. */
export function assignedSymbols(): string[] {
  return Object.keys(SYMBOL_PATTERN).sort();
}
