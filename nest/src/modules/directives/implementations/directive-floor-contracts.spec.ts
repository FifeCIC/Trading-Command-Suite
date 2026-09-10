import { CadUsdOilCorrelationDirective } from './cad-usd-oil-correlation.directive';
import { EarningsProximityDirective } from './earnings-proximity.directive';
import { MarketBar } from '../interfaces/directive.interface';

/**
 * Floor / phantom-contribution contracts (#731, 2026-09-10).
 *
 * Two failure modes this file locks down:
 *  1. A directive that returns a CONSTANT score when it has no evidence
 *     (out-of-scope symbol, missing feed). That constant inflates Opportunity
 *     and every protocol denominator while carrying no signal — the same
 *     disease #638 fixed for gates.
 *  2. A directive whose maxScore counts points that can never be earned
 *     (a bonus tier reading an input no producer writes).
 */

function bars(count = 25): MarketBar[] {
  const out: MarketBar[] = [];
  for (let i = 0; i < count; i++) {
    const close = 100 + i;
    out.push({
      timestamp: new Date(Date.UTC(2026, 8, 1) + i * 86_400_000),
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000_000,
    });
  }
  return out;
}

describe('cad-usd-oil-correlation — scope and weight contracts', () => {
  const d = new CadUsdOilCorrelationDirective();

  it('contributes nothing for a symbol outside its scope', () => {
    const r = d.calculate({ symbol: 'XAUUSD', bars: bars() });

    expect(r.score).toBe(0); // was a constant 50
    expect(r.signalClass).toBe('neutral');
    expect(r.confidence).toBe(0);
  });

  it('contributes nothing when no macro data is available', () => {
    const r = d.calculate({ symbol: 'USDCAD', bars: bars() });

    expect(r.score).toBe(0); // was a constant 50
    expect(r.signalClass).toBe('neutral');
  });

  it('declares no point that cannot be earned', () => {
    // The +25 oil tier was unreachable: nothing writes input.wtiValue.
    expect(d.maxScore).toBe(100);
    expect(d.minScore).toBe(0);
    expect(d.requiredDataFeeds).not.toContain('oil');
  });

  it('scores every earnable point from the DXY base and stays in range', () => {
    const strongUsd = d.calculate({ symbol: 'USDCAD', bars: bars(), dxyValue: 108 } as any);
    const weakUsd = d.calculate({ symbol: 'USDCAD', bars: bars(), dxyValue: 95 } as any);

    expect(strongUsd.score).toBe(100); // strong USD rallies the USD-base pair
    expect(weakUsd.score).toBe(0);
    expect(strongUsd.score).toBeLessThanOrEqual(d.maxScore);
    expect(weakUsd.score).toBeGreaterThanOrEqual(0);
  });

  it('inverts the reading for a CAD cross so the correlation is consistent', () => {
    const usdBase = d.calculate({ symbol: 'USDCAD', bars: bars(), dxyValue: 95 } as any);
    const cadCross = d.calculate({ symbol: 'EURCAD', bars: bars(), dxyValue: 95 } as any);

    expect(cadCross.score).toBe(100); // weak USD lifts CAD crosses
    expect(usdBase.score).toBe(0);
  });
});

describe('earnings-proximity — no contribution without the feed', () => {
  const d = new EarningsProximityDirective();

  it('contributes nothing when no earnings date is supplied', () => {
    const r = d.calculate({ symbol: 'AAPL', bars: bars() });

    expect(r.score).toBe(0); // was a constant 45 "mock-neutral"
    expect(r.signalClass).toBe('neutral');
    expect(r.confidence).toBe(0);
  });

  it('scores within maxScore once an earnings date is present', () => {
    const series = bars();
    const asOf = series[series.length - 1].timestamp as unknown as Date;
    const nextDay = new Date(new Date(asOf).getTime() + 86_400_000).toISOString();

    const r = d.calculate({
      symbol: 'AAPL',
      bars: series,
      asOf,
      earningsDate: nextDay,
    } as any);

    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(d.maxScore);
    expect(d.minScore).toBe(0);
  });
});
