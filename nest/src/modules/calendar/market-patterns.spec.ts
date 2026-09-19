import { patternForSymbol, MARKET_PATTERNS, assignedSymbols, venueForSymbol } from './market-patterns';

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

/**
 * venueForSymbol — the SHARED venue classifier (2026-09-19).
 *
 * ⚠️ THE REGRESSION THESE TESTS GUARD
 * -----------------------------------
 * `is24HourMarket()` is true for forex, metals AND crypto alike, and the gate used it to skip
 * the calendar entirely (freshness-only). Crypto is genuinely 24/7 so that branch was harmless
 * there — but forex and metals are 24/5. Measured live: XAUUSD on a Saturday had a "0 min old"
 * 5m bar (bar-refresh writes a synthetic bar from the last quote) and produced actionable BUY
 * envelopes for a market closed since Friday 22:00 London. The card appeared on
 * signals-overview; the block only happened later at queue dispatch.
 *
 * These pin the split: crypto stays calendar-free, forex/metals/continuous CFDs get the FX
 * week, and anything we cannot judge stays `unknown` (fail loud, never fail closed).
 */
describe('venueForSymbol — shared venue classifier (2026-09-19)', () => {
  it('routes metals to the FX week — NOT a calendar-less 24h pass (the XAUUSD card)', () => {
    const v = venueForSymbol('XAUUSD');
    expect(v.kind).toBe('venue');
    expect(v.exchange).toBe('FX');
    // If this ever returns kind 'crypto', the weekend XAUUSD signal is back.
    expect(v.kind).not.toBe('crypto');
  });

  it('routes FX pairs to the FX week', () => {
    for (const sym of ['EURUSD', 'GBPJPY', 'USDCNH']) {
      expect(venueForSymbol(sym)).toMatchObject({ kind: 'venue', exchange: 'FX' });
    }
  });

  it('keeps crypto calendar-free — BTC must trade through the weekend', () => {
    for (const sym of ['BTCUSD', 'ETHUSD', 'DOGEUSD', 'SOLUSD']) {
      expect(venueForSymbol(sym).kind).toBe('crypto');
    }
  });

  it('routes the continuous CFDs to the broker (FX) week — never US hours', () => {
    for (const sym of ['UK100', 'FRA40', 'GER40', 'US500', 'VIX', 'WTI']) {
      const v = venueForSymbol(sym);
      expect(v.kind).toBe('venue');
      expect(v.exchange).toBe('FX'); // broker week — blocks ONLY the weekend
      expect(v.exchange).not.toBe('US'); // the #850 defect in one line
    }
  });

  it('routes letter-only leftovers to US (stocks, SPY/QQQ, inverse ETFs)', () => {
    for (const sym of ['NVDA', 'TSLA', 'SPY', 'QQQ', 'SOXS']) {
      expect(venueForSymbol(sym)).toMatchObject({ kind: 'venue', exchange: 'US' });
    }
  });

  it('an explicit assignment wins over the letter rule', () => {
    // WTI is 3 letters and would fall to US by the leftover rule; the SYMBOL_PATTERN entry
    // must win because energy CFDs trade the broker (FX) week.
    expect(venueForSymbol('WTI')).toMatchObject({ kind: 'venue', exchange: 'FX' });
  });

  it('stays unknown — never failing closed — for digit-bearing or unassigned instruments', () => {
    // European leveraged ETPs (3AMZ, X3) and any genuinely new ticker must NOT silently
    // inherit a calendar; the gate logs them and uses freshness only.
    for (const sym of ['3AMZ', 'X3', 'SOMETHINGNEW', '']) {
      expect(venueForSymbol(sym).kind).toBe('unknown');
    }
  });

  it('is case- and whitespace-insensitive', () => {
    expect(venueForSymbol(' xauusd ')?.exchange).toBe(venueForSymbol('XAUUSD')?.exchange);
  });
});
