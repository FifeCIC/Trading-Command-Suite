import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './news-intel.css';

const DEFAULT_CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'earnings', label: 'Earnings' },
  { value: 'fed', label: 'Fed/Macro' },
  { value: 'executive', label: 'Key People' },
  { value: 'product', label: 'Products' },
  { value: 'geopolitical', label: 'Geopolitical' },
  { value: 'sector', label: 'Sectors' },
  { value: 'general', label: 'General' },
];

export default function NewsIntelPage() {
  const [symbolFilter, setSymbolFilter] = useState('all');
  const [sentimentFilter, setSentimentFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [importing, setImporting] = useState(false);
  const qc = useQueryClient();

  // ── Feed ──

  const { data: feedData, isLoading, isError, refetch } = useQuery({
    queryKey: ['news', 'feed', symbolFilter, sentimentFilter, sourceFilter, categoryFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (symbolFilter !== 'all') params.set('symbol', symbolFilter);
      if (sentimentFilter !== 'all') params.set('sentiment', sentimentFilter);
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      params.set('limit', '100');
      return apiGet(`/api/news/feed?${params.toString()}`);
    },
    refetchInterval: 120_000,
  });

  const articles = feedData?.articles || [];
  const isLive = feedData?.live === true;
  const dataSource = feedData?.source || 'none';

  // ── Categories ──

  const { data: catData } = useQuery({
    queryKey: ['news', 'categories'],
    queryFn: () => apiGet('/api/news/categories'),
    refetchInterval: 300_000,
  });

  const categories = useMemo(() => {
    const dynamic = (catData?.categories || []).map((c) => ({
      value: c.category,
      label: `${c.category} (${c.count})`,
    }));
    return [...DEFAULT_CATEGORIES.map((d) => {
      const dyn = dynamic.find((x) => x.value === d.value);
      return dyn || d;
    })];
  }, [catData]);

  // ── Sentiment Summary ──

  const { data: sentData } = useQuery({
    queryKey: ['news', 'sentiment-summary', symbolFilter !== 'all' ? symbolFilter : ''],
    queryFn: () => {
      const params = new URLSearchParams();
      if (symbolFilter !== 'all') params.set('symbol', symbolFilter);
      return apiGet(`/api/news/sentiment-summary?${params.toString()}`);
    },
    refetchInterval: 120_000,
  });

  const sCounts = sentData || { positive: 0, negative: 0, neutral: 0, total: 0 };

  // ── Last Import ──

  const { data: importData } = useQuery({
    queryKey: ['news', 'import', 'last'],
    queryFn: () => apiGet('/api/news/import/last'),
    refetchInterval: 60_000,
  });

  const lastRun = importData?.run;

  // ── Import Action ──

  const triggerImport = async () => {
    setImporting(true);
    try {
      await apiPost('/api/news/import/run');
      qc.invalidateQueries({ queryKey: ['news', 'import'] });
      qc.invalidateQueries({ queryKey: ['news', 'feed'] });
      qc.invalidateQueries({ queryKey: ['news', 'categories'] });
      qc.invalidateQueries({ queryKey: ['news', 'sentiment-summary'] });
    } finally {
      setImporting(false);
    }
  };

  // ── Derived ──

  const allSymbols = useMemo(
    () => ['all', ...new Set(articles.map((a) => a.symbol).filter(Boolean))].sort(),
    [articles],
  );

  const allSources = useMemo(
    () => ['all', ...new Set(articles.map((a) => a.source).filter(Boolean))].sort(),
    [articles],
  );

  // Header subtitle — reflects WHERE the articles came from so users can tell
  // stored data (db) from the live provider fallback (finnhub), and whether
  // the stored data is older than the usual 7-day window (`stale` flag).
  const subtitle = isLive
    ? `${feedData?.source === 'db' ? 'Stored' : 'Live'} feed (${dataSource}${feedData?.stale ? ' · older than 7 days' : ''}) — ${articles.length} articles`
    : isError
      ? 'API unreachable — is the backend running?'
      : feedData
        ? 'No stored articles — live provider unavailable'
        : 'Connecting...';

  // ── Render ──

  return (
    <div className="ni-page">
      <header className="ni-header">
        <div className="ni-header-top">
          <div>
            <h1>News Intel</h1>
            <p className="ni-subtitle">{subtitle}</p>
            {/* Sentiment counts live in the header (not a third control row) —
                they summarise the SAME stored corpus the feed displays. */}
            <div className="ni-summary">
              <span className="ni-summary-label">Feed Sentiment:</span>
              <span className="ni-summary-val ni-sent-pos">▲ {sCounts.positive} Positive</span>
              <span className="ni-summary-val ni-sent-neg">▼ {sCounts.negative} Negative</span>
              <span className="ni-summary-val ni-sent-neu">● {sCounts.neutral} Neutral</span>
              <span className="ni-summary-total">{sCounts.total || articles.length} articles</span>
            </div>
          </div>
          <div className="ni-import-section">
            {lastRun && (
              <span className="ni-last-import" title={`${lastRun.fetched} fetched, ${lastRun.newArticles} new, ${lastRun.duplicates} dupes`}>
                Last import: {new Date(lastRun.startedAt).toLocaleString()} — {lastRun.newArticles} new
              </span>
            )}
            <button
              className="ni-import-btn"
              onClick={triggerImport}
              disabled={importing}
            >
              {importing ? '⏳ Importing...' : '📥 Import Now'}
            </button>
          </div>
        </div>
      </header>

      {isLoading && <LoadingSkeleton variant="card" count={3} />}

      {!isLoading && (
      <>
      {/* ── Category Tabs ── */}
      <div className="ni-category-tabs">
        {categories.map((cat) => (
          <button
            key={cat.value}
            type="button"
            className={`ni-cat-tab ${categoryFilter === cat.value ? 'ni-cat-active' : ''}`}
            onClick={() => setCategoryFilter(cat.value)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="ni-filters">
        <div className="ni-field">
          <label>Symbol</label>
          <select value={symbolFilter} onChange={(e) => setSymbolFilter(e.target.value)}>
            {allSymbols.map((s) => <option key={s} value={s}>{s === 'all' ? 'All Symbols' : s}</option>)}
          </select>
        </div>
        <div className="ni-field">
          <label>Sentiment</label>
          <div className="ni-chip-tabs">
            {['all', 'positive', 'negative', 'neutral'].map((s) => (
              <button
                key={s}
                type="button"
                className={`ni-chip ${sentimentFilter === s ? 'ni-chip-active' : ''}`}
                onClick={() => setSentimentFilter(s)}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="ni-field">
          <label>Source</label>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            {allSources.map((s) => <option key={s} value={s}>{s === 'all' ? 'All Sources' : s}</option>)}
          </select>
        </div>
      </div>

      {/* ── Error / still-connecting banner ──
          Any settled-without-data state gets an actionable banner instead of
          a misleading "no articles" message: real API failures (502), the
          retry-backoff window, and the rare paused query state. */}
      {!isLoading && !feedData && (
        <div className="ni-error-banner">
          {isError
            ? "Couldn't reach the news API — check the backend is running."
            : 'Still connecting to the news API…'}{' '}
          <button type="button" onClick={() => refetch()}>↻ Retry</button>
        </div>
      )}

      {/* ── Empty State (only when the query SETTLED with zero results) ── */}
      {!isLoading && feedData && articles.length === 0 && (
        <div className="ni-empty">
          <p>
            {feedData?.live === false
              ? 'No stored articles and the live provider is unavailable.'
              : 'No articles found. Try importing news or adjusting filters.'}
          </p>
          <button className="ni-import-btn" onClick={triggerImport} disabled={importing}>
            {importing ? '⏳ Importing...' : '📥 Import Now'}
          </button>
        </div>
      )}

      {/* ── Feed ── */}
      <div className="ni-feed">
        {articles.map((article) => {
          const isExpanded = expandedId === article.id;
          const sentCls = `ni-sent-${article.sentiment}`;
          const impactCls = `ni-impact-${article.impact}`;
          return (
            <article
              key={article.id}
              className={`ni-article ${isExpanded ? 'ni-expanded' : ''}`}
              onClick={() => setExpandedId(isExpanded ? null : article.id)}
            >
              <div className="ni-article-header">
                <div className="ni-article-meta">
                  <span className={`ni-sentiment-dot ${sentCls}`} />
                  <span className="ni-source">{article.source}</span>
                  {article.sourceReliability && (
                    <span className="ni-reliability" title={`Reliability: ${article.sourceReliability}/10`}>
                      {article.sourceReliability.toFixed(1)}
                    </span>
                  )}
                  <span className="ni-time">
                    {article.time ? new Date(article.time).toLocaleString() : ''}
                  </span>
                  <span className={`ni-impact-badge ${impactCls}`}>{article.impact}</span>
                  {article.category && article.category !== 'general' && (
                    <span className="ni-cat-badge">{article.category}</span>
                  )}
                </div>
                <div className="ni-symbol-tags">
                  {article.symbol && (
                    <span className={`ni-sym-tag ${symbolFilter === article.symbol ? 'ni-sym-active' : ''}`}>
                      {article.symbol}
                    </span>
                  )}
                </div>
              </div>
              <h3 className="ni-headline">{article.title}</h3>
              {isExpanded && (
                <div className="ni-expanded-body" onClick={(e) => e.stopPropagation()}>
                  <p className="ni-snippet">{article.snippet}</p>
                  <div className="ni-expanded-meta">
                    <span>Sentiment: <strong className={sentCls}>{article.sentiment?.toUpperCase?.() || 'NEUTRAL'}</strong></span>
                    <span>Impact: <strong className={impactCls}>{article.impact?.toUpperCase?.() || 'MEDIUM'}</strong></span>
                    <span>Category: <strong>{article.category || 'general'}</strong></span>
                    {article.url && article.url !== '#' && (
                      <span><a href={article.url} target="_blank" rel="noopener noreferrer">Open source ↗</a></span>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}
