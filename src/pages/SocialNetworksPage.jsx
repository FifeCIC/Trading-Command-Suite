import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './social-networks.css';

export default function SocialNetworksPage() {
  const [filter, setFilter] = useState('all');

  const trackedQuery = useQuery({
    queryKey: ['news', 'tracked-symbols'],
    queryFn: () => apiGet('/api/news/tracked-symbols'),
    refetchInterval: 300000,
  });

  const feedQuery = useQuery({
    queryKey: ['news', 'feed'],
    queryFn: () => apiGet('/api/news/feed?limit=200'),
    refetchInterval: 60000,
  });

  const apiOnline = !trackedQuery.isError && !feedQuery.isError;
  const symbols = trackedQuery.data?.symbols ?? [];
  const articles = feedQuery.data?.articles ?? [];

  // Aggregate sentiment by symbol from articles
  const sentimentBySymbol = useMemo(() => {
    const map = new Map();
    for (const a of articles) {
      if (!a.symbol) continue;
      const sym = a.symbol.toUpperCase();
      if (!map.has(sym)) {
        map.set(sym, { symbol: sym, count: 0, positive: 0, negative: 0, neutral: 0, articles: [] });
      }
      const entry = map.get(sym);
      entry.count++;
      entry.articles.push(a);
      const s = a.sentiment || 'neutral';
      if (s === 'positive') entry.positive++;
      else if (s === 'negative') entry.negative++;
      else entry.neutral++;
    }
    // Compute aggregate score (-100 to +100)
    const results = [];
    for (const [sym, data] of map) {
      const total = data.positive + data.negative + data.neutral || 1;
      const score = Math.round(((data.positive - data.negative) / total) * 100);
      results.push({
        symbol: sym,
        sentiment: score,
        mentions: data.count,
        articles: data.articles.slice(0, 5),
        source: data.articles[0]?.source || 'Finnhub',
        change: 0,
      });
    }
    results.sort((a, b) => Math.abs(b.sentiment) - Math.abs(a.sentiment));
    return results;
  }, [articles]);

  const filtered = useMemo(() => {
    if (filter === 'all') return sentimentBySymbol;
    return sentimentBySymbol.filter((d) =>
      filter === 'bullish' ? d.sentiment > 0 : d.sentiment < 0
    );
  }, [sentimentBySymbol, filter]);

  const isLoading = trackedQuery.isLoading || feedQuery.isLoading;
  const isEmpty = !isLoading && sentimentBySymbol.length === 0;

  return (
    <div className="sn-page">
      <motion.header className="sn-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>📱 Social Networks</h1>
          <p className="sn-subtitle">
            News sentiment aggregation from Finnhub.{' '}
            {articles.length > 0
              ? `${articles.length} articles across ${sentimentBySymbol.length} symbols`
              : 'Configure Finnhub API key for live social sentiment data.'}
          </p>
        </div>
      </motion.header>

      {!apiOnline && <ApiOfflineBanner />}

      <div className="sn-filters">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          All ({sentimentBySymbol.length})
        </button>
        <button className={filter === 'bullish' ? 'active' : ''} onClick={() => setFilter('bullish')}>
          🟢 Bullish
        </button>
        <button className={filter === 'bearish' ? 'active' : ''} onClick={() => setFilter('bearish')}>
          🔴 Bearish
        </button>
      </div>

      {isLoading && <LoadingSkeleton variant="cards" count={6} />}

      {isEmpty && (
        <div className="sn-empty">
          <p>No sentiment data available.</p>
          <p className="sn-empty-hint">
            Set <code>FINNHUB_API_KEY</code> in <code>nest/.env</code> to enable real-time social sentiment from Finnhub.
            Data will then populate automatically.
          </p>
        </div>
      )}

      <div className="sn-grid">
        <AnimatePresence mode="popLayout">
          {filtered.map((d, i) => (
            <motion.div
              key={d.symbol}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ delay: i * 0.03 }}
              className={`sn-card ${d.sentiment > 0 ? 'bullish' : d.sentiment < 0 ? 'bearish' : 'neutral'}`}
            >
              <div className="sn-card-header">
                <strong>{d.symbol}</strong>
                <span className="sn-source">{d.source}</span>
              </div>
              <div className="sn-score-wrap">
                <motion.span
                  className="sn-score"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', delay: 0.2 }}
                  style={{ color: d.sentiment > 0 ? '#22c55e' : d.sentiment < 0 ? '#ef4444' : '#94a3b8' }}
                >
                  {d.sentiment > 0 ? '+' : ''}{d.sentiment}
                </motion.span>
              </div>
              <div className="sn-card-footer">
                <span>{d.mentions} articles</span>
                {d.articles.length > 0 && (
                  <span className="sn-latest" title={d.articles[0]?.headline}>
                    {d.articles[0]?.headline?.slice(0, 40)}...
                  </span>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
