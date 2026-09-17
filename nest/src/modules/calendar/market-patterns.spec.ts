import { patternForSymbol, MARKET_PATTERNS, assignedSymbols } from './market-patterns';

/**
 * market-patterns — the venue axis (#850).
 *
 * ⚠️ THE REGRESSION THESE TESTS GUARD
 * -----------------------------------
 * `protocol-gating.service.ts` decided market-open with a hardcoded exchange:
 *
 *     const cal = this.marketCalendar.getMarketStatus('US');   // for EVERY symbol
 *
 * while `MarketCalendarService.SESSIONS` contains only `US`. So every non-24h instrument was judged
 * on US hours, and the reason string asserted a US session it had nothing to do with. Measured
 * verbatim from the API log, 2026-09-16:
 *
 *     Queue skip: cac-speed-v1 signalled but blocked pre-trade [FRA40 (Market unavailable: US market after-hours)]
 *
 * These tests pin the two properties that fix it:
 *   1. the index CFDs resolve to a CONTINUOUS pattern — they are not on a US calendar;
 *   2. an unassigned symbol resolves to `null`, so the gate FAILS LOUD instead of silently
 *      inheriting US hours. That silence is the defect, so it must not be reintroduced.
 */
describe('market-patterns — venue axis (#850)', () => {
  it('resolves the European index CFDs to a continuous pattern, NOT a US calendar', () => {
    for (const sym of ['UK100', 'FRA40', 'GER40']) {
      const p = patternForSymbol(sym);
      expect(p).not.toBeNull();
      expect(p!.continuous).toBe(true);
      // The specific bug: these must not be attached to the US exchange.
      expect(p!.exchange).toBeUndefined();
    }
  });

  it('is case- and whitespace-insensitive', () => {
    expect(patternForSymbol('uk100')?.id).toBe(patternForSymbol('  UK100 ')?.id);
  });

  it('returns null for an unassigned symbol so the gate can fail LOUD', () => {
    // If this ever returns a pattern with `exchange: 'US'`, the #850 defect is back: an unknown
    // instrument would be silently judged on US hours.
    expect(patternForSymbol('SOMETHINGNEW')).toBeNull();
    expect(patternForSymbol('')).toBeNull();
  });

  it('every assigned symbol resolves to a pattern that actually exists', () => {
    // Guards a typo in SYMBOL_PATTERN: a dangling id would return null at runtime and quietly
    // turn an assigned symbol back into an unassigned one.
    for (const sym of assignedSymbols()) {
      expect(patternForSymbol(sym)).not.toBeNull();
    }
  });

  it('every pattern either names an exchange or declares itself continuous', () => {
    // A pattern with neither would fall through to `getMarketStatus(undefined)`, which defaults
    // to 'US' — the silent default this file exists to remove.
    for (const p of Object.values(MARKET_PATTERNS)) {
      expect(Boolean(p.exchange) || p.continuous === true).toBe(true);
    }
  });

  it('every pattern carries provenance', () => {
    for (const p of Object.values(MARKET_PATTERNS)) {
      expect(p.note.length).toBeGreaterThan(40);
    }
  });
});
