/**
 * NasdaqEarningsService — free, keyless earnings calendar (fallback source)
 * =========================================================================
 * Nasdaq exposes a public JSON calendar at:
 *   https://api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD
 *
 * No API key, no auth. Returns ~20 rows per trading day with symbol, name,
 * epsForecast, fiscalQuarterEnding, and time-of-day (pre-market/after-hours).
 * Requires a browser User-Agent (blocked otherwise). Weekend requests return
 * rows: null — this service only fetches weekdays.
 *
 * Used as the fallback when Finnhub (primary, single-call) is unavailable or
 * returns no events, so the Earnings Calendar page never shows nothing.
 * Results are cached in-memory for 6 hours (calendar data is slow-moving).
 *
 * Provider conventions (trading-context.instructions.md): never throw —
 * return [] on failure and let the caller handle logging.
 */

import { Injectable, Logger } from '@nestjs/common';
import { EarningsEvent } from '../providers/interfaces/provider-adapter.interface';

const NASDAQ_BASE = 'https://api.nasdaq.com/api/calendar/earnings';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};
const CACHE_TTL_MS = 6 * 3600_000; // 6 hours
const CONCURRENCY = 4;

const MONTH_INDEX: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseEps(value?: string): number | null {
  if (!value) return null;
  const n = parseFloat(value.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** '$127,422,451,278' → 127422451278 */
function parseMarketCap(value?: string): number | null {
  if (!value) return null;
  const n = parseFloat(value.replace(/[$,]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** '8/25/2025' → '2025-08-25' (US date format) */
function parseUsDate(value?: string): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** 'Jun/2026' → '2026-06-30' (last day of fiscal month) */
function parseFiscalEnding(value?: string): string | null {
  if (!value) return null;
  const m = value.match(/^([A-Za-z]{3})\/(\d{4})$/);
  if (!m) return null;
  const mon = MONTH_INDEX[m[1]];
  if (mon === undefined) return null;
  const year = parseInt(m[2], 10);
  const lastDay = new Date(year, mon + 1, 0).getDate();
  return `${year}-${String(mon + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

@Injectable()
export class NasdaqEarningsService {
  private readonly logger = new Logger(NasdaqEarningsService.name);
  private readonly cache = new Map<string, { at: number; events: EarningsEvent[] }>();

  private fmtLocal(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  /** Fetch one trading day from Nasdaq. Never throws — returns [] on failure. */
  private async fetchDay(dateStr: string): Promise<EarningsEvent[]> {
    try {
      const res = await fetch(`${NASDAQ_BASE}?date=${dateStr}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return [];
      const body: any = await res.json();
      const rows = body?.data?.rows;
      if (!Array.isArray(rows)) return [];

      return rows
        .map((r: any) => {
          const timeRaw: string = r.time || '';
          const timeOfDay = timeRaw.includes('pre-market')
            ? ('Before Open' as const)
            : timeRaw.includes('after-hours')
              ? ('After Close' as const)
              : null;
          return {
            symbol: String(r.symbol || '').toUpperCase(),
            name: r.name || undefined,
            reportDate: dateStr,
            fiscalDateEnding: parseFiscalEnding(r.fiscalQuarterEnding) || undefined,
            epsEstimate: parseEps(r.epsForecast),
            epsActual: null,
            revenueEstimate: null,
            revenueActual: null,
            surprisePercent: null,
            timeOfDay,
            currency: 'USD',
            marketCap: parseMarketCap(r.marketCap),
            lastYearEps: parseEps(r.lastYearEPS),
            lastYearDate: parseUsDate(r.lastYearRptDt) || undefined,
            source: 'nasdaq',
          } as EarningsEvent;
        })
        .filter((e) => e.symbol);
    } catch {
      return [];
    }
  }

  /** Iterate all weekdays from today to +horizonMonths, fetching in small concurrent batches. */
  private async fetchRange(horizonMonths: number): Promise<EarningsEvent[]> {
    const days: string[] = [];
    const cursor = new Date();
    const end = new Date();
    end.setMonth(end.getMonth() + horizonMonths);

    while (cursor <= end) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) days.push(this.fmtLocal(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    const all: EarningsEvent[] = [];
    for (let i = 0; i < days.length; i += CONCURRENCY) {
      const chunk = days.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map((d) => this.fetchDay(d)));
      for (const r of results) all.push(...r);
    }

    all.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
    this.logger.log(
      `Nasdaq earnings calendar: ${all.length} events across ${days.length} trading days (${horizonMonths}mo horizon)`,
    );
    return all;
  }

  /**
   * Get upcoming earnings for the horizon window.
   * Cached 6h. Returns [] (never throws) on upstream failure.
   */
  async getCalendar(horizonMonths = 3, symbol?: string): Promise<EarningsEvent[]> {
    const cacheKey = `${horizonMonths}:${symbol?.toUpperCase() || 'all'}`;
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return hit.events;
    }

    const events = await this.fetchRange(horizonMonths);
    if (events.length > 0) {
      this.cache.set(cacheKey, { at: Date.now(), events });
    }

    return symbol
      ? events.filter((e) => e.symbol === symbol.toUpperCase())
      : events;
  }
}
