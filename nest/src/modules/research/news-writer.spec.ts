import {
  writeCanonicalArticle,
  taxonomyNameFor,
  impactOf,
  sentimentOf,
  type NewsWriterPrisma,
} from './news-writer';

/**
 * #1290 — the writers move onto the canonical table.
 *
 * ⚠️ These pin the rules that used to be copied across three `store()` methods. The important ones are
 * the REFUSALS: each returns a reason, so a caller can count what did not happen rather than being
 * told nothing.
 */
describe('news-writer — the three ingesters write newsarticle, not news_item (#1290)', () => {
  describe('source taxonomy', () => {
    it('maps the ingester prefix onto the NewsSource name', () => {
      expect(taxonomyNameFor('fh:finnhub')).toBe('Finnhub');
      expect(taxonomyNameFor('rss:yahoo-finance')).toBe('Yahoo');
      expect(taxonomyNameFor('av:alphavantage')).toBe('Alpha Vantage');
    });

    it('an unknown prefix is null, never a guess', () => {
      expect(taxonomyNameFor('rss:unknown-feed')).toBeNull();
      expect(taxonomyNameFor('')).toBeNull();
    });
  });

  describe('impact bands', () => {
    it.each([[3, 'high'], [5, 'high'], [1, 'medium'], [2, 'medium'], [0, 'low'], [-1, 'low']])(
      'severity %s → %s',
      (severity, band) => {
        expect(impactOf(severity)).toBe(band);
      },
    );

    it('a NaN severity is low, not high', () => {
      expect(impactOf(Number.NaN)).toBe('low');
      expect(impactOf(undefined)).toBe('low');
    });
  });

  describe('sentiment', () => {
    it('accepts a word from the RSS/Finnhub feeds', () => {
      expect(sentimentOf('bullish')).toBe(1);
      expect(sentimentOf('BEARISH')).toBe(-1);
    });

    it('accepts a float from Alpha Vantage and clamps it to the −1..1 scale', () => {
      expect(sentimentOf(0.42)).toBeCloseTo(0.42);
      expect(sentimentOf(9)).toBe(1);
      expect(sentimentOf(-9)).toBe(-1);
    });

    it('an absent sentiment is 0 — not a guess in either direction', () => {
      expect(sentimentOf(null)).toBe(0);
      expect(sentimentOf(undefined)).toBe(0);
      expect(sentimentOf('')).toBe(0);
    });
  });

  describe('writes, and refuses with a reason', () => {
    const mkPrisma = (opts: { existingUrl?: string; existingSource?: boolean } = {}) => {
      const created: any[] = [];
      const prisma: NewsWriterPrisma = {
        newsArticle: {
          findUnique: async ({ where }: any) =>
            opts.existingUrl && where.url === opts.existingUrl ? { id: 'existing' } : null,
          create: async (args: any) => { created.push(args.data); return {}; },
        },
        newsSource: {
          findUnique: async () => (opts.existingSource === false ? null : { id: 'src-1' }),
          create: async () => ({ id: 'src-new' }),
        },
      };
      return { prisma, created };
    };

    const base = {
      headline: 'A headline',
      url: 'https://x.test/1',
      source: 'fh:finnhub',
      symbols: ['nvda', 'dia'],
      publishedAt: new Date('2026-11-01T00:00:00Z'),
      severity: 1,
    };

    it('writes the canonical row and reports the dropped secondary ticker', async () => {
      const { prisma, created } = mkPrisma();
      const out = await writeCanonicalArticle(prisma, base);
      expect(out).toEqual({ status: 'written', symbol: 'NVDA', secondarySymbolsDropped: 1 });
      expect(created[0].symbol).toBe('NVDA');
      expect(created[0].sourceId).toBe('src-1');
    });

    it('a URL already stored is a DUPLICATE, not a write', async () => {
      const { prisma, created } = mkPrisma({ existingUrl: base.url });
      expect((await writeCanonicalArticle(prisma, base)).status).toBe('duplicate');
      expect(created).toHaveLength(0);
    });

    it('creates the taxonomy row when it is missing', async () => {
      const { prisma, created } = mkPrisma({ existingSource: false });
      await writeCanonicalArticle(prisma, base);
      expect(created[0].sourceId).toBe('src-new');
    });

    it.each([
      ['no url', { url: '' }, 'no url'],
      ['no headline', { headline: '' }, 'no headline'],
      ['no symbol', { symbols: [] }, 'no symbol'],
      ['unmapped source', { source: 'rss:made-up' }, 'unmapped source: rss:made-up'],
      ['unreadable date', { publishedAt: new Date('nope') }, 'unreadable publishedAt'],
      ['url too long', { url: 'h' + 'x'.repeat(255) }, 'url exceeds 250 characters'],
    ])('%s → skipped with a reason', async (_label, over, reason) => {
      const { prisma, created } = mkPrisma();
      const out = await writeCanonicalArticle(prisma, { ...base, ...(over as any) });
      expect(out).toEqual({ status: 'skipped', reason });
      expect(created).toHaveLength(0);
    });
  });
});
