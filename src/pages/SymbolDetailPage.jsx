import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './symbol-detail.css';

export default function SymbolDetailPage() {
  const { symbolId } = useParams();
  const [tradeModal, setTradeModal] = useState(null);

  const symbolQuery = useQuery({
    queryKey: ['symbol', symbolId],
    queryFn: () => apiGet(`/api/symbols/${symbolId}`),
    enabled: Boolean(symbolId),
  });

  const freshnessQuery = useQuery({
    queryKey: ['freshness', symbolId],
    queryFn: () => apiGet(`/api/market-data/freshness/${symbolId}`),
    enabled: Boolean(symbolId),
  });

  const scoringQuery = useQuery({
    queryKey: ['scoring-history', symbolId],
    queryFn: () => apiGet(`/api/scoring/history/${symbolId}`),
    enabled: Boolean(symbolId),
    retry: 1,
  });

  // Portfolio + Trade Data
  const portfolioQuery = useQuery({
    queryKey: ['portfolio-positions'],
    queryFn: () => apiGet('/api/portfolio?source=trading212'),
    retry: 1,
    staleTime: 30000,
  });

  const isaWarningQuery = useQuery({
    queryKey: ['isa-fx-warning', tradeModal?.ticker, tradeModal?.side, tradeModal?.account],
    queryFn: () => {
      const exchange = symbolQuery.data?.exchange ? `&exchange=${encodeURIComponent(symbolQuery.data.exchange)}` : '';
      return apiGet(`/api/isa/fx-warning?symbol=${encodeURIComponent(tradeModal.ticker)}&side=${tradeModal.side}${exchange}`);
    },
    enabled: Boolean(tradeModal?.account === 'T212 ISA' && tradeModal?.ticker && tradeModal?.side),
    retry: 1,
    staleTime: 30000,
  });

  // News for this symbol
  const newsQuery = useQuery({
    queryKey: ['symbol-news', symbolId],
    queryFn: () => fetch('/api/news/collect', { method: 'POST' }).then((r) => r.json()),
    staleTime: 120000,
  });

  const isLoading = symbolQuery.isLoading;

  if (symbolQuery.isLoading) return <div className="sd-page"><p>Loading symbol data...</p></div>;
  if (symbolQuery.isError) return <div className="sd-page"><p className="sd-error">Failed to load symbol. Is the backend running?</p></div>;

  const sym = symbolQuery.data ?? {};
  const ticker = sym.ticker || symbolId;
  const freshness = freshnessQuery.data ?? {};
  const scoring = scoringQuery.data ?? {};
  const history = Array.isArray(scoring.history) ? scoring.history : [];
  const breakdown = Array.isArray(scoring.breakdown) ? scoring.breakdown : [];
  const currentScore = scoring.totalScore ?? scoring.score ?? null;

  // Portfolio positions matching this symbol
  const portfolio = portfolioQuery.data || {};
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
  const heldPosition = positions.find(
    (p) => p.symbol === ticker || p.ticker === ticker || p.ticker?.startsWith(ticker + '_'),
  );

  // News articles mentioning or relevant to this symbol
  const allArticles = newsQuery.data?.articles || [];
  const symbolNews = allArticles.filter(
    (a) => a.headline?.toUpperCase().includes(ticker.toUpperCase()),
  ).slice(0, 5);

  const freshnessStatus = freshness.status || freshness.freshness || 'unknown';
  const freshnessTone = freshnessStatus === 'fresh' ? 'ok' : freshnessStatus === 'stale' ? 'warn' : 'neutral';

  return (
    <div className="sd-page">
      <Link to="/research/symbols-browser" className="sd-back">← Back to Symbols</Link>

      <header className="sd-header">
        <div>
          <h1>{sym.ticker || symbolId}</h1>
          <p>{sym.name || '—'}</p>
        </div>
        <div className="sd-badges">
          <span className={`sd-chip sd-chip--${freshnessTone}`}>{freshnessStatus}</span>
          <span className="sd-chip sd-chip--neutral">{sym.exchange || '—'}</span>
          <span className="sd-chip sd-chip--neutral">{sym.type || '—'}</span>
          <span className={`sd-chip ${sym.active ? 'sd-chip--ok' : 'sd-chip--warn'}`}>{sym.active ? 'Active' : 'Inactive'}</span>
        </div>
      </header>

      <div className="sd-grid">
        {/* Freshness Card */}
        <section className="sd-card">
          <h2>Freshness</h2>
          {freshnessQuery.isLoading ? <p>Loading...</p> : freshnessQuery.isError ? <p className="sd-error">Unavailable</p> : (
            <>
              <div className="sd-stat">{freshnessStatus}</div>
              <p className="sd-sub">Last bar: {freshness.lastBarTimestamp ? new Date(freshness.lastBarTimestamp).toLocaleString() : 'none'}</p>
              <p className="sd-sub">Stale after: {freshness.staleThresholdMinutes ?? '—'} min</p>
            </>
          )}
        </section>

        {/* Score Card */}
        <section className="sd-card">
          <h2>Current Score</h2>
          {scoringQuery.isLoading ? <p>Loading...</p> : scoringQuery.isError ? <p className="sd-error">Scoring unavailable</p> : currentScore != null ? (
            <>
              <div className="sd-stat">{currentScore.toFixed(1)}</div>
              <p className="sd-sub">Confidence: {((scoring.confidence ?? 0) * 100).toFixed(0)}%</p>
              <p className="sd-sub">Signal: <span className={`sd-chip sd-chip--${scoring.signal === 'entry' ? 'ok' : scoring.signal === 'watch' ? 'warn' : 'neutral'}`}>{scoring.signal || '—'}</span></p>
            </>
          ) : (
            <p className="sd-sub">No scoring data yet. Run scoring from the SEES page.</p>
          )}
        </section>

        {/* Recent Scores */}
        <section className="sd-card sd-card--wide">
          <h2>Recent Scores</h2>
          {history.length === 0 ? (
            <p className="sd-sub">No score history available.</p>
          ) : (
            <div className="sd-bars">
              {history.slice(-20).map((h, i) => (
                <div key={i} className="sd-bar-wrap" title={`${h.score?.toFixed(1) ?? '—'} at ${h.timestamp ? new Date(h.timestamp).toLocaleDateString() : '—'}`}>
                  <div className="sd-bar" style={{ height: `${Math.max(2, (h.score ?? 0))}%` }} />
                  <span className="sd-bar-label">{i + 1}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Directive Breakdown */}
      {breakdown.length > 0 && (
        <section className="sd-card">
          <h2>Directive Breakdown</h2>
          <table className="sd-table">
            <thead>
              <tr>
                <th>Directive</th>
                <th>Score</th>
                <th>Weight</th>
                <th>Contribution</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((d) => (
                <tr key={d.directiveId}>
                  <td>{d.name || d.directiveId}</td>
                  <td>{d.score?.toFixed(1) ?? '—'}</td>
                  <td>{d.weight ?? '—'}</td>
                  <td>{d.contribution?.toFixed(1) ?? '—'}</td>
                  <td className="sd-reason">{d.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Portfolio Position & Trade Actions ── */}
      <section className="sd-card sd-card--trade">
        <h2>💼 Portfolio & Trade</h2>

        {/* Held position */}
        {heldPosition ? (
          <div className="sd-position">
            <div className="sd-pos-header">
              <span className="sd-pos-label">You hold</span>
              <span className="sd-pos-shares">{heldPosition.shares || heldPosition.quantity || '—'} shares</span>
            </div>
            <div className="sd-pos-details">
              <div><span>Avg Cost</span><strong>£{heldPosition.avgCost?.toFixed(2) || heldPosition.averagePrice?.toFixed(2) || '—'}</strong></div>
              <div><span>Current</span><strong>£{heldPosition.currentPrice?.toFixed(2) || '—'}</strong></div>
              <div><span>P&L</span><strong className={heldPosition.pnl > 0 ? 'sd-positive' : 'sd-negative'}>
                {heldPosition.pnl > 0 ? '+' : ''}£{heldPosition.pnl?.toFixed(2) || '—'}
                {heldPosition.pnlPct != null && ` (${heldPosition.pnlPct > 0 ? '+' : ''}${heldPosition.pnlPct.toFixed(1)}%)`}
              </strong></div>
              <div><span>Allocation</span><strong>{heldPosition.allocation ? `${(heldPosition.allocation * 100).toFixed(1)}%` : '—'}</strong></div>
            </div>
          </div>
        ) : (
          <p className="sd-sub">You don't hold this symbol in any connected account.</p>
        )}

        {/* Trade buttons per account */}
        <div className="sd-trade-accounts">
          <h3>Trade Actions</h3>
          <div className="sd-account-actions">
            <div className="sd-account-group">
              <span className="sd-account-label">T212 Investment</span>
              <div className="sd-trade-btns">
                <button className="sd-btn sd-btn-buy" onClick={() => setTradeModal({ account: 'T212 Investment', side: 'buy', ticker })}>
                  Buy
                </button>
                <button className="sd-btn sd-btn-sell" disabled={!heldPosition} onClick={() => setTradeModal({ account: 'T212 Investment', side: 'sell', ticker })}>
                  Sell
                </button>
              </div>
            </div>
            <div className="sd-account-group">
              <span className="sd-account-label">T212 ISA</span>
              <div className="sd-trade-btns">
                <button className="sd-btn sd-btn-buy" onClick={() => setTradeModal({ account: 'T212 ISA', side: 'buy', ticker })}>
                  Buy
                </button>
                <button className="sd-btn sd-btn-sell" disabled={!heldPosition} onClick={() => setTradeModal({ account: 'T212 ISA', side: 'sell', ticker })}>
                  Sell
                </button>
              </div>
            </div>
            <div className="sd-account-group">
              <span className="sd-account-label">MT5</span>
              <div className="sd-trade-btns">
                <button className="sd-btn sd-btn-buy" onClick={() => setTradeModal({ account: 'MT5', side: 'buy', ticker })}>
                  Buy
                </button>
                <button className="sd-btn sd-btn-sell" disabled={!heldPosition} onClick={() => setTradeModal({ account: 'MT5', side: 'sell', ticker })}>
                  Sell
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trade Modal */}
      {tradeModal && (
        <div className="sd-modal-overlay" onClick={() => setTradeModal(null)}>
          <div className="sd-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{tradeModal.side.toUpperCase()} {tradeModal.ticker}</h3>
            <p>Account: <strong>{tradeModal.account}</strong></p>
            {tradeModal.account === 'T212 ISA' && (
              <div className="sd-isa-warning">
                {isaWarningQuery.isLoading ? (
                  <p>Checking ISA FX timing...</p>
                ) : isaWarningQuery.data ? (
                  <>
                    <strong>{isaWarningQuery.data.title}</strong>
                    <p>{isaWarningQuery.data.message}</p>
                    <span>{isaWarningQuery.data.blocking ? 'Blocks trade' : 'Advisory only'}</span>
                  </>
                ) : (
                  <p>ISA FX warning check is unavailable.</p>
                )}
              </div>
            )}
            <p className="sd-modal-warning">⚠️ Order execution is not yet live. This will be enabled in Q284 (First Live Trade).</p>
            <div className="sd-modal-actions">
              <button className="sd-btn" onClick={() => setTradeModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Recent News ── */}
      <section className="sd-card">
        <h2>📰 Recent News</h2>
        {newsQuery.isLoading ? <p>Loading news...</p> : symbolNews.length === 0 ? (
          <p className="sd-sub">No recent news articles found for {ticker}.</p>
        ) : (
          <div className="sd-news-list">
            {symbolNews.map((a, i) => (
              <div key={i} className={`sd-news-item ${a.fluffScore > 60 ? 'sd-news-fluff' : ''}`}>
                <div className="sd-news-header">
                  <span className="sd-news-source">{a.sourceName}</span>
                  <span className="sd-news-sentiment" style={{ color: a.sentiment > 0 ? '#22c55e' : a.sentiment < 0 ? '#ef4444' : '#94a3b8' }}>
                    {a.sentiment > 0 ? '↗' : a.sentiment < 0 ? '↘' : '→'} {a.sentiment > 0 ? '+' : ''}{a.sentiment}
                  </span>
                </div>
                <p className="sd-news-headline">{a.headline}</p>
                {a.fluffScore > 60 && <span className="sd-fluff-tag">⚠️ Low reliability source</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
