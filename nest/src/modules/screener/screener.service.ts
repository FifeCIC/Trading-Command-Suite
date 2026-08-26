/**
 * ScreenerService — catalyst ingestion from real feeds (#648).
 * =====================================================================
 * Maps REAL news and earnings data into ScreenerHits (the #645 contract):
 * attention events, not directional conviction — the Signals area consumes
 * these and scoring computes conviction later.
 *
 *   source='news'      ← NewsArticle rows (DB, imported by NewsImportService)
 *   source='earnings'  ← EarningsEvent rows (DB, imported by EarningsService)
 *
 * Each hit carries `rawPayloadRef` so "why did this surface" is always
 * answerable. Dedupe is per (source, ticker, rawPayloadRef).
 *
 * Runs on a 15-min cron + an initial pass at boot; POST /api/screener/ingest
 * triggers it manually.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { NewsImportService } from '../news/news-import.service';
import { EarningsService } from '../earnings/earnings.service';
import { SuitabilityService } from '../suitability/suitability.service';

const IMPACT_BONUS: Record<string, number> = {
  high: 20,
  medium: 10,
  low: 0,
  minimal: -10,
};

/**
 * Pure recency factor for one ticker's hit group (#647 / epic #682 Phase 4.1).
 * Exported + DB-free so the decay modes are unit-testable.
 *
 *   - Earnings-style: a FUTURE event date → proximity weighting, 1/(1+daysAway)
 *     (today = 1, 7 days out = 1/8, …). Closer events rank higher.
 *   - News-style: a PAST timestamp → age decay with a 24h half-life,
 *     0.5^(hours/24) (just published = 1, 24h old = 0.5, 48h old = 0.25).
 *
 * A future event always wins over past history when both exist.
 */
export function screenerRecency(nowMs: number, nextFutureMs?: number | null, latestMs?: number | null): number {
  if (nextFutureMs != null) {
    const daysAway = Math.max(0, (nextFutureMs - nowMs) / 86_400_000);
    return 1 / (1 + daysAway);
  }
  const ageHours = Math.max(0, (nowMs - (latestMs ?? nowMs)) / 3_600_000);
  return Math.pow(0.5, ageHours / 24);
}

/** Pure attention weight before normalisation: strength × reliability × recency. */
export function screenerRawWeight(strength: number, reliability: number, recency: number): number {
  return (strength / 100) * (reliability / 100) * recency * 100;
}

/**
 * Normalise raw attention weights to 0–100 against the strongest current
 * catalyst (in place). Relative by design: with every event far out, the
 * board still shows a clear ranking instead of an all-zero column.
 */
export function normalizeAttentionWeights<T extends { rawAttentionWeight: number; attentionWeight?: number }>(rows: T[]): T[] {
  const maxRaw = Math.max(0, ...rows.map((r) => r.rawAttentionWeight));
  for (const r of rows) {
    r.attentionWeight = maxRaw > 0 ? Math.round((r.rawAttentionWeight / maxRaw) * 100) : 0;
  }
  return rows;
}

@Injectable()
export class ScreenerService implements OnModuleInit {
  private readonly logger = new Logger(ScreenerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly newsImport: NewsImportService,
    private readonly earnings: EarningsService,
    private readonly suitability: SuitabilityService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Initial ingestion shortly after boot (DB-only reads — no external calls).
    setTimeout(() => {
      this.runIngestion().catch((err) =>
        this.logger.warn(`Initial screener ingestion failed: ${err.message}`),
      );
    }, 10_000);
  }

  /** Scheduled ingestion — real feeds → ScreenerHit. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledIngestion(): Promise<void> {
    try {
      await this.runIngestion();
    } catch (err) {
      this.logger.warn(`Screener ingestion failed: ${(err as Error).message}`);
    }
  }

  /** Run both feed mappers. */
  async runIngestion() {
    const news = await this.ingestNews(300);
    const earnings = await this.ingestEarnings(90);
    this.logger.log(
      `Screener ingestion: news +${news.created}/${news.created + news.skipped}, earnings +${earnings.created}/${earnings.created + earnings.skipped}`,
    );
    return { news, earnings };
  }

  /**
   * Map real news into news-mention ScreenerHits from both live feeds:
   *  1. news_item — RSS items (fresh; ticker-matched by the scraper)
   *  2. newsarticle — Finnhub company news (may lag on the free tier)
   */
  async ingestNews(limit = 300): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;
    const bump = async (
      ticker: string,
      ref: string,
      strength: number,
      reliability: number,
      ts: Date,
    ) => {
      const t = String(ticker || '').trim().toUpperCase();
      if (!t || !ref) { skipped++; return; }
      if (await this.exists('news', t, ref)) { skipped++; return; }
      await this.prisma.screenerHit.create({
        data: {
          ticker: t,
          source: 'news',
          catalystType: 'news-mention',
          catalystStrength: strength,
          sourceReliability: reliability,
          rawPayloadRef: ref,
          timestamp: ts,
        },
      });
      created++;
    };

    // RSS items (fresh) — news_item table.
    try {
      const rss: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT url, symbols, severity, publishedAt FROM news_item
         WHERE symbols IS NOT NULL AND symbols <> ''
           AND publishedAt >= DATE_SUB(NOW(), INTERVAL 2 DAY)
         ORDER BY publishedAt DESC LIMIT ?`,
        limit,
      );
      for (const r of rss) {
        const strength = Math.min(100, Math.max(10, Number(r.severity) || 45));
        for (const sym of String(r.symbols).split(',').map((s) => s.trim()).filter(Boolean)) {
          await bump(sym, r.url, strength, 40, new Date(r.publishedAt));
        }
      }
    } catch { /* news_item table may not exist yet */ }

    // Finnhub company news — 30-day window (free tier can lag).
    const articles = await this.newsImport.getArticles({ days: 30, limit });
    for (const a of articles) {
      await bump(
        a.symbol,
        a.url,
        this.newsStrength(a),
        (a.source as any)?.reliabilityScore ?? 50,
        a.publishedAt ?? new Date(),
      );
    }
    return { created, skipped };
  }

  /** Map upcoming EarningsEvent rows into earnings-date ScreenerHits. */
  async ingestEarnings(days = 90): Promise<{ created: number; skipped: number }> {
    const events = await this.earnings.getCalendar(days);
    let created = 0;
    let skipped = 0;
    for (const e of events) {
      const ticker = String(e.symbol).toUpperCase();
      const ref = `calendar:${ticker}:${e.reportDate.toISOString().slice(0, 10)}`;
      if (await this.exists('earnings', ticker, ref)) { skipped++; continue; }
      const daysAway = Math.max(
        0,
        Math.round((e.reportDate.getTime() - Date.now()) / 86_400_000),
      );
      // Proximity-weighted strength: the closer, the more actionable.
      const strength = Math.min(100, Math.max(5, 100 - daysAway * 2));
      await this.prisma.screenerHit.create({
        data: {
          ticker,
          source: 'earnings',
          catalystType: 'earnings-date',
          catalystStrength: strength,
          sourceReliability: 80,
          rawPayloadRef: ref,
          timestamp: e.reportDate,
        },
      });
      created++;
    }
    return { created, skipped };
  }

  /** Catalyst strength for a news article: sentiment magnitude + impact, 1–100. */
  private newsStrength(a: any): number {
    const sentiment = Number(a.sentiment) || 0; // -1..1
    const impactBonus = IMPACT_BONUS[String(a.impact || 'medium')] ?? 0;
    return Math.min(100, Math.max(1, Math.round(40 + Math.abs(sentiment) * 50 + impactBonus)));
  }

  /**
   * News lean (#682 Phase 4.2) — per-story LONG / SHORT / NEUTRAL.
   *
   * Primary: stored numeric sentiment (±1) when available (future enrichment
   * pipelines). Today the stored pipelines carry NO sentiment (Finnhub free
   * tier omits it), so lean falls back to a CONSERVATIVE headline lexicon —
   * a story must contain bullish terms and NO bearish terms (or vice versa)
   * to earn a direction. Everything else stays NEUTRAL (honest, not guessed).
   * Computed on read, never stored — ScreenerHit stays source-agnostic (#645).
   */
  private leanForStory(headline: string, sentiment: number | null, impact: string | null): 'LONG' | 'SHORT' | 'NEUTRAL' {
    const s = Number(sentiment);
    if (Number.isFinite(s) && Math.abs(s) > 0.05) {
      const nudge = impact === 'high' ? 0.05 : 0;
      const score = s > 0 ? s + nudge : s - nudge;
      if (score > 0.25) return 'LONG';
      if (score < -0.25) return 'SHORT';
      return 'NEUTRAL';
    }
    return this.leanFromHeadline(headline);
  }

  /** Conservative directional lexicon — headline only, first-match counts. */
  private leanFromHeadline(headline: string): 'LONG' | 'SHORT' | 'NEUTRAL' {
    const h = String(headline || '').toLowerCase();
    const bullTerms = [
      'beat', 'beats', 'beats estimates', 'raised', 'raises', 'raise guidance',
      'upgrade', 'upgrades', 'upgraded', 'strong', 'rally', 'rallies', 'surge',
      'surges', 'record high', 'buyback', 'growth', 'bullish', 'jumps', 'soars',
      'tops estimates', 'outperform', 'breakthrough', 'record profit',
    ];
    const bearTerms = [
      'miss', 'misses', 'cut', 'cuts', 'downgrade', 'downgrades', 'downgraded',
      'weak', 'plunge', 'plunges', 'crash', 'sell-off', 'selloff', 'bearish',
      'slumps', 'layoff', 'layoffs', 'probe', 'investigation', 'lawsuit',
      'underperform', 'downturn', 'falls short',
    ];
    let bull = 0;
    let bear = 0;
    for (const t of bullTerms) {
      if (new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(h)) bull++;
    }
    for (const t of bearTerms) {
      if (new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(h)) bear++;
    }
    if (bull > 0 && bear === 0) return 'LONG';
    if (bear > 0 && bull === 0) return 'SHORT';
    return 'NEUTRAL';
  }

  /** Story lookup by URL — NewsArticle first (has direction), RSS fallback. */
  private async fetchStoryMap(urls: string[]) {
    const map = new Map<string, any>();
    if (!urls.length) return map;
    try {
      const articles = await this.prisma.newsArticle.findMany({
        where: { url: { in: urls } },
        select: {
          url: true, headline: true, sentiment: true, impact: true,
          publishedAt: true, symbol: true,
        },
      });
      for (const a of articles) {
        map.set(a.url, {
          headline: a.headline,
          sentiment: a.sentiment,
          impact: a.impact,
          publishedAt: a.publishedAt,
          source: 'finnhub',
          lean: this.leanForStory(a.headline, a.sentiment, a.impact),
        });
      }
    } catch { /* newsarticle may not exist yet */ }
    try {
      const items = await (this.prisma as any).newsItem.findMany({
        where: { url: { in: urls } },
        select: { title: true, url: true, sentiment: true, severity: true, publishedAt: true, source: true },
      });
      for (const it of items) {
        if (map.has(it.url)) continue;
        const sentStr = typeof it.sentiment === 'string' ? it.sentiment.toLowerCase() : '';
        const sentNum = sentStr === 'bullish' ? 1 : sentStr === 'bearish' ? -1 : null;
        map.set(it.url, {
          headline: it.title,
          sentiment: sentNum,
          impact: null,
          publishedAt: it.publishedAt,
          source: it.source || 'rss',
          lean: this.leanForStory(it.title, sentNum, null),
        });
      }
    } catch { /* news_item may not exist yet */ }
    return map;
  }

  /** Per-ticker news stories for the Screener popover (one round-trip). */
  async stories(ticker: string, limit = 20) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return { ticker: t, stories: [] };
    let rows;
    try {
      rows = await this.prisma.screenerHit.findMany({
        where: { ticker: t, source: 'news' },
        orderBy: { timestamp: 'desc' },
        take: 50,
      });
    } catch {
      rows = [];
    }
    const refs = rows.map((h) => h.rawPayloadRef).filter(Boolean) as string[];
    const storyMap = await this.fetchStoryMap(refs);
    const stories = refs
      .map((url) => storyMap.get(url))
      .filter(Boolean)
      .map((s) => ({
        headline: s.headline,
        lean: s.lean,
        source: s.source,
        publishedAt: s.publishedAt ? new Date(s.publishedAt).toISOString() : null,
      }))
      .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
      .slice(0, limit);
    return { ticker: t, stories };
  }

  /**
   * Attention-weight ranking (#647 / epic #682 Phase 4.1) — computed on read,
   * never stored. Groups ScreenerHits per ticker and ranks by
   * `strength × reliability × recency`:
   *
   *   - Earnings hits carry a FUTURE event date → recency is proximity to the
   *     event (closer = higher).
   *   - News hits carry a PAST timestamp → recency is age decay
   *     (half-life 24h).
   *
   * Also returns transparency counts (#682 decision 9): how many DB symbols
   * have catalysts vs how many are quiet, so the UI can show what the app
   * filtered out in the background.
   */
  async ranked(limit = 100, source?: string) {
    const baseWhere: any = {};
    if (source) baseWhere.source = source;

    // Two windows, both ordered so the most ACTIONABLE hits survive the take
    // cap: future events ascending (nearest first — proximity matters most),
    // recent past events descending (freshest first). A single global
    // timestamp-desc query would push the nearest earnings dates out past the
    // 2000-row cap and surface the farthest ones instead.
    const now = new Date();
    const newsCutoff = new Date(now.getTime() - 7 * 86_400_000);

    let rows;
    try {
      const [futureRows, pastRows] = await Promise.all([
        this.prisma.screenerHit.findMany({
          where: { ...baseWhere, timestamp: { gte: now } },
          orderBy: { timestamp: 'asc' },
          take: 2000,
        }),
        this.prisma.screenerHit.findMany({
          where: { ...baseWhere, timestamp: { lt: now, gte: newsCutoff } },
          orderBy: { timestamp: 'desc' },
          take: 2000,
        }),
      ]);
      rows = [...futureRows, ...pastRows];
    } catch {
      rows = [];
    }

    const nowMs = now.getTime();

    // News lean (#682 Phase 4.2) — batch-resolve stories for every news hit
    // in the window so ranked rows can carry `lean` + `storyCount`.
    const allNewsRefs = new Set<string>();
    for (const h of rows) {
      if (h.source === 'news' && h.rawPayloadRef) allNewsRefs.add(h.rawPayloadRef);
    }
    const storyMap = await this.fetchStoryMap([...allNewsRefs].slice(0, 1500));
    const groups = new Map<string, typeof rows>();
    for (const h of rows) {
      const t = String(h.ticker || '').trim().toUpperCase();
      if (!t) continue;
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t)!.push(h);
    }

    const ranked = [];
    for (const [ticker, hits] of groups) {
      // MAX aggregation, not average: a ticker's attention is dominated by
      // its single strongest catalyst. Averaging would let one earnings date
      // plus a dozen low-value news mentions bury a real signal.
      const strength = Math.max(...hits.map((h) => Number(h.catalystStrength) || 0));
      const reliability = Math.max(...hits.map((h) => Number(h.sourceReliability) || 50));
      const times = hits.map((h) => new Date(h.timestamp).getTime());
      const latest = Math.max(...times);
      const nextFuture = times.filter((ts) => ts > nowMs).sort((a, b) => a - b)[0];

      const recency = screenerRecency(nowMs, nextFuture, latest);

      const rawWeight = screenerRawWeight(strength, reliability, recency);
      const stories = hits
        .filter((h) => h.source === 'news' && h.rawPayloadRef && storyMap.has(h.rawPayloadRef))
        .map((h) => storyMap.get(h.rawPayloadRef)!);
      const longCount = stories.filter((s) => s.lean === 'LONG').length;
      const shortCount = stories.filter((s) => s.lean === 'SHORT').length;
      const lean = stories.length === 0
        ? null
        : longCount > shortCount ? 'LONG' : shortCount > longCount ? 'SHORT' : 'NEUTRAL';
      ranked.push({
        ticker,
        sources: [...new Set(hits.map((h) => h.source))],
        catalystTypes: [...new Set(hits.map((h) => h.catalystType))],
        hitCount: hits.length,
        strength,
        reliability,
        recency: Number(recency.toFixed(3)),
        attentionWeight: 0, // normalised below (relative to the strongest catalyst)
        rawAttentionWeight: Number(rawWeight.toFixed(2)),
        latestTimestamp: new Date(latest).toISOString(),
        nextEventAt: nextFuture != null ? new Date(nextFuture).toISOString() : null,
        lean,
        storyCount: stories.length,
      });
    }

    // Attention is RELATIVE — normalise to 0–100 against the strongest current
    // catalyst so the UI never shows an all-zero board when every event is far
    // out (e.g. earnings 3 months away → tiny raw weights but a clear ranking).
    normalizeAttentionWeights(ranked);
    ranked.sort((a, b) => b.attentionWeight - a.attentionWeight);

    // Transparency counts (best-effort — never block ranking on them).
    let universe = { totalSymbols: 0, hitSymbols: 0, quietSymbols: 0 };
    let inDbTickers = new Set<string>();
    let tickerMeta = new Map<string, { type: string; name: string; exchange: string; id: string }>();
    try {
      const totalSymbols = await this.prisma.symbol.count({ where: { active: true } });
      const hitTickers = [...new Set(ranked.map((r) => r.ticker))];
      const inDb = await this.prisma.symbol.findMany({
        where: { ticker: { in: hitTickers } },
        select: { id: true, ticker: true, type: true, name: true, exchange: true },
      });
      inDbTickers = new Set(inDb.map((s) => s.ticker.toUpperCase()));
      for (const s of inDb) {
        tickerMeta.set(s.ticker.toUpperCase(), { type: s.type, name: s.name, exchange: s.exchange, id: s.id });
      }
      universe = {
        totalSymbols,
        hitSymbols: inDbTickers.size,
        quietSymbols: Math.max(0, totalSymbols - inDbTickers.size),
      };
    } catch { /* leave zeroed */ }

    // Suitability (#646) — static "does this symbol fit any protocol" join,
    // no market data, no scores. Only meaningful for known symbols.
    let protocols: any[] = [];
    try {
      protocols = await this.prisma.protocol.findMany({
        where: { active: true },
        select: { slug: true, name: true, directionMode: true, tradingStyle: true, recommendedTimeframe: true },
      });
    } catch { /* no protocols */ }

    // Promotion state — which tickers are already in a watchlist (Phase 4.4).
    let promotedByTicker = new Map<string, string>();
    try {
      const items = await this.prisma.watchlistItem.findMany({
        where: {
          ticker: { in: [...inDbTickers, ...ranked.map((r) => r.ticker)] },
          status: { not: 'expired' },
        },
        select: { ticker: true, status: true },
      });
      for (const it of items) {
        promotedByTicker.set(it.ticker.toUpperCase(), it.status);
      }
    } catch { /* no watchlist_item */ }

    // Flag rows the user can actually act on (symbol exists in their DB) —
    // the rest are discovery candidates surfaced by the attention funnel.
    for (const r of ranked) {
      r.inDb = inDbTickers.has(r.ticker);
      const meta = tickerMeta.get(r.ticker);
      if (meta && protocols.length > 0) {
        const verdicts = this.suitability.evaluateAll(
          { ticker: r.ticker, type: meta.type },
          protocols.map((p) => ({
            slug: p.slug,
            name: p.name,
            directionMode: p.directionMode,
            tradingStyle: p.tradingStyle,
            recommendedTimeframe: p.recommendedTimeframe,
            // Symbol-type expectations are inferred from slug/style/name —
            // no per-protocol column exists yet (see #646).
            symbolTypes: this.suitability.inferProtocolSymbolTypes(p),
          })),
        );
        const fits = verdicts.filter((v) => v.fits);
        r.fitsCount = fits.length;
        r.fitsProtocols = fits.map((v) => v.protocolSlug);
      } else {
        r.fitsCount = null;
        r.fitsProtocols = [];
      }
      r.promotedStatus = promotedByTicker.get(r.ticker) || null;
    }

    return {
      universe,
      totalHits: rows.length,
      rankedCount: ranked.length,
      ranked: ranked.slice(0, limit),
    };
  }

  /**
   * Promote a ticker into a watchlist (epic #682 Phase 4.4 — manual, 1:1
   * provenance). Creates a WatchlistItem (status 'new', linked to the latest
   * ScreenerHit) and appends the ticker to the named Watchlist's symbols.
   * Watchlist resolution: explicit id → name (find or create) → default →
   * create "Screener".
   *
   * Returns exactly one of: `{ promoted, item, watchlistName }` (created),
   * `{ already, item, watchlistName }` (1:1 provenance already exists —
   * idempotent, no duplicate WatchlistItem), or `{ error }` (bad request /
   * no hit / no watchlist).
   */
  async promote(ticker: string, watchlistId?: string, watchlistName?: string) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return { error: 'ticker is required' };

    let watchlist: any = null;
    try {
      if (watchlistId) {
        watchlist = await this.prisma.watchlist.findUnique({ where: { id: watchlistId } });
      } else if (watchlistName?.trim()) {
        const name = watchlistName.trim();
        watchlist = await this.prisma.watchlist.findFirst({ where: { name } });
        if (!watchlist) {
          watchlist = await this.prisma.watchlist.create({ data: { name, symbols: [] } });
        }
      } else {
        watchlist = await this.prisma.watchlist.findFirst({ where: { isDefault: true } });
        if (!watchlist) {
          watchlist = await this.prisma.watchlist.create({ data: { name: 'Screener', symbols: [] } });
        }
      }
    } catch { /* fall through */ }
    if (!watchlist) return { error: 'watchlist not found and could not be created' };

    const hit = await this.prisma.screenerHit.findFirst({
      where: { ticker: t },
      orderBy: { timestamp: 'desc' },
    });
    if (!hit) return { error: 'no screener hit for ticker' };

    const existing = await this.prisma.watchlistItem.findUnique({
      where: { screenerHitId: hit.id },
    });
    if (existing) {
      return { already: true, item: existing, watchlistName: watchlist.name };
    }

    const sym = await this.prisma.symbol.findFirst({ where: { ticker: t } });

    const item = await this.prisma.watchlistItem.create({
      data: {
        watchlistId: watchlist.id,
        ticker: t,
        symbolId: sym?.id ?? null,
        status: 'new',
        source: hit.source,
        screenerHitId: hit.id,
      },
    });

    // Also surface the ticker in the named Watchlist itself so existing
    // watchlist views pick it up immediately.
    const symbols = Array.isArray(watchlist.symbols) ? [...watchlist.symbols] : [];
    const already = symbols.some((s: any) => String(s?.ticker || s || '').toUpperCase() === t);
    if (!already) {
      symbols.push(sym ? { ticker: t, name: sym.name, exchange: sym.exchange, type: sym.type } : { ticker: t });
      await this.prisma.watchlist.update({
        where: { id: watchlist.id },
        data: { symbols: symbols as any },
      });
    }

    return { promoted: true, item, watchlistName: watchlist.name };
  }

  private async exists(source: string, ticker: string, ref: string): Promise<boolean> {
    const row = await this.prisma.screenerHit.findFirst({
      where: { source, ticker, rawPayloadRef: ref },
      select: { id: true },
    });
    return !!row;
  }
}
