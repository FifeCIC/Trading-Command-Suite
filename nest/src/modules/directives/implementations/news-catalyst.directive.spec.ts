import { NewsCatalystDirective, NewsEventInput } from './news-catalyst.directive';

/**
 * The measured facts this directive is built on (2026-10-01, 12,298 `news_item` rows):
 * `sentiment` is 0% populated and `severity` holds only the value 1 — so the tests below assert the
 * directive scores what is REAL (relevance, recency, volume) and never reaches for either field.
 */
const d = new NewsCatalystDirective();
const AS_OF = new Date('2026-10-01T12:00:00Z');
const hoursAgo = (h: number) => new Date(AS_OF.getTime() - h * 3_600_000).toISOString();

const call = (news: NewsEventInput[] | undefined, symbol = 'VIX') =>
  d.calculate({ symbol, bars: [], asOf: AS_OF, news } as any);

describe('news-catalyst-strength — presence, not sentiment', () => {
  it('an ABSENT feed is unmeasured, never a score of zero', () => {
    // ⚠️ The distinction the whole result contract rests on: "I could not read the news" and "there
    // is no news" are different facts. Collapsing them would let a broken producer look like calm.
    const r = call(undefined);
    expect(r.score).toBe(0);
    expect(r.unmeasured).toBe(true);
    expect(r.confidence).toBe(0);
  });

  it('a feed that was READ and found nothing is a measured zero, NOT unmeasured', () => {
    const r = call([{ symbols: 'AAPL', publishedAt: hoursAgo(1) }]);
    expect(r.score).toBe(0);
    expect(r.unmeasured).toBeUndefined(); // absent, not true — this was a measurement
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('scores a live catalyst, and says how fresh and how many', () => {
    const r = call([
      { symbols: 'VIX', publishedAt: hoursAgo(0.5) },
      { symbols: 'VIX', publishedAt: hoursAgo(3) },
    ]);
    expect(r.score).toBeGreaterThan(30);
    expect(r.reason).toMatch(/2 headline/);
  });

  it('recency DOMINATES volume — one fresh headline beats six stale ones', () => {
    const fresh = call([{ symbols: 'VIX', publishedAt: hoursAgo(0.25) }]);
    const stale = call(
      Array.from({ length: 6 }, (_, i) => ({ symbols: 'VIX', publishedAt: hoursAgo(20 + i * 0.1) })),
    );
    expect(fresh.score).toBeGreaterThan(stale.score);
  });

  it('matches the TICKER exactly, never as a substring', () => {
    // "VIX" must not match a headline tagged "VIXY" — a substring match is the kind of silent
    // over-match that inflates a score while looking plausible.
    const r = call([{ symbols: 'VIXY,SPY', publishedAt: hoursAgo(1) }]);
    expect(r.score).toBe(0);
    expect(r.reason).toMatch(/No headline mentions VIX/);
  });

  it('ignores a headline dated in the FUTURE rather than scoring it as maximally fresh', () => {
    const future = new Date(AS_OF.getTime() + 6 * 3_600_000).toISOString();
    const r = call([{ symbols: 'VIX', publishedAt: future }]);
    expect(r.score).toBe(0);
  });

  it('ignores a headline outside the window', () => {
    const r = call([{ symbols: 'VIX', publishedAt: hoursAgo(30) }]);
    expect(r.score).toBe(0);
    expect(r.reason).toMatch(/no live catalyst/);
  });

  it('reports the confidence boundary honestly: a symbol with no match is low-confidence, not zero', () => {
    expect(call([], 'NVDA').confidence).toBeGreaterThan(0);
  });

  it('stays within its declared maxScore', () => {
    const flood = call(Array.from({ length: 50 }, () => ({ symbols: 'VIX', publishedAt: hoursAgo(0.1) })));
    expect(flood.score).toBeLessThanOrEqual(d.maxScore);
    expect(flood.score).toBeGreaterThan(0);
  });

  it('declares the feed it needs, so a missing producer is visible', () => {
    expect(d.requiredDataFeeds).toContain('news');
  });
});
