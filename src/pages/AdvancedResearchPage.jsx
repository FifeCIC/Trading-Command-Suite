import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiPost, apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './advanced-research.css';

const AREAS = [
  { id: 'overview', name: 'Investigation Overview', desc: 'Price, conviction score, analyst consensus, earnings proximity', icon: '🔍' },
  { id: 'sentiment', name: 'Sentiment Analysis', desc: 'News sentiment, social media buzz, article breakdown', icon: '💬' },
  { id: 'analysts', name: 'Analyst Targets', desc: 'High, low, mean, consensus from Finnhub', icon: '🎯' },
  { id: 'articles', name: 'News Articles', desc: 'Recent articles with sentiment tagging', icon: '📰' },
  { id: 'fundamental', name: 'Fundamentals', desc: 'Earnings proximity, price targets, conviction model', icon: '📋' },
  { id: 'technical', name: 'Technical Indicators', desc: 'RSI, MACD, moving averages from live data', icon: '📈' },
];

export default function AdvancedResearchPage() {
  const [symbol, setSymbol] = useState('');
  const [selected, setSelected] = useState(null);
  const [lastSymbol, setLastSymbol] = useState(null);

  const investigateMutation = useMutation({
    mutationFn: (sym) => apiPost('/api/research/investigations', { symbol: sym, trigger: 'manual' }),
    onSuccess: () => setLastSymbol(symbol.toUpperCase()),
  });

  const indicatorsQuery = useQuery({
    queryKey: ['indicators', lastSymbol],
    queryFn: () => apiGet(`/api/indicators/${lastSymbol}?tf=1d`),
    enabled: !!lastSymbol,
    staleTime: 30000,
  });

  const analystQuery = useQuery({
    queryKey: ['analyst', lastSymbol],
    queryFn: () => apiGet(`/api/research/analyst/targets/${lastSymbol}`),
    enabled: !!lastSymbol,
    staleTime: 60000,
  });

  const handleRun = useCallback((symOverride) => {
    const sym = (symOverride || symbol).trim().toUpperCase();
    if (!sym) return;
    setSymbol(sym);
    investigateMutation.mutate(sym);
  }, [symbol, investigateMutation]);

  const inv = investigateMutation.data;
  const findings = inv?.keyFindings || {};
  const ind = indicatorsQuery.data || {};
  const at = analystQuery.data || {};

  const convictionColor = findings.convictionScore > 70 ? '#22c55e' : findings.convictionScore > 40 ? '#f59e0b' : '#ef4444';

  return (
    <div className="ar-page">
      <motion.header className="ar-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Advanced Research Engine</h1>
          <p className="ar-subtitle">Deep-dive analysis — real-time Finnhub data: quote, news sentiment, analyst targets, social buzz.</p>
        </div>
      </motion.header>

      {/* ── Symbol Input ── */}
      <motion.div className="ar-controls" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
        <input
          type="text"
          className="ar-symbol-input"
          placeholder="Enter symbol (e.g. AAPL, NVDA)..."
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && handleRun()}
        />
        <button className="ar-run-btn" onClick={() => handleRun()} disabled={investigateMutation.isPending || !symbol.trim()}>
          {investigateMutation.isPending ? '⏳ Investigating...' : '▶ Investigate'}
        </button>
      </motion.div>

      {investigateMutation.isError && <ApiOfflineBanner />}

      {/* ── Research Area Cards ── */}
      <motion.div className="ar-grid" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
        {AREAS.map((area, i) => (
          <motion.div
            key={area.id}
            className={`ar-card ${selected === area.id ? 'ar-selected' : ''} ${!lastSymbol ? 'ar-disabled' : ''}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + i * 0.04 }}
            onClick={() => lastSymbol && setSelected(selected === area.id ? null : area.id)}
          >
            <span className="ar-card-icon">{area.icon}</span>
            <h3>{area.name}</h3>
            <p>{area.desc}</p>
          </motion.div>
        ))}
      </motion.div>

      {/* ── Detail Panels ── */}
      <AnimatePresence>
        {selected && lastSymbol && (
          <motion.div
            className="ar-detail"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            key={selected}
          >
            {investigateMutation.isPending && <LoadingSkeleton variant="card" count={1} />}

            {/* Overview */}
            {selected === 'overview' && findings.convictionScore != null && (
              <div className="ar-panel">
                <h2>{lastSymbol} — Investigation Overview</h2>
                <div className="ar-overview-grid">
                  <div className="ar-ov-card">
                    <span className="ar-ov-label">Price</span>
                    <span className="ar-ov-val">${findings.price?.toFixed(2) || '—'}</span>
                  </div>
                  <div className="ar-ov-card">
                    <span className="ar-ov-label">Conviction</span>
                    <span className="ar-ov-val" style={{ color: convictionColor }}>{findings.convictionScore}/100</span>
                    <span className="ar-ov-sub" style={{ color: convictionColor }}>{findings.convictionLabel}</span>
                  </div>
                  <div className="ar-ov-card">
                    <span className="ar-ov-label">Analyst Consensus</span>
                    <span className="ar-ov-val">{findings.analystTarget?.consensus || '—'}</span>
                  </div>
                  <div className="ar-ov-card">
                    <span className="ar-ov-label">Earnings</span>
                    <span className="ar-ov-val">{findings.earningsProximity?.nextDate || '—'}</span>
                    {findings.earningsProximity?.daysUntil != null && (
                      <span className="ar-ov-sub">{findings.earningsProximity.daysUntil} days away</span>
                    )}
                  </div>
                </div>
                {inv?.summary && (
                  <div className="ar-summary">
                    <h4>AI Summary</h4>
                    <p>{inv.summary}</p>
                  </div>
                )}
                {inv?.actionItems?.length > 0 && (
                  <div className="ar-actions">
                    <h4>Action Items</h4>
                    {inv.actionItems.map((a, i) => (
                      <div key={i} className="ar-action-row">{a.priority === 'high' ? '🔴' : a.priority === 'medium' ? '🟡' : '🟢'} {a.text}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Sentiment */}
            {selected === 'sentiment' && (
              <div className="ar-panel">
                <h2>{lastSymbol} — Sentiment Analysis</h2>
                <div className="ar-sentiment-grid">
                  <div className="ar-sent-card">
                    <span className="ar-sent-label">News Bullish</span>
                    <span className="ar-sent-val" style={{ color: '#22c55e' }}>{findings.newsSentiment?.bullish ?? '—'}</span>
                  </div>
                  <div className="ar-sent-card">
                    <span className="ar-sent-label">News Bearish</span>
                    <span className="ar-sent-val" style={{ color: '#ef4444' }}>{findings.newsSentiment?.bearish ?? '—'}</span>
                  </div>
                  <div className="ar-sent-card">
                    <span className="ar-sent-label">Buzz Score</span>
                    <span className="ar-sent-val">{findings.newsSentiment?.buzz ?? '—'}</span>
                  </div>
                  <div className="ar-sent-card">
                    <span className="ar-sent-label">Reddit Sentiment</span>
                    <span className="ar-sent-val" style={{ color: findings.socialSentiment?.reddit > 0 ? '#22c55e' : '#ef4444' }}>
                      {findings.socialSentiment?.reddit?.toFixed(1) ?? '—'}
                    </span>
                  </div>
                  <div className="ar-sent-card">
                    <span className="ar-sent-label">Twitter Sentiment</span>
                    <span className="ar-sent-val" style={{ color: findings.socialSentiment?.twitter > 0 ? '#22c55e' : '#ef4444' }}>
                      {findings.socialSentiment?.twitter?.toFixed(1) ?? '—'}
                    </span>
                  </div>
                  <div className="ar-sent-card">
                    <span className="ar-sent-label">Articles Analyzed</span>
                    <span className="ar-sent-val">{findings.articles?.length || 0}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Analyst Targets */}
            {selected === 'analysts' && (
              <div className="ar-panel">
                <h2>{lastSymbol} — Analyst Targets</h2>
                <div className="ar-analyst-grid">
                  <div className="ar-analyst-card">
                    <span className="ar-analyst-label">High</span>
                    <span className="ar-analyst-val" style={{ color: '#22c55e' }}>${findings.analystTarget?.high?.toFixed(2) || at.high || '—'}</span>
                  </div>
                  <div className="ar-analyst-card">
                    <span className="ar-analyst-label">Mean</span>
                    <span className="ar-analyst-val">${findings.analystTarget?.mean?.toFixed(2) || at.mean || '—'}</span>
                  </div>
                  <div className="ar-analyst-card">
                    <span className="ar-analyst-label">Low</span>
                    <span className="ar-analyst-val" style={{ color: '#ef4444' }}>${findings.analystTarget?.low?.toFixed(2) || at.low || '—'}</span>
                  </div>
                  <div className="ar-analyst-card">
                    <span className="ar-analyst-label">Consensus</span>
                    <span className="ar-analyst-val">{findings.analystTarget?.consensus || at.consensus || '—'}</span>
                  </div>
                </div>
                {findings.price && findings.analystTarget?.mean && (
                  <div className="ar-upside">
                    Upside to mean target: <strong style={{ color: findings.analystTarget.mean > findings.price ? '#22c55e' : '#ef4444' }}>
                      {(((findings.analystTarget.mean - findings.price) / findings.price) * 100).toFixed(1)}%
                    </strong>
                  </div>
                )}
              </div>
            )}

            {/* News Articles */}
            {selected === 'articles' && (
              <div className="ar-panel">
                <h2>{lastSymbol} — News Articles ({findings.articles?.length || 0})</h2>
                <div className="ar-article-list">
                  {(findings.articles || []).map((a, i) => (
                    <div key={i} className={`ar-article-row ar-art-${a.sentiment > 0.1 ? 'pos' : a.sentiment < -0.1 ? 'neg' : 'neut'}`}>
                      <span className="ar-art-sent">{a.sentiment > 0.1 ? '🟢' : a.sentiment < -0.1 ? '🔴' : '⚪'}</span>
                      <span className="ar-art-headline">{a.headline}</span>
                      <span className="ar-art-source">{a.source}</span>
                      <span className="ar-art-age">{a.age}</span>
                    </div>
                  ))}
                  {(!findings.articles || findings.articles.length === 0) && (
                    <p className="ar-empty">No articles found for {lastSymbol}.</p>
                  )}
                </div>
              </div>
            )}

            {/* Fundamentals */}
            {selected === 'fundamental' && (
              <div className="ar-panel">
                <h2>{lastSymbol} — Fundamentals</h2>
                <div className="ar-fund-grid">
                  <div className="ar-fund-card">
                    <span className="ar-fund-label">Price</span>
                    <span className="ar-fund-val">${findings.price?.toFixed(2) || '—'}</span>
                  </div>
                  <div className="ar-fund-card">
                    <span className="ar-fund-label">Analyst Mean Target</span>
                    <span className="ar-fund-val">${findings.analystTarget?.mean?.toFixed(2) || at.mean || '—'}</span>
                  </div>
                  <div className="ar-fund-card">
                    <span className="ar-fund-label">Next Earnings</span>
                    <span className="ar-fund-val">{findings.earningsProximity?.nextDate || '—'}</span>
                    <span className="ar-fund-sub">{findings.earningsProximity?.daysUntil != null ? `${findings.earningsProximity.daysUntil} days` : ''}</span>
                  </div>
                  <div className="ar-fund-card">
                    <span className="ar-fund-label">Conviction Model</span>
                    <span className="ar-fund-val" style={{ color: convictionColor }}>{findings.convictionLabel}</span>
                    <span className="ar-fund-sub">
                      News(30) + Analyst(25) + Social(20) + Volume(15) + Momentum(10) = {findings.convictionScore}/100
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Technical */}
            {selected === 'technical' && (
              <div className="ar-panel">
                <h2>{lastSymbol} — Technical Indicators</h2>
                {indicatorsQuery.isLoading ? <LoadingSkeleton variant="card" count={1} /> : (
                  <div className="ar-tech-grid">
                    <div className="ar-tech-card">
                      <span className="ar-tech-label">RSI (14)</span>
                      <span className="ar-tech-val" style={{ color: (ind.rsi || 50) > 70 ? '#ef4444' : (ind.rsi || 50) < 30 ? '#22c55e' : 'var(--ink)' }}>
                        {ind.rsi?.toFixed(1) || '—'}
                      </span>
                      <span className="ar-tech-sub">{(ind.rsi || 50) > 70 ? 'Overbought' : (ind.rsi || 50) < 30 ? 'Oversold' : 'Neutral'}</span>
                    </div>
                    <div className="ar-tech-card">
                      <span className="ar-tech-label">MACD</span>
                      <span className="ar-tech-val">{ind.macd?.macd?.toFixed(3) || '—'}</span>
                      <span className="ar-tech-sub">Signal: {ind.macd?.signal?.toFixed(3) || '—'}</span>
                    </div>
                    <div className="ar-tech-card">
                      <span className="ar-tech-label">SMA 20</span>
                      <span className="ar-tech-val">{ind.sma20?.toFixed(2) || '—'}</span>
                    </div>
                    <div className="ar-tech-card">
                      <span className="ar-tech-label">SMA 50</span>
                      <span className="ar-tech-val">{ind.sma50?.toFixed(2) || '—'}</span>
                    </div>
                    <div className="ar-tech-card">
                      <span className="ar-tech-label">SMA 200</span>
                      <span className="ar-tech-val">{ind.sma200?.toFixed(2) || '—'}</span>
                    </div>
                    <div className="ar-tech-card">
                      <span className="ar-tech-label">Bollinger Bands</span>
                      <span className="ar-tech-val">{ind.bollinger?.upper?.toFixed(2) || '—'} / {ind.bollinger?.lower?.toFixed(2) || '—'}</span>
                      <span className="ar-tech-sub">Middle: {ind.bollinger?.middle?.toFixed(2) || '—'}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty State */}
      {!lastSymbol && !investigateMutation.isPending && (
        <EmptyState
          icon="🔬"
          title="Enter a symbol to investigate"
          description="Deep-dive analysis pulls live data from Finnhub: quotes, news sentiment, analyst targets, social buzz, and earnings proximity — all scored into a conviction model."
        />
      )}
    </div>
  );
}
