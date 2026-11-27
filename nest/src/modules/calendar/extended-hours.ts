/**
 * extended-hours.ts — EXTENDED-HOURS RISK, read from the VENUE axis.
 *
 * ── WHAT THIS ANSWERS (#1359) ──
 * "Is this instrument's REGULAR session live right now, and if it is not, what does the broker
 * say about trading outside it?"
 *
 * ⚠️ THIS IS NOT A SECOND MARKET-HOURS SOURCE. It reads `venueForSymbol()` (which exchange governs
 * the instrument) and `MarketCalendarService.getMarketStatus()` (is that exchange open) — the same
 * two the scoring gate uses. A second copy of "is the market open" is the defect #850 was, so this
 * file owns no hours of its own.
 *
 * ⚠️ WHY THERE IS NO EXTENDED-HOURS WINDOW HERE
 * A broker notice (2026-11-27) said extended-hours times had changed and did not state the new
 * times. Writing a guessed window into the calendar would be inventing market hours, which
 * `external-systems-are-data` forbids. So this assessment says only what is measurable: "the
 * regular session is not live". It does NOT claim when extended trading opens or closes.
 *
 * ⚠️ IT WARNS; IT DOES NOT BLOCK (owner decision, 2026-11-27).
 * The risk belongs in front of the person placing the order, not in a hidden gate.
 */
import type { MarketStatus } from './market-calendar.service';
import { venueForSymbol, type SymbolVenue } from './market-patterns';

export type ExtendedHoursRiskId = 'liquidity' | 'volatility' | 'spread';

export interface ExtendedHoursRisk {
  id: ExtendedHoursRiskId;
  label: string;
  detail: string;
}

/**
 * The broker's three named risks, quoted from the 2026-11-27 notice.
 *
 * ⚠️ Kept as data so a surface can LIST them rather than re-word them — a re-worded risk is a
 * different claim, and the next reader cannot tell which one the broker actually made.
 */
export const EXTENDED_HOURS_RISKS: ReadonlyArray<ExtendedHoursRisk> = [
  {
    id: 'liquidity',
    label: 'Lower liquidity',
    detail:
      'Fewer people trade outside regular hours, so an order may take longer to fill or may not fill at all.',
  },
  {
    id: 'volatility',
    label: 'Higher volatility',
    detail:
      'Prices can move more sharply and by larger amounts, so a position can change value significantly in a short time.',
  },
  {
    id: 'spread',
    label: 'Wider spreads',
    detail:
      "The difference between the buy and sell price may be greater than during regular hours.",
  },
];

export interface ExtendedHoursAssessment {
  ticker: string;
  /** Which venue governs the instrument, as `venueForSymbol()` resolved it. */
  venue: { kind: SymbolVenue['kind']; exchange?: string; label: string };
  /** The venue's own state at the time of the check. */
  venueStatus: MarketStatus['status'] | 'continuous' | 'unknown';
  /** True ONLY when the regular session is live. Read `judged` before treating `false` as a fact. */
  inRegularSession: boolean;
  /**
   * False when the trading window could not be determined at all.
   *
   * ⚠️ `inRegularSession: false` with `judged: false` means "cannot judge", NOT "closed". Collapsing
   * the two is how a failed lookup reads as a confident negative (the `port_in_use_unknown_owner`
   * lesson, `agent-environment.instructions.md`).
   */
  judged: boolean;
  nextOpen: string | null;
  risks: ExtendedHoursRisk[];
  /** One line for a log or a UI heading. */
  message: string;
}

/**
 * Assess one ticker. `getStatus` is injected rather than the service itself so this module stays
 * pure and testable without Nest DI.
 */
export function assessTickerExtendedHours(
  ticker: string,
  getStatus: (exchange: string) => MarketStatus,
): ExtendedHoursAssessment {
  const venue = venueForSymbol(ticker);
  const status = venue.kind === 'venue' && venue.exchange ? getStatus(venue.exchange) : undefined;
  return assessExtendedHours(ticker, venue, status);
}

export function assessExtendedHours(
  ticker: string,
  venue: SymbolVenue,
  status?: MarketStatus,
): ExtendedHoursAssessment {
  const base = {
    ticker,
    venue: { kind: venue.kind, exchange: venue.exchange, label: venue.label },
    nextOpen: null as string | null,
  };

  if (venue.kind === 'crypto') {
    return {
      ...base,
      venueStatus: 'continuous',
      inRegularSession: true,
      judged: true,
      risks: [],
      message: `${ticker}: crypto trades 24/7 — no extended-hours window applies.`,
    };
  }

  if (venue.kind === 'venue' && venue.exchange && status) {
    const inRegularSession = status.isOpen;
    const message = inRegularSession
      ? `${ticker}: ${venue.label} regular session is open.`
      : `${ticker}: ${venue.label} regular session is ${status.status}` +
        (status.nextOpen ? `; next regular open ${status.nextOpen}` : '') +
        '. An order sent now can execute — or queue — outside regular hours.';
    return {
      ...base,
      venueStatus: status.status,
      inRegularSession,
      judged: true,
      nextOpen: status.nextOpen,
      risks: inRegularSession ? [] : [...EXTENDED_HOURS_RISKS],
      message,
    };
  }

  return {
    ...base,
    venueStatus: 'unknown',
    inRegularSession: false,
    judged: false,
    risks: [...EXTENDED_HOURS_RISKS],
    message:
      `${ticker}: the governing venue could not be determined, so the trading window is unknown — ` +
      'treat this order as possibly outside regular hours.',
  };
}
