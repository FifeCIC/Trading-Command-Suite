/**
 * decideVerdict — the exit-geometry warning must survive the early return.
 *
 * ⚠️ REGRESSION GUARD (2026-09-12)
 * The first version of `decideVerdict` computed `exitGeometryWarning`, pushed it to
 * `findings`, and then the `days < 30` branch REBUILT `findings` from a literal array —
 * silently discarding it. The single most actionable output of the whole report was
 * present in the source and absent from the response, and nothing failed.
 *
 * That is the same failure shape as the scoring bugs this repo keeps re-finding: **a value
 * computed, then not used, with no error**. These tests exist so it cannot recur.
 */
import { decideVerdict } from './edge.controller';
import type { EdgeReport } from './edge-statistics.service';
import type { PnlReport, PnlBucket } from './pnl-statistics.service';

function bucket(over: Partial<PnlBucket> = {}): PnlBucket {
  return {
    label: 'ALL',
    trades: 114,
    wins: 10,
    losses: 104,
    winRate: 0.0877,
    avgWin: 8.924,
    avgLoss: -18.828,
    expectancy: -0.043,
    standardError: 1.2,
    totalPnl: -4.9,
    profitFactor: 0.948,
    reliability: 'noise',
    ...over,
  };
}

function pnl(over: Partial<PnlReport> = {}): PnlReport {
  return {
    generatedAt: '2026-09-12T00:00:00.000Z',
    window: { days: 90, symbol: null },
    sample: { closedTrades: 114, withPnl: 114, distinctDays: 13, firstTrade: null, lastTrade: null },
    overall: bucket(),
    bySide: [],
    bySource: [],
    byStrategy: [],
    caveats: [],
    ...over,
  };
}

function edge(distinctDays: number): EdgeReport {
  return {
    generatedAt: '2026-09-12T00:00:00.000Z',
    appVersion: '0.6.9',
    window: { days: 30, symbol: null, timeframe: null },
    sample: {
      maturedRows: 12471,
      withDirection: 10772,
      distinctSymbols: 18,
      distinctDirectives: 18,
      distinctDays,
    },
    overall: {
      bearish: { n: 7256, hitRate: 0.515, ci95: { low: 0.503, high: 0.527 }, pValue: 0.01, edgeAboveCoinFlip: 0.003, verdict: 'no-edge' },
      bullish: { n: 3516, hitRate: 0.406, ci95: { low: 0.39, high: 0.423 }, pValue: 0.001, edgeAboveCoinFlip: -0.11, verdict: 'no-edge' },
      pooled: { n: 10772, hitRate: 0.479, ci95: { low: 0.47, high: 0.488 }, pValue: 0.001, edgeAboveCoinFlip: -0.03, verdict: 'no-edge' },
    },
    byDirective: [],
    scoreBands: [],
    pnlEvidence: { closedTrades: 114, withPnl: 114, note: '' },
    caveats: [],
  };
}

describe('decideVerdict — exit geometry must never be dropped', () => {
  it('reports inverted reward:risk even in the insufficient-data branch', () => {
    // 4 days -> early return. This is EXACTLY the path that silently discarded the warning.
    const v = decideVerdict(edge(4), pnl());
    expect(v.level).toBe('insufficient-data');
    const joined = v.findings.join(' ');
    expect(joined).toContain('Reward:risk is INVERTED');
  });

  it('names exits/stops as the suspect, not entry scoring', () => {
    const v = decideVerdict(edge(4), pnl());
    expect(v.findings.join(' ')).toContain('exits/stops');
    expect(v.findings.join(' ')).toContain('NOT at entry scoring');
  });

  it('computes the break-even win rate from the actual geometry', () => {
    const v = decideVerdict(edge(4), pnl());
    // 18.828 / (8.924 + 18.828) = 67.8%  ->  "68%"
    expect(v.findings.join(' ')).toContain('68%');
  });

  it('states the ratio between loss and win', () => {
    const v = decideVerdict(edge(4), pnl());
    // 18.828 / 8.924 = 2.11
    expect(v.findings.join(' ')).toContain('2.11x');
  });

  it('stays quiet when reward:risk is favourable', () => {
    // avgLoss smaller than avgWin -> no warning
    const good = pnl({ overall: bucket({ avgWin: 20, avgLoss: -10 }) });
    const v = decideVerdict(edge(4), good);
    expect(v.findings.join(' ')).not.toContain('INVERTED');
  });

  it('stays quiet when there is no PnL at all', () => {
    const none = pnl({ overall: null, sample: { closedTrades: 0, withPnl: 0, distinctDays: 0, firstTrade: null, lastTrade: null } });
    const v = decideVerdict(edge(4), none);
    expect(v.findings.join(' ')).not.toContain('INVERTED');
    expect(v.findings.join(' ')).toContain('No closed PnL');
  });

  it('flags the trade-count target as already met rather than saying "grow past 100"', () => {
    const v = decideVerdict(edge(4), pnl());
    expect(v.whatWouldChangeThis.join(' ')).toContain('already 114');
  });

  it('reports negative expectancy as losing once the sample is adequate', () => {
    const adequate = pnl({
      overall: bucket({ trades: 400, reliability: 'moderate', expectancy: -1.5 }),
      sample: { closedTrades: 400, withPnl: 400, distinctDays: 60, firstTrade: null, lastTrade: null },
    });
    const withEdge = edge(60);
    withEdge.overall.bearish = { n: 4000, hitRate: 0.56, ci95: { low: 0.545, high: 0.575 }, pValue: 0.0001, edgeAboveCoinFlip: 0.045, verdict: 'edge' };
    const v = decideVerdict(withEdge, adequate);
    expect(v.level).toBe('losing');
    expect(v.findings.join(' ')).toContain('Reward:risk is INVERTED');
  });
});
