/**
 * The two lookahead directives, asserted in BOTH directions — #1139 item 2.
 * ========================================================================
 * Measured 2026-11-01 by reading the implementations: both scored a CURRENT snapshot on every
 * historical bar, so a backtest using either described a configuration that never existed. The number
 * was plausible and nothing errored — the failure mode this repo keeps re-finding.
 *
 * ⚠️ **The "did the fix actually engage?" direction is the one that matters most.** A guard that only
 * ever returns `unmeasured` would look correct here and would silently disable the directive in LIVE
 * trading — which is a worse bug than the one being fixed, because live is the money path. So every
 * case below asserts live still produces a real reading.
 */

import { CryptoFearGreedDirective } from './crypto-fear-greed.directive';
import { DilutionImpactDirective } from './dilution-impact.directive';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function bars(n = 30) {
  const t = Date.UTC(2026, 9, 1);
  return Array.from({ length: n }, (_, i) => ({
    timestamp: new Date(t + i * HOUR),
    open: 100, high: 101, low: 99, close: 100, volume: 1000,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('crypto-fear-greed — refuses a historical bar, still measures live', () => {
  function seeded(fetchedAt: number) {
    const d = new CryptoFearGreedDirective();
    // The directive reads its own cache; populate it the way `fetchFng()` would.
    (d as unknown as { cache: unknown }).cache = {
      value: 12, classification: 'Extreme Fear', fetchedAt,
    };
    return d;
  }

  it('LIVE: a bar at the fetch time still produces a real reading', () => {
    const now = Date.UTC(2026, 10, 1, 12, 0);
    const d = seeded(now);
    const r = d.calculate({
      symbol: 'BTCUSD', bars: bars(), timeframe: '1h', asOf: new Date(now),
    });
    expect(r.unmeasured).toBeUndefined();
    expect(r.score).toBeGreaterThan(0);
    expect(r.signalClass).toBe('bullish'); // value 12 = extreme fear = contrarian buy
  });

  it('LOOKAHEAD: the same value on a bar from three days ago is UNMEASURED', () => {
    const now = Date.UTC(2026, 10, 1, 12, 0);
    const d = seeded(now);
    const r = d.calculate({
      symbol: 'BTCUSD', bars: bars(), timeframe: '1h', asOf: new Date(now - 3 * DAY),
    });
    expect(r.unmeasured).toBe(true);
    expect(r.score).toBe(0);
    expect(r.signalClass).toBe('neutral');
    expect(r.reason).toMatch(/UNMEASURED/);
    expect(r.reason.toLowerCase()).toContain('lookahead');
  });

  it('LIVE BOUNDARY: data arriving inside the bar is allowed, one millisecond past it is not', () => {
    const barOpen = Date.UTC(2026, 10, 1, 12, 0);
    const inside = seeded(barOpen + HOUR);        // exactly one bar later
    const past = seeded(barOpen + HOUR + 1);      // one ms beyond the allowance

    const ok = inside.calculate({ symbol: 'BTCUSD', bars: bars(), timeframe: '1h', asOf: new Date(barOpen) });
    expect(ok.unmeasured).toBeUndefined();

    const bad = past.calculate({ symbol: 'BTCUSD', bars: bars(), timeframe: '1h', asOf: new Date(barOpen) });
    expect(bad.unmeasured).toBe(true);
  });

  it('no asOf at all is UNMEASURED, never a reading', () => {
    // "I cannot prove this was available" must not be recorded as "it was available".
    const d = seeded(Date.UTC(2026, 10, 1, 12, 0));
    const r = d.calculate({ symbol: 'BTCUSD', bars: bars(), timeframe: '1h' });
    expect(r.unmeasured).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('dilution-impact — refuses a historical bar, still measures live', () => {
  function directive(fetchedAt: Date) {
    const metrics = {
      symbol: 'NVDA', sharesOutstanding: 1000, shareChange3m: 8, shareChange12m: 25,
      marketCap: 1e9, source: 'finnhub', fetchedAt,
    };
    const prisma = { companyMetric: { findUnique: async () => metrics } };
    const researchImport = { importCompanyMetricsForSymbol: async () => {} };
    return new DilutionImpactDirective(prisma as never, researchImport as never);
  }

  it('LIVE: a freshly fetched snapshot produces a real reading', async () => {
    const now = new Date(Date.UTC(2026, 10, 1, 12, 0));
    const r = await directive(now).calculate({
      symbol: 'NVDA', bars: bars(), timeframe: '1d', asOf: now,
    });
    expect(r.unmeasured).toBeUndefined();
    expect(typeof r.score).toBe('number');
  });

  it('LOOKAHEAD: the same snapshot on a bar from 60 days ago is UNMEASURED', async () => {
    const now = new Date(Date.UTC(2026, 10, 1, 12, 0));
    const asOf = new Date(now.getTime() - 60 * DAY);
    const r = await directive(now).calculate({
      symbol: 'NVDA', bars: bars(), timeframe: '1d', asOf,
    });
    expect(r.unmeasured).toBe(true);
    expect(r.score).toBe(0);
    expect(r.reason).toMatch(/UNMEASURED/);
    expect(r.reason).toContain('company metrics snapshot');
  });

  it('UNMEASURED when the provider returned no share count — a zero is not "no dilution"', async () => {
    // MEASURED 2026-11-01: all 194 companyMetric rows hold sharesOutstanding = 0, so this directive
    // awarded 60/60 to every symbol. That is a constant, not a reading.
    const metrics = {
      symbol: 'AAPL', sharesOutstanding: 0, shareChange3m: 0, shareChange12m: 0,
      marketCap: 0, source: 'finnhub', fetchedAt: new Date(Date.UTC(2026, 10, 1, 12, 0)),
    };
    const prisma = { companyMetric: { findUnique: async () => metrics } };
    const researchImport = { importCompanyMetricsForSymbol: async () => {} };
    const d = new DilutionImpactDirective(prisma as never, researchImport as never);
    const r = await d.calculate({
      symbol: 'AAPL', bars: bars(), timeframe: '1d', asOf: new Date(Date.UTC(2026, 10, 1, 12, 0)),
    });
    expect(r.unmeasured).toBe(true);
    expect(r.score).toBe(0);
    expect(r.reason).toMatch(/UNMEASURED/);
    expect(r.reason).toContain('no share count');
    expect(r.reason).toContain('MISSING reading');
  });

  it('still scores a REAL share count with zero changes — that is a genuine "no dilution"', async () => {
    const metrics = {
      symbol: 'AAPL', sharesOutstanding: 5_000_000, shareChange3m: 0, shareChange12m: 0,
      marketCap: 1e9, source: 'finnhub', fetchedAt: new Date(Date.UTC(2026, 10, 1, 12, 0)),
    };
    const prisma = { companyMetric: { findUnique: async () => metrics } };
    const researchImport = { importCompanyMetricsForSymbol: async () => {} };
    const d = new DilutionImpactDirective(prisma as never, researchImport as never);
    const r = await d.calculate({
      symbol: 'AAPL', bars: bars(), timeframe: '1d', asOf: new Date(Date.UTC(2026, 10, 1, 12, 0)),
    });
    expect(r.unmeasured).toBeUndefined();
    expect(r.score).toBeGreaterThan(0);
  });

  it('daily bars get a whole-day arrival allowance, so a snapshot from the same day is fine', async () => {
    const asOf = new Date(Date.UTC(2026, 10, 1, 0, 0));
    const fetched = new Date(Date.UTC(2026, 10, 1, 20, 0)); // later the same day
    const r = await directive(fetched).calculate({
      symbol: 'NVDA', bars: bars(), timeframe: '1d', asOf,
    });
    expect(r.unmeasured).toBeUndefined();
  });
});
