/**
 * News Taxonomy — shared classification for ALL news import pipelines
 * =====================================================================
 * Single source of truth for category/impact classification used by:
 *   - NewsImportService   (NewsArticle table, tiered Finnhub imports)
 *   - FinnhubNewsService  (news_item, per-symbol polling)
 *   - RssScraperService   (news_item, RSS feeds)
 *
 * ── Why categories matter ─────────────────────────────────────────
 * Categories drive the default import allowlist (news NOT in the allowlist
 * is never stored). The categories most likely to become directives (the
 * "power" axis) are earnings / price-prediction / rating-change /
 * corporate-action — a "likely beat" claim or a "$900 target" is itself the
 * signal, which is why impact does NOT override category:
 * a LOW-impact price-prediction (neutral sentiment) is still imported, while
 * a HIGH-impact product headline ("Krafton pays Subnautica bonuses") is not.
 *
 * ── Dimensions ─────────────────────────────────────────────────────
 *  • category: WHAT the news is (rule-based keyword matching)
 *  • impact:   expected price movement (category floor + keyword + sentiment)
 *  • relevance: tracked-symbol membership (computed by importers, not here)
 *  • power:    directive-ability — categories that can become signals later
 *
 * Changing the rules below changes classification for every pipeline —
 * keep patterns conservative (no broad regexes like /\bstock\b/).
 */

export interface NewsCategoryRule {
  category: string;
  patterns: RegExp[];
}

/** First-match-wins. Order matters — earnings before price-prediction
 *  because earnings headlines contain dollar figures too. */
export const NEWS_CATEGORY_RULES: NewsCategoryRule[] = [
  {
    category: 'earnings',
    patterns: [
      /earnings?/i, /\brevenue (estimate|beat|miss|forecast|grow|guidance|decline)/i, /\beps\b/i, /quarterly results/i,
      /beat|miss/i, /guidance/i, /outlook/i, /forecast/i,
      /estimates/i, /earnings surprise/i,
    ],
  },
  {
    category: 'price-prediction',
    patterns: [
      /price (prediction|target|forecast)/i,
      /will (hit|reach|top|climb to) \$/i,
      /\$\d{2,4}( |,| on| by)/i,
      /analyst (price )?target/i,
      /target (raised|cut|lifted|trimmed)/i,
      /upside of/i,
    ],
  },
  {
    category: 'rating-change',
    patterns: [
      /\bupgrade[sd]?\b/i, /\bdowngrade[sd]?\b/i,
      /\brating\b/i, /\boutperform\b/i, /\bunderperform\b/i,
      /initiates? coverage/i, /pt (raised|cut)/i,
      /\bbuy (from|rating|initiated)/i, /\bsell (from|rating)/i,
    ],
  },
  {
    category: 'corporate-action',
    patterns: [
      /merger/i, /acquisition/i, /\bacquires?\b/i, /takeover/i,
      /dividend/i, /buyback/i, /stock split/i, /\bipo\b/i,
      /spin-?off/i, /delisting/i, /share (issuance|repurchase)/i,
    ],
  },
  {
    category: 'fed',
    patterns: [
      /\bfed\b/i, /federal reserve/i, /fomc/i, /powell/i,
      /interest rate/i, /rate (cut|hike|decision)/i,
      /monetary policy/i, /inflation/i, /cpi/i, /ppi/i,
      /treasury/i, /bond/i, /\byield\b/i,
    ],
  },
  {
    category: 'geopolitical',
    patterns: [
      /tariff/i, /trade war/i, /sanction/i, /embargo/i,
      /war/i, /conflict/i, /election/i, /congress/i,
      /white house/i, /regulation/i, /sec/i, /cfpb/i,
    ],
  },
  {
    category: 'executive',
    patterns: [
      /\bceo\b/i, /\bcfo\b/i, /executive/i, /board/i,
      /musk/i, /\btesla\b/i, /\bspacex\b/i,
      /bezos/i, /buffett/i, /dimon/i, /cook\b/i,
      /huang\b/i, /\bnvidia\b/i, /altman/i,
    ],
  },
  {
    category: 'sector',
    patterns: [
      /sector/i, /rotation/i, /industry/i, /semiconductor/i,
      /tech (stock|sector)/i, /energy sector/i, /financial/i,
      /healthcare/i, /real estate/i, /consumer/i,
    ],
  },
  {
    category: 'product',
    patterns: [
      /launch/i, /announce/i, /unveil/i, /release/i,
      /new (chip|phone|model|product|feature)/i,
      /ai (chip|accelerator|model|training)/i,
      /gpu/i, /\bh200\b/i, /\bb200\b/i, /blackwell/i,
      /\bgame\b/i, /studio/i, /dlc/i,
    ],
  },
  {
    category: 'commentary',
    patterns: [
      /top \d+ stocks/i, /stocks to (buy|watch|avoid)/i,
      /opinion/i, /here'?s (what|why|how)/i,
      /stock market today/i, /market outlook/i, /recap/i,
      /preview: what to (watch|expect)/i,
    ],
  },
];

/** Key people — headline scanning fallback when no category rule matches. */
export const KEY_PEOPLE_PATTERNS: RegExp[] = [
  /elon musk/i, /donald trump/i, /jerome powell/i, /janet yellen/i,
  /warren buffett/i, /jeff bezos/i, /tim cook\b/i, /jensen huang/i,
  /sam altman/i, /jamie dimon/i, /cathie wood/i, /michael saylor/i,
  /gary gensler/i, /volodymyr zelenskyy/i, /xi jinping/i,
  /vladimir putin/i, /mark zuckerberg/i, /sundar pichai/i,
  /satya nadella/i, /brian armstrong/i,
];

/**
 * Default categories imported. Everything else (product, commentary,
 * general) is never stored — it would drown the corpus without being
 * directive-able. To import a category, add it here or per-deployment via
 * newsImport.categoryAllowlist in app settings.
 */
export const DEFAULT_NEWS_CATEGORY_ALLOWLIST = [
  'earnings',
  'price-prediction',
  'rating-change',
  'corporate-action',
  'fed',
  'geopolitical',
  'executive',
  'sector',
];

/** Macro categories are exempt from tracked-symbol requirements. */
export const MACRO_NEWS_CATEGORIES = new Set(['fed', 'geopolitical', 'sector']);

export function classifyNewsCategory(headline: string, summary: string): string {
  // Two-pass classification:
  //  Pass 1 — HEADLINE ONLY. The headline carries the signal; classifying
  //  combined text first lets summary filler words (e.g. "revenue share" in
  //  a gaming article) hijack a category.
  //  Pass 2 — headline + summary, only to disambiguate pass-1 misses.
  const text = `${headline} ${summary}`;
  const headlineCat = matchRules(headline || '');
  if (headlineCat !== 'general') return headlineCat;
  return matchRules(text);
}

function matchRules(text: string): string {
  for (const rule of NEWS_CATEGORY_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) return rule.category;
    }
  }
  for (const pattern of KEY_PEOPLE_PATTERNS) {
    if (pattern.test(text)) return 'executive';
  }
  return 'general';
}

/**
 * Impact assessment. IMPORTANT (2026-08-23): directive-able categories get a
 * MEDIUM floor — a "likely beat" or "$900 target" headline is the signal even
 * when sentiment is neutral, so low-sentiment prediction news must survive.
 * Do NOT let a blanket low-impact filter drop these.
 */
export function assessNewsImpact(
  headline: string,
  summary: string,
  sentiment: number,
  category = 'general',
): 'high' | 'medium' | 'low' {
  const text = `${headline} ${summary}`.toLowerCase();
  let impact: 'high' | 'medium' | 'low';

  if (/\b(crash|plunge|skyrocket|surge|collapse|breakthrough|crisis)\b/i.test(text)) {
    impact = 'high';
  } else if (Math.abs(sentiment) > 0.5) {
    impact = 'high';
  } else if (/\b(rally|drop|slide|jump|spike|warn|cut|hike)\b/i.test(text)) {
    impact = 'medium';
  } else if (Math.abs(sentiment) > 0.25) {
    impact = 'medium';
  } else {
    impact = 'low';
  }

  // Category floor — the claim itself is the signal.
  if (impact === 'low' && ['earnings', 'price-prediction', 'rating-change', 'corporate-action'].includes(category)) {
    impact = 'medium';
  }
  return impact;
}
