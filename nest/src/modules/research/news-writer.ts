/**
 * news-writer.ts — write a research-ingester story into the CANONICAL news table (#1290).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * Three research ingesters (RSS 120 s, Finnhub 300 s, Alpha Vantage daily) used to write `news_item`,
 * a table read by ONE consumer and duplicating `newsarticle` — which is read by NINE modules, owns the
 * `NewsSource` taxonomy, and is what the UI's tape renders. Measured 2026-11-17: 17,245 URLs existed
 * in both.
 *
 * Guarding the writers stopped NEW duplicates (`news-dedupe.ts`). This is the other half: the writers
 * now write the canonical table, so there is nothing left to duplicate.
 *
 * ── ONE DEFINITION, THREE CALLERS ──────────────────────────────────────────────────────────────
 * Every rule below was previously spread across three near-identical `store()` methods that differed
 * only in the URL prefix. Three copies drift; one gets the fix.
 *
 * ⚠️ THE TAXONOMY ROW IS CREATED ON DEMAND, mirroring `news-import.service.ts:344`, so a source
 * created here cannot differ in shape from one created at ingest (`url` is NOT NULL and both write '').
 *
 * ⚠️ THE FIRST SYMBOL IS THE ONE STORED. `newsarticle.url` is UNIQUE, so a story can hold exactly one
 * symbol — a second row for the same URL is impossible. Measured: 102 of 10,396 attributed stories
 * carry more than one ticker. Storing the rest needs a join table; until then the caller is told how
 * many were dropped rather than being told nothing.
 */

/** The `source` string an ingester uses → the `NewsSource.name` taxonomy row it belongs to. */
export const SOURCE_TAXONOMY: Record<string, string> = {
  'fh:finnhub': 'Finnhub',
  'av:alphavantage': 'Alpha Vantage',
  'rss:yahoo-finance': 'Yahoo',
  'rss:seeking-alpha': 'SeekingAlpha',
  'rss:marketwatch': 'MarketWatch',
  'rss:cnbc': 'CNBC',
  'rss:benzinga': 'Benzinga',
};

export function taxonomyNameFor(source: string): string | null {
  return SOURCE_TAXONOMY[String(source ?? '').trim()] ?? null;
}

/** `severity` (int) → the `impact` band `newsarticle` stores. */
export function impactOf(severity: unknown): 'low' | 'medium' | 'high' {
  const n = Number(severity);
  if (!Number.isFinite(n)) return 'low';
  if (n >= 3) return 'high';
  if (n >= 1) return 'medium';
  return 'low';
}

/**
 * `newsarticle.sentiment` is a float on a −1..1 scale. Alpha Vantage supplies one directly; the RSS and
 * Finnhub feeds supply the WORD 'bullish' / 'bearish' or nothing. Both are accepted so a caller never
 * has to convert.
 *
 * ⚠️ An absent sentiment is **0**, not a guess in either direction — measured: every stored
 * `news_item` row had `sentiment = NULL`, so 0 is the honest reading rather than a middle-of-the-road
 * opinion.
 */
export function sentimentOf(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(-1, Math.min(1, raw));
  }
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'bullish' || s === 'positive') return 1;
  if (s === 'bearish' || s === 'negative') return -1;
  return 0;
}

export interface NewsArticleInput {
  headline: string;
  url: string;
  source: string;
  symbols: string[];
  summary?: string | null;
  publishedAt: Date;
  sentiment?: number | string | null;
  severity?: number | null;
  category?: string | null;
}

export type WriteOutcome =
  | { status: 'written'; symbol: string; secondarySymbolsDropped: number }
  | { status: 'duplicate' }
  | { status: 'skipped'; reason: string };

/** The bit of Prisma this needs. Structural so it imports no service type. */
export interface NewsWriterPrisma {
  newsArticle: {
    findUnique(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<unknown>;
  };
  newsSource: {
    findUnique(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<{ id: string }>;
  };
}

/**
 * Write one story. Returns WHY it did or did not, so a caller can count duplicates and skips instead of
 * inferring them from an empty log.
 */
export async function writeCanonicalArticle(
  prisma: NewsWriterPrisma,
  input: NewsArticleInput,
): Promise<WriteOutcome> {
  const url = String(input?.url ?? '').trim();
  const headline = String(input?.headline ?? '').trim();
  if (!url) return { status: 'skipped', reason: 'no url' };
  if (!headline) return { status: 'skipped', reason: 'no headline' };
  // `newsarticle.url` is varchar(250). Truncating would store a DIFFERENT url and break dedupe, so the
  // story is refused and the caller reports it.
  if (url.length > 250) return { status: 'skipped', reason: 'url exceeds 250 characters' };

  const symbols = (input.symbols ?? []).map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  if (symbols.length === 0) return { status: 'skipped', reason: 'no symbol' };

  const sourceName = taxonomyNameFor(input.source);
  if (!sourceName) return { status: 'skipped', reason: `unmapped source: ${input.source}` };

  const publishedAt = input.publishedAt instanceof Date ? input.publishedAt : new Date(input.publishedAt as unknown as string);
  if (Number.isNaN(publishedAt.getTime())) return { status: 'skipped', reason: 'unreadable publishedAt' };

  // `url` is UNIQUE, so this is the whole dedupe — no separate hash column is needed.
  const existing = await prisma.newsArticle.findUnique({ where: { url }, select: { id: true } });
  if (existing) return { status: 'duplicate' };

  let source = await prisma.newsSource.findUnique({ where: { name: sourceName }, select: { id: true } });
  if (!source) {
    source = await prisma.newsSource.create({
      data: { name: sourceName, url: '', reliabilityScore: 5.0, patterns: {} },
      select: { id: true },
    });
  }

  await prisma.newsArticle.create({
    data: {
      symbol: symbols[0],
      sourceId: source.id,
      category: input.category?.trim() || 'general',
      headline: headline.slice(0, 2000),
      url,
      summary: input.summary ? String(input.summary) : null,
      sentiment: sentimentOf(input.sentiment),
      impact: impactOf(input.severity),
      publishedAt,
    },
  });

  return { status: 'written', symbol: symbols[0], secondarySymbolsDropped: symbols.length - 1 };
}
