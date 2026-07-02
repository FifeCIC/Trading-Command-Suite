import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { usePreferences } from '../core/hooks/usePreferences';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './research-overview.css';

function MKV({ label, val, chg, invert }) {
  return (
    <div className="ro-mkt-item">
      <span className="ro-mkt-label">{label}</span>
      <span className="ro-mkt-val">{val ?? '—'}</span>
      {chg != null && (
        <span className={'ro-mkt-chg ' + (invert ? (chg >= 0 ? 'ro-down' : 'ro-up') : (chg >= 0 ? 'ro-up' : 'ro-down'))}>
          {chg >= 0 ? '+' : ''}{chg}
        </span>
      )}
    </div>
  );
}

const PRIORITY = { holding: { label: 'Holding', cls: 'ro-pri-holding', icon: '🔵' }, watchlist: { label: 'Watch', cls: 'ro-pri-watch', icon: '🟡' }, general: { label: '', cls: '', icon: '' } };

export default function ResearchOverviewPage() {
  const { prefs } = usePreferences();
  const overviewQuery = useQuery({
    queryKey: ['research-overview'],
    queryFn: () => apiGet('/api/research/overview'),
    refetchInterval: prefs.researchRefreshInterval,
  });

  const data = overviewQuery.data || {};
  const apiOnline = !overviewQuery.isError;
  const isLoading = overviewQuery.isLoading;
  const topSignals = data.topSignals || [];
  const portfolio = data.portfolio || { positionCount: 0, totalValue: 0, totalPnl: 0, totalPnlPct: 0, positions: [] };
  const market = data.marketContext || {};
  const decisions = data.recentDecisions || [];
  const events = data.upcomingEvents || [];
  const positionNews = data.newsForPositions || [];
  const sectors = data.sectorPerformance || [];
  const forecasts = data.forecasts || [];
  const fmt = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
  const fv = (v) => v != null ? v.toLocaleString() : '—';

  if (isLoading) return <div className="ro-page"><LoadingSkeleton variant="card" count={6} /></div>;

  return (
    <div className="ro-page">
      <motion.header className="ro-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div><h1>Research Overview</h1>
        <p className="ro-subtitle">Cross-system dashboard — scoring, portfolio, market context, upcoming events.</p></div>
        <span className="ro-clock">Updated: {fmt(data.generatedAt)}</span>
      </motion.header>
      {!apiOnline && !isLoading && <ApiOfflineBanner />}
      {apiOnline && (
      <div className="ro-grid">
        <motion.section className="ro-card ro-card-pf" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <h2 className="ro-card-title">Portfolio</h2>
          {portfolio.positionCount === 0 ? <p className="ro-empty">No positions. Import from Trading212.</p> : (<>
            <div className="ro-pf-summary">
              <div className="ro-pf-stat"><span className="ro-pf-val">{fv(portfolio.totalValue)}</span><span className="ro-pf-lbl">Value</span></div>
              <div className={'ro-pf-stat ' + (portfolio.totalPnl >= 0 ? 'ro-up' : 'ro-down')}>
                <span className="ro-pf-val">{portfolio.totalPnl >= 0 ? '+' : ''}{fv(portfolio.totalPnl)}</span>
                <span className="ro-pf-lbl">P&amp;L ({portfolio.totalPnlPct >= 0 ? '+' : ''}{portfolio.totalPnlPct}%)</span>
              </div>
              <div className="ro-pf-stat"><span className="ro-pf-val">{portfolio.positionCount}</span><span className="ro-pf-lbl">Positions</span></div>
            </div>
            <div className="ro-pf-list">
              {portfolio.positions.slice(0, 6).map(p => (
                <div key={p.symbol} className="ro-pf-row">
                  <span className="ro-pf-sym">{p.symbol}</span>
                  <span className={'ro-pf-pnl ' + ((p.pnl || 0) >= 0 ? 'ro-up' : 'ro-down')}>{(p.pnl || 0) >= 0 ? '+' : ''}{fv(p.pnl)}</span>
                  {p.hasEarningsSoon && <span className="ro-earn-warn" title={'Earnings: ' + p.earningsDate}>📅</span>}
                </div>
              ))}
            </div>
          </>)}
        </motion.section>

        <motion.section className="ro-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <h2 className="ro-card-title">Market Context</h2>
          <div className="ro-mkt-grid">
            <MKV label="VIX" val={market.vixLevel} chg={market.vixChange} invert />
            <MKV label="Fed Rate" val={market.fedRate != null ? market.fedRate + '%' : null} />
            <MKV label="10Y" val={market.us10y != null ? market.us10y + '%' : null} />
            <MKV label="Gold" val={market.goldPrice} />
            <MKV label="Oil" val={market.oilPrice} />
            <MKV label="S&P 500" val={market.spxLevel} />
          </div>
        </motion.section>

        <motion.section className="ro-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h2 className="ro-card-title">Top Signals</h2>
          {topSignals.length === 0 ? <p className="ro-empty">Run scoring to populate.</p> : (
            <div className="ro-signals">
              {topSignals.map((s, i) => {
                const p = PRIORITY[s.priority] || PRIORITY.general;
                return (
                <div key={s.ticker} className="ro-signal-row">
                  <span className="ro-signal-rank">#{i + 1}</span>
                  {p.icon && <span className={`ro-pri-tag ${p.cls}`} title={p.label}>{p.icon}</span>}
                  <span className="ro-signal-symbol">{s.ticker}</span>
                  <span className="ro-signal-score">{s.score.toFixed(0)}</span>
                  <span className={'ro-signal-tag ' + s.signal.toLowerCase()}>{s.signal}</span>
                </div>
                );
              })}
            </div>
          )}
        </motion.section>

        <motion.section className="ro-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
          <h2 className="ro-card-title">Price Forecasts</h2>
          {forecasts.length === 0 ? <p className="ro-empty">Analyst targets unavailable. Try adding positions first.</p> : (
            <div className="ro-forecast-list">
              {forecasts.map((f) => (
                <div key={f.symbol} className="ro-forecast-row">
                  <span className="ro-forecast-sym">{f.symbol}</span>
                  <div className="ro-forecast-bar-wrap">
                    <div className="ro-forecast-bar">
                      <div
                        className={`ro-forecast-fill ${f.upside >= 0 ? 'ro-up' : 'ro-down'}`}
                        style={{ width: `${Math.min(Math.abs(f.upside), 100)}%` }}
                      />
                    </div>
                    <span className={`ro-forecast-pct ${f.upside >= 0 ? 'ro-up' : 'ro-down'}`}>
                      {f.upside >= 0 ? '+' : ''}{f.upside}%
                    </span>
                  </div>
                  <span className="ro-forecast-consensus">{f.consensus}</span>
                </div>
              ))}
            </div>
          )}
        </motion.section>

        <motion.section className="ro-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
          <h2 className="ro-card-title">Sectors</h2>
          <div className="ro-sector-list">
            {sectors.map(s => (
              <div key={s.etf} className="ro-sector-row">
                <span className="ro-sector-name">{s.sector}</span>
                <span className="ro-sector-etf">{s.etf}</span>
                <span className={'ro-sector-chg ' + (s.changePct >= 0 ? 'ro-up' : 'ro-down')}>{s.changePct >= 0 ? '+' : ''}{s.changePct}%</span>
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section className="ro-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}>
          <h2 className="ro-card-title">Recent Decisions</h2>
          {decisions.length === 0 ? <p className="ro-empty">No automated decisions.</p> : (
            <div className="ro-decision-list">
              {decisions.slice(0, 6).map((d, i) => (
                <div key={i} className={'ro-decision-row ro-decision-' + (d.decision || 'entry').toLowerCase()}>
                  <span className="ro-decision-symbol">{d.symbol}</span>
                  <span className="ro-decision-composite">{typeof d.composite === 'number' ? d.composite.toFixed(0) : d.composite}</span>
                  <span className="ro-decision-reason">{(d.reason || '').slice(0, 50)}</span>
                </div>
              ))}
            </div>
          )}
        </motion.section>

        <motion.section className="ro-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
          <h2 className="ro-card-title">Upcoming Events</h2>
          {events.length === 0 ? <p className="ro-empty">No upcoming events.</p> : (
            <div className="ro-events">
              {events.map((ev, i) => (
                <div key={i} className="ro-event-row">
                  <span className="ro-event-icon">{ev.icon}</span>
                  <div>
                    <strong>{ev.label}</strong>
                    {ev.affectsPositions?.length > 0 && <span className="ro-event-pos">🎯 {ev.affectsPositions.join(', ')}</span>}
                    <span className="ro-event-time">{fmt(ev.startsAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.section>

        <motion.section className="ro-card ro-card-span" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
          <h2 className="ro-card-title">News for Your Positions</h2>
          {positionNews.length === 0 ? <p className="ro-empty">No recent news for held positions.</p> : (
            <div className="ro-news-list">
              {positionNews.map((n, i) => (
                <div key={i} className={'ro-news-row ro-news-' + (n.sentiment > 0.1 ? 'pos' : n.sentiment < -0.1 ? 'neg' : 'neut') + (n.isHighImpact ? ' ro-news-high' : '')}>
                  <span className="ro-news-sym">{n.symbol}</span>
                  <span className="ro-news-sent">{n.sentiment > 0.1 ? '🟢' : n.sentiment < -0.1 ? '🔴' : '⚪'}</span>
                  {n.isHighImpact && <span className="ro-news-impact-badge">HIGH</span>}
                  <span className="ro-news-headline">{n.headline}</span>
                </div>
              ))}
            </div>
          )}
        </motion.section>
      </div>
      )}
    </div>
  );
}
