/**
 * Symbol Page — ticker-based single-symbol focused view.
 * Route: /trading/symbol/:ticker
 *
 * Pulls together everything known about a symbol in one place:
 * price, scoring envelope, directive drilldown, protocol cross-scores,
 * earnings events, recent news, risk assessment.
 */

import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import StarToggle from '../components/StarToggle';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './symbol-page.css';

const SIGNAL_COLORS = { BUY: '#22c55e', SELL: '#ef4444', HOLD: '#94a3b8' };

export default function SymbolPage() {
  const { ticker } = useParams();
  const symbol = (ticker || '').toUpperCase();

  // ── Data queries (all ticker-based, fetched in parallel) ──
  const envelopeQuery = useQuery({
    queryKey: ['symbol-envelope', symbol],
    queryFn: () => apiGet(`/api/signals/envelope/${symbol}`),
    enabled: !!symbol,
    staleTime: 30_000,
    retry: 1,
  });

  const overviewQuery = useQuery({
    queryKey: ['symbol-overview-ticker', symbol],
    queryFn: () => apiGet(`/api/symbols/${symbol}/overview`),
    enabled: !!symbol,
    staleTime: 30_000,
    retry: 1,
  });

  const protocolsQuery = useQuery({
    queryKey: ['symbol-protocols-ticker', symbol],
    queryFn: () => apiGet(`/api/symbols/${symbol}/protocols`),
    enabled: !!symbol,
    staleTime: 60_000,
    retry: 1,
  });

  const earningsQuery = useQuery({
    queryKey: ['symbol-earnings', symbol],
    queryFn: () => apiGet(`/api/earnings/symbol/${symbol}`),
    enabled: !!symbol,
    staleTime: 120_000,
    retry: 1,
  });

  const newsQuery = useQuery({
    queryKey: ['symbol-news-feed', symbol],
    queryFn: () => apiGet(`/api/news/feed?symbol=${symbol}&limit=5`),
    enabled: !!symbol,
    staleTime: 120_000,
    retry: 1,
  });

  const env = envelopeQuery.data;
  const overview = overviewQuery.data;
  const protocols = protocolsQuery.data?.protocols || [];
  const earnings = earningsQuery.data;
  const newsArticles = newsQuery.data?.articles || [];

  const isLoading = envelopeQuery.isLoading || overviewQuery.isLoading;
  const hasError = envelopeQuery.isError && overviewQuery.isError;
  const notFound = !isLoading && !hasError && !env && !overview?.price;

  if (isLoading) {
    return (
      <div className="sym-page">
        <LoadingSkeleton variant="card" count={4} />
      </div>
    );
  }

  if (hasError) return <ApiOfflineBanner />;

  if (notFound) {
    return (
      <div className="sym-page">
        <div className="sym-empty">
          <h2>Symbol not found</h2>
          <p>No data available for <strong>{symbol}</strong>. The symbol may not exist in the database or the backend may be unavailable.</p>
          <Link to="/research/symbols-browser" className="sym-back-link">Browse Symbols</Link>
        </div>
      </div>
    );
  }

  const price = overview?.price ?? overview?.latestPrice ?? null;
  const change = overview?.change ?? overview?.changePercent ?? null;
  const companyName = overview?.name ?? overview?.companyName ?? env?.symbol ?? symbol;
  const symId = overview?.symbolId ?? overview?.id ?? '';

  return (
    <div className="sym-page">
      {/* ── Header ── */}
      <motion.header className="sym-header" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="sym-title-row">
          <StarToggle itemType="symbol" itemId={symId || symbol} size={22} />
          <div>
            <h1>{symbol}</h1>
            {companyName && companyName !== symbol && <p className="sym-company">{companyName}</p>}
          </div>
        </div>
        <div className="sym-header-right">
          {price != null && (
            <span className="sym-price">
              {price.toFixed(symbol.length === 6 && !symbol.includes('-') ? 5 : 2)}
            </span>
          )}
          {change != null && (
            <span className={`sym-change ${change >= 0 ? 'sym-up' : 'sym-down'}`}>
              {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(2)}%
            </span>
          )}
          {overview?.exchange && <span className="sym-chip">{overview.exchange}</span>}
          {overview?.type && <span className="sym-chip">{overview.type}</span>}
        </div>
      </motion.header>

      <div className="sym-grid">
        {/* ── Score Card ── */}
        <motion.section className="sym-card sym-card--score" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
          <h2>Score</h2>
          {env ? (
            <>
              <div className="sym-score-row">
                <span className="sym-score-val" style={{ color: SIGNAL_COLORS[env.signal] || '#94a3b8' }}>
                  {env.composite.toFixed(0)}
                </span>
                <span
                  className="sym-score-signal"
                  style={{ background: (SIGNAL_COLORS[env.signal] || '#94a3b8') + '22', color: SIGNAL_COLORS[env.signal] }}
                >{env.signal}</span>
              </div>
              <div className="sym-score-meta">
                <span>Confidence: {env.confidence}%</span>
                {env.rarity && <span style={{ color: env.rarityColor }}>{env.rarity}</span>}
              </div>
              {env.preTradeReady ? (
                <span className="sym-ready">✓ Trade Ready</span>
              ) : (
                <div className="sym-blockers">
                  {env.preTradeBlockers.map((b, i) => <span key={i} className="sym-blocker">🚫 {b}</span>)}
                </div>
              )}
            </>
          ) : (
            <p className="sym-muted">Score unavailable. Run a scan from the Scoring Workbench.</p>
          )}
        </motion.section>

        {/* ── Risk Gate ── */}
        <motion.section className="sym-card sym-card--risk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 }}>
          <h2>Risk Gate</h2>
          {env?.riskGate?.active ? (
            <>
              <div className="sym-risk-mult">
                Multiplier: <strong>×{env.riskGate.multiplier.toFixed(2)}</strong>
                {env.riskGate.triggered && <span className="sym-risk-hard">⚠ Hard Gate: {env.riskGate.reason}</span>}
              </div>
              {env.riskGate.chain.length > 0 && (
                <div className="sym-risk-chain">
                  {env.riskGate.chain.map((s, i) => (
                    <span key={i} className="sym-risk-step" style={{ opacity: 1 - s.severity * 0.5 }}>
                      {s.rule}: ×{s.multiplier.toFixed(2)}
                    </span>
                  ))}
                </div>
              )}
              {env.riskGate.warnings.length > 0 && (
                <div className="sym-risk-warnings">
                  {env.riskGate.warnings.map((w, i) => <span key={i} className="sym-risk-warn">⚠ {w}</span>)}
                </div>
              )}
            </>
          ) : (
            <p className="sym-muted">Risk gate inactive or data unavailable.</p>
          )}
        </motion.section>

        {/* ── Earnings ── */}
        <motion.section className="sym-card sym-card--earnings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.10 }}>
          <h2>Earnings</h2>
          {earningsQuery.isLoading ? (
            <p className="sym-muted">Loading...</p>
          ) : earnings?.date ? (
            <div className="sym-earning">
              <span className="sym-earn-date">{new Date(earnings.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              {earnings.time && <span className="sym-earn-time">{earnings.time}</span>}
              {earnings.epsEstimate != null && <span className="sym-earn-eps">EPS est: {earnings.epsEstimate}</span>}
              {earnings.revenueEstimate != null && <span className="sym-earn-rev">Rev est: {earnings.revenueEstimate}</span>}
            </div>
          ) : (
            <p className="sym-muted">No upcoming earnings data.</p>
          )}
        </motion.section>
      </div>

      {/* ── Directive Drilldown ── */}
      {env?.groups?.length > 0 && (
        <motion.section className="sym-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12 }}>
          <h2>Directive Drilldown</h2>
          <div className="sym-groups">
            {env.groups.map(g => (
              <div key={g.groupId} className={`sym-group ${g.isRisk ? 'sym-group-risk' : ''}`}>
                <div className="sym-group-head">
                  <span className="sym-group-name">{g.groupName}</span>
                  <span className="sym-group-score" style={{ color: g.score > 65 ? '#22c55e' : g.score < 35 ? '#ef4444' : '#94a3b8' }}>{g.score}</span>
                  <span className="sym-group-wt">({g.weight}%)</span>
                </div>
                {g.topDirectives.map(d => (
                  <div key={d.id} className={`sym-dir sym-dir-${d.signalClass}`}>
                    <span className="sym-dir-name">{d.name}</span>
                    <span className="sym-dir-score">{d.normalized}</span>
                    <span className="sym-dir-reason">{d.reason}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {env.conflicts?.length > 0 && (
            <div className="sym-conflicts">
              {env.conflicts.map((c, i) => (
                <span key={i} className={`sym-conflict sym-conflict-${c.severity}`}>{c.description}</span>
              ))}
            </div>
          )}
        </motion.section>
      )}

      {/* ── Cross-Protocol Scores ── */}
      {protocols.length > 0 && (
        <motion.section className="sym-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.14 }}>
          <h2>Protocol Scores</h2>
          <div className="sym-protocols">
            {protocols.map(p => (
              <div key={p.id || p.name} className="sym-proto">
                <div className="sym-proto-head">
                  <strong>{p.name}</strong>
                  <span className={`sym-proto-score ${p.signal}`}>{p.score}</span>
                  <span className={`sym-proto-sig ${p.signal}`}>{p.signal}</span>
                </div>
                <div className="sym-proto-meta">
                  <span>Conf: {(p.confidence * 100).toFixed(0)}%</span>
                  <span>Trend: {p.trend || '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.section>
      )}

      {/* ── News ── */}
      <motion.section className="sym-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.16 }}>
        <h2>Recent News</h2>
        {newsArticles.length > 0 ? (
          <div className="sym-news-list">
            {newsArticles.map((a, i) => (
              <a key={i} href={a.url || '#'} target="_blank" rel="noopener noreferrer" className="sym-news-item">
                <span className="sym-news-source">{a.source}</span>
                <span className="sym-news-title">{a.headline || a.title}</span>
                <span className="sym-news-time">{a.time ? new Date(a.time).toLocaleDateString() : ''}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="sym-muted">No recent news.</p>
        )}
      </motion.section>

      {/* ── Actions ── */}
      <motion.div className="sym-actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18 }}>
        {symId && (
          <Link to={`/research/symbol/${symId}`} className="sym-action-btn sym-action-full">📊 Full Detail (Chart & Trade)</Link>
        )}
        <Link to={`/research/investigation?symbol=${symbol}`} className="sym-action-btn">🔍 Research</Link>
      </motion.div>
    </div>
  );
}
