/**
 * symbol-tradeability.ts — "can this symbol be traded RIGHT NOW?"
 *
 * One answer, for the two consumers that must never disagree: the SCORING gate (a paused symbol is
 * not scored at all) and the SERVING gate (a paused symbol's signal is not acted on).
 *
 * ── DECISION (2026-11-27, owner) ──
 * WHAT:      EXTENDED HOURS COUNT AS TRADEABLE. A symbol is paused only when its venue is not
 *            trading at all — weekend, holiday, or a closed FX week.
 * WHY:       Owner: *"I just want to maximise TCS ability and opportunity to trade. Extended hours
 *            means more trading … pause symbols when they cannot be traded in the current market
 *            state."* A regular-session-only gate throws away the pre-market and after-hours
 *            windows the broker now offers.
 * INSTEAD OF: Treating 'pre-market'/'after-hours' as closed (the previous behaviour, and the
 *            reading in `extended-hours.ts`'s warning copy).
 * REVERSE BY: Delete the 'extended' branch below, so anything outside the regular session is
 *            'paused'. The venue axis needs no change — this file is the only place the decision
 *            lives.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 316
 * GUARD:     nest/src/modules/calendar/symbol-tradeability.spec.ts (both directions, plus crypto
 *            and unknown)
 *
 * ⚠️ NO EXTENDED-HOURS WINDOW IS INVENTED HERE.
 * The calendar already distinguishes the two cases that matter without knowing the times:
 * `pre-market` / `after-hours` mean "this IS a trading day and we are outside the regular window",
 * while `closed` means the venue is not trading at all (weekend/holiday). So extended tradeability
 * is read from a state the venue axis already reports — not from a guessed clock. A notice that
 * changes the extended hours therefore needs no edit here.
 *
 * ⚠️ AN UNKNOWN VENUE IS NOT PAUSED. `unknown` means "no calendar governs this instrument", and
 * collapsing that into "closed" would silently switch trading off for every unclassified symbol —
 * the exact failure `getVenueStandby()` already refuses (see its spec). Freshness is the gate there.
 */
import type { MarketStatus } from './market-calendar.service';
import { venueForSymbol, type VenueKind } from './market-patterns';

export type SymbolTradeState = 'continuous' | 'regular' | 'extended' | 'paused' | 'unknown';

export interface SymbolTradeability {
  symbol: string;
  state: SymbolTradeState;
  /** True when a score may be produced and a signal may be acted on. */
  tradeable: boolean;
  /** Always populated — the reason a symbol is paused, or why it is tradeable. */
  reason: string;
  venue: { kind: VenueKind; exchange?: string; label: string };
  venueStatus: MarketStatus['status'] | 'continuous' | 'unknown';
  nextOpen: string | null;
}

/** Assessments for many symbols, preserving the caller's order. */
export function assessSymbolsTradeability(
  symbols: string[],
  getStatus: (exchange: string) => MarketStatus,
): SymbolTradeability[] {
  return symbols.map((s) => assessSymbolTradeability(s, getStatus));
}

export function assessSymbolTradeability(
  symbol: string,
  getStatus: (exchange: string) => MarketStatus,
): SymbolTradeability {
  const venue = venueForSymbol(symbol);
  const base = {
    symbol,
    venue: { kind: venue.kind, exchange: venue.exchange, label: venue.label },
    nextOpen: null as string | null,
  };

  if (venue.kind === 'crypto') {
    return {
      ...base,
      state: 'continuous',
      tradeable: true,
      venueStatus: 'continuous',
      reason: 'Crypto trades 24/7 — no venue window applies.',
    };
  }

  if (venue.kind === 'venue' && venue.exchange) {
    const cal = getStatus(venue.exchange);
    const where = `${venue.label} ${cal.status}`;
    const until = cal.nextOpen ? ` — next open ${cal.nextOpen}` : '';

    if (cal.isOpen) {
      return {
        ...base,
        state: 'regular',
        tradeable: true,
        venueStatus: cal.status,
        nextOpen: cal.nextOpen,
        reason: `${where}${cal.holidayName ? ` (${cal.holidayName})` : ''}.`,
      };
    }

    // ⚠️ THE DECISION SITS HERE. `pre-market` and `after-hours` are a TRADING DAY outside the
    // regular window; `closed` is not a trading day at all. Only the second pauses the symbol.
    if (cal.status === 'pre-market' || cal.status === 'after-hours') {
      return {
        ...base,
        state: 'extended',
        tradeable: true,
        venueStatus: cal.status,
        nextOpen: cal.nextOpen,
        reason: `${where}${until} — extended hours are tradeable.`,
      };
    }

    return {
      ...base,
      state: 'paused',
      tradeable: false,
      venueStatus: cal.status,
      nextOpen: cal.nextOpen,
      reason: `${where}${cal.holidayName ? ` (${cal.holidayName})` : ''}${until} — venue is not trading.`,
    };
  }

  return {
    ...base,
    state: 'unknown',
    // Fail OPEN, exactly as `getVenueStandby()` does: "cannot judge" must not read as "closed".
    tradeable: true,
    venueStatus: 'unknown',
    reason: `No market pattern assigned for ${symbol} — tradeability is governed by data freshness only (#850).`,
  };
}
