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
      'exchange — or on US hours — is what #850 was.',
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
};

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
