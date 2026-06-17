import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import './FluffDetectorPage.css';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ReliabilityBar({ score, max = 10 }) {
  const pct = (score / max) * 100;
  const color = score >= 7 ? '#22c55e' : score >= 5 ? '#f59e0b' : '#ef4444';
  return (
    <span className="fd-bar-wrap">
      <span className="fd-bar-fill" style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}

export default function FluffDetectorPage() {
  const [expandedSource, setExpandedSource] = useState(null);

  const summaryQuery = useQuery({
    queryKey: ['fluff-summary'],
    queryFn: () => fetch('/api/news/summary').then((r) => r.json()),
    staleTime: 120000,
  });

  const sourcesQuery = useQuery({
    queryKey: ['fluff-sources'],
    queryFn: () => fetch('/api/news/sources').then((r) => r.json()),
    staleTime: 120000,
  });

  const articlesQuery = useQuery({
    queryKey: ['fluff-articles'],
    queryFn: () => fetch('/api/news/collect', { method: 'POST' }).then((r) => r.json()),
    staleTime: 120000,
  });

  const summary = summaryQuery.data || {};
  const sources = sourcesQuery.data?.sources || [];
  const articles = articlesQuery.data?.articles || [];

  return (
    <div className="fd-page">
      <header className="fd-header">
        <h2>Fluff Detector</h2>
        <p>News source pattern analysis — track reliability, sentiment bias, and clickbait detection.</p>
      </header>

      <div className="fd-disclaimer">
        📊 Pattern analysis only. Sources may still produce valuable content. Fluff scores are automated estimates.
      </div>

      {/* Weekly Summary */}
      <section className="fd-section">
        <h3>This Week in Financial Media</h3>
        <div className="fd-summary-grid">
          <div className="fd-summary-card">
            <span className="fd-summary-num">{summary.totalArticles || '—'}</span>
            <span className="fd-summary-label">Articles Collected</span>
          </div>
          <div className="fd-summary-card">
            <span className="fd-summary-num">{summary.avgFluff || '—'}%</span>
            <span className="fd-summary-label">Avg Fluff Score</span>
          </div>
          <div className="fd-summary-card">
            <span className="fd-summary-num">{summary.highFluffCount || '—'}</span>
            <span className="fd-summary-label">High-Fluff Articles</span>
          </div>
          <div className="fd-summary-card reliable">
            <span className="fd-summary-num">{summary.mostReliableSource || '—'}</span>
            <span className="fd-summary-label">Most Reliable</span>
          </div>
          <div className="fd-summary-card fluffy">
            <span className="fd-summary-num">{summary.mostFluffySource || '—'}</span>
            <span className="fd-summary-label">Most Fluffy</span>
          </div>
        </div>
      </section>

      {/* Source Reliability Table */}
      <section className="fd-section">
        <h3>Source Reliability</h3>
        <div className="fd-table-wrap">
          <table className="fd-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Articles</th>
                <th>Reliability</th>
                <th>Fluff %</th>
                <th>Sentiment Bias</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const sourceArticles = articles.filter((a) => a.sourceName === s.name);
                const fluffPct = sourceArticles.length
                  ? Math.round((sourceArticles.filter((a) => (a.fluffScore || 0) > 60).length / sourceArticles.length) * 100)
                  : 0;
                const avgSentiment = sourceArticles.length
                  ? (sourceArticles.reduce((sum, a) => sum + (a.sentiment || 0), 0) / sourceArticles.length).toFixed(2)
                  : '—';
                const isExpanded = expandedSource === s.id;
                return (
                  <>
                    <tr key={s.id} className="fd-row" onClick={() => setExpandedSource(isExpanded ? null : s.id)}>
                      <td className="fd-source-name">{s.name}</td>
                      <td>{s.articleCount}</td>
                      <td>
                        <ReliabilityBar score={s.reliabilityScore} />
                        <span className="fd-score-text">{s.reliabilityScore}/10</span>
                      </td>
                      <td className={fluffPct > 40 ? 'fd-warn' : ''}>{fluffPct}%</td>
                      <td className={+avgSentiment > 0 ? 'fd-positive' : +avgSentiment < 0 ? 'fd-negative' : ''}>
                        {avgSentiment}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="fd-expand-row">
                        <td colSpan={5}>
                          <div className="fd-expand-content">
                            <strong>{s.name} — Recent Headlines</strong>
                            <ul>
                              {sourceArticles.slice(0, 5).map((a, i) => (
                                <li key={i} className={a.fluffScore > 60 ? 'fd-fluff-item' : ''}>
                                  {a.fluffScore > 60 && <span className="fd-fluff-tag">FLUFF</span>}
                                  {a.headline}
                                  <span className="fd-article-meta">
                                    Fluff: {a.fluffScore || 0} | Sentiment: {a.sentiment}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* All Articles with Fluff Scores */}
      <section className="fd-section">
        <h3>Article Feed</h3>
        <div className="fd-article-list">
          {articles.map((a, i) => (
            <div key={i} className={`fd-article ${a.fluffScore > 60 ? 'fd-fluff' : ''}`}>
              <div className="fd-article-header">
                <span className="fd-article-source">{a.sourceName}</span>
                <span className="fd-fluff-score" style={{ color: a.fluffScore > 60 ? '#ef4444' : a.fluffScore > 30 ? '#f59e0b' : '#22c55e' }}>
                  Fluff: {a.fluffScore || 0}
                </span>
              </div>
              <p className="fd-article-headline">{a.headline}</p>
              <div className="fd-article-footer">
                <span>Sentiment: {a.sentiment > 0 ? '+' : ''}{a.sentiment}</span>
                <span>{new Date(a.publishedAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
