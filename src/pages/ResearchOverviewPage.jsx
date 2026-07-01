import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './research-overview.css';

export default function ResearchOverviewPage() {
  const rankedQuery = useQuery({
    queryKey: ['scoring', 'ranked'],
    queryFn: () => apiGet('/api/scoring/ranked'),
    refetchInterval: 30000,
  });

  const statusQuery = useQuery({
    queryKey: ['automation', 'status'],
    queryFn: () => apiGet('/api/automation/status'),
    refetchInterval: 15000,
  });

  const timelineQuery = useQuery({
    queryKey: ['automation', 'timeline'],
    queryFn: () => apiGet('/api/automation/timeline?lookahead=240'),
    refetchInterval: 60000,
  });

  const apiOnline = !rankedQuery.isError && !statusQuery.isError;
  const ranked = rankedQuery.data?.ranked ?? [];
  const decisions = statusQuery.data?.recentDecisions ?? [];
  const loopState = statusQuery.data ?? {};
  const events = timelineQuery.data?.events ?? [];

  const topSignals = ranked.filter(r => r.score > 0).slice(0, 5);
  const maxScore = topSignals.length > 0 ? Math.max(...topSignals.map(s => s.score)) : 1;
  const scoredDecisions = decisions.filter(d => d.composite > 0);
  const upcomingEvents = events.slice(0, 4);

  const formatTime = (iso) => {
    if (!iso) return '--';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="ro-page">
      <motion.header className="ro-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>🔬 Research Overview</h1>
          <p className="ro-subtitle">
            {loopState.loopEnabled
              ? `Live signal dashboard — Loop active, Tick #${loopState.tickCount || 0}`
              : 'Signal dashboard — start the automation loop for live data'}
          </p>
        </div>
        <span className="ro-clock">Updated: {formatTime(loopState.lastTickAt) || 'never'}</span>
      </motion.header>

      {!apiOnline && <ApiOfflineBanner />}

      <div className="ro-grid">
        {/* Top Signals */}
        <motion.section className="ro-card ro-card-span" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h2 className="ro-card-title">📊 Top Signals Right Now</h2>
          {rankedQuery.isLoading ? <LoadingSkeleton variant="text" lines={5} /> : (
            topSignals.length === 0 ? (
              <p className="ro-empty">No signals yet. Start scoring to populate.</p>
            ) : (
              <div className="ro-signals">
                {topSignals.map((s, i) => (
                  <motion.div key={s.ticker} className="ro-signal-row" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.05 }}>
                    <span className="ro-signal-rank">#{i + 1}</span>
                    <span className="ro-signal-symbol">{s.ticker}</span>
                    <div className="ro-signal-bar-wrap">
                      <motion.div className="ro-signal-bar" initial={{ width: 0 }} animate={{ width: `${(s.score / maxScore) * 100}%` }} transition={{ duration: 0.6, delay: 0.3 + i * 0.05 }} />
                    </div>
                    <span className="ro-signal-score">{s.score}</span>
                    <span className={`ro-signal-tag ${(s.signal || 'neutral').toLowerCase()}`}>{s.signal || 'neutral'}</span>
                  </motion.div>
                ))}
              </div>
            )
          )}
        </motion.section>

        {/* Recent Decisions */}
        <motion.section className="ro-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <h2 className="ro-card-title">⚡ Recent Decisions</h2>
          {statusQuery.isLoading ? <LoadingSkeleton variant="text" lines={4} /> : (
            scoredDecisions.length === 0 ? (
              <p className="ro-empty">No scored decisions yet.</p>
            ) : (
              <div className="ro-decision-list">
                {scoredDecisions.slice(0, 6).map((d, i) => (
                  <div key={i} className={`ro-decision-row ro-decision-${d.decision?.toLowerCase()}`}>
                    <span className="ro-decision-symbol">{d.symbol}</span>
                    <span className="ro-decision-composite">{d.composite}</span>
                    <span className="ro-decision-reason">{d.reason?.slice(0, 40)}</span>
                  </div>
                ))}
              </div>
            )
          )}
        </motion.section>

        {/* Upcoming Events */}
        <motion.section className="ro-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <h2 className="ro-card-title">📅 Upcoming Events</h2>
          {timelineQuery.isLoading ? <LoadingSkeleton variant="text" lines={3} /> : (
            upcomingEvents.length === 0 ? (
              <p className="ro-empty">No upcoming events in the next 4 hours.</p>
            ) : (
              <div className="ro-events">
                {upcomingEvents.map((ev, i) => (
                  <div key={i} className="ro-event-row">
                    <span className="ro-event-icon">{ev.icon || '📌'}</span>
                    <div>
                      <strong>{ev.label}</strong>
                      <span className="ro-event-time">{formatTime(ev.startsAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </motion.section>

        {/* Loop Status */}
        <motion.section className="ro-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <h2 className="ro-card-title">🔄 Loop Status</h2>
          {statusQuery.isLoading ? <LoadingSkeleton variant="text" lines={2} /> : (
            <div className="ro-status">
              <div className="ro-status-row">
                <span>Status</span>
                <span className={`ro-status-badge ${loopState.loopEnabled ? 'ro-on' : 'ro-off'}`}>{loopState.loopEnabled ? 'Running' : 'Stopped'}</span>
              </div>
              <div className="ro-status-row">
                <span>Tick</span>
                <span>#{loopState.tickCount || 0}</span>
              </div>
              <div className="ro-status-row">
                <span>Interval</span>
                <span>{Math.round((loopState.tickIntervalMs || 300000) / 1000)}s</span>
              </div>
              <div className="ro-status-row">
                <span>Last tick</span>
                <span>{loopState.lastTickMs || 0}ms</span>
              </div>
              <div className="ro-status-row">
                <span>Strategies</span>
                <span>{loopState.activeStrategies?.length || 0}</span>
              </div>
            </div>
          )}
        </motion.section>

        {/* Top Score Snapshot */}
        <motion.section className="ro-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <h2 className="ro-card-title">🏆 Highest Score</h2>
          {rankedQuery.isLoading ? <LoadingSkeleton variant="text" lines={1} /> : (
            topSignals.length > 0 ? (
              <div className="ro-hero-score">
                <motion.span className="ro-hero-symbol" initial={{ scale: 0.8 }} animate={{ scale: 1 }}>{topSignals[0].ticker}</motion.span>
                <motion.span className="ro-hero-value" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.2 }}>{topSignals[0].score}</motion.span>
                <span className="ro-hero-signal">{topSignals[0].signal || 'neutral'}</span>
              </div>
            ) : (
              <p className="ro-empty">No scores available.</p>
            )
          )}
        </motion.section>
      </div>
    </div>
  );
}
