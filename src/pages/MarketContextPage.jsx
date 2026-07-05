/**
 * MarketContextPage — 7-Day Market Awareness
 * ===========================================
 * Day-of-week trading context: session timing, upcoming events,
 * swap risk, gap exposure, pre-flight checklist.
 * Route: /trading/market-context
 */
import { useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import Notice from '../components/Notice';
import './market-context.css';

const MOOD_COLORS = {
  caution:  { bg: 'var(--notice-warning-bg)', border: 'var(--notice-warning-border)', text: 'var(--notice-warning-text)', icon: '⚠️' },
  normal:   { bg: 'var(--notice-success-bg)', border: 'var(--notice-success-border)', text: 'var(--notice-success-text)', icon: '✅' },
  watchful: { bg: 'var(--notice-warning-bg)', border: 'var(--notice-warning-border)', text: 'var(--notice-warning-text)', icon: '👁️' },
  prep:     { bg: 'var(--notice-info-bg)', border: 'var(--notice-info-border)', text: 'var(--notice-info-text)', icon: '📋' },
};

const IMPACT_COLORS = {
  high:   { color: '#ef4444', bg: '#ef444418' },
  medium: { color: '#f59e0b', bg: '#f59e0b18' },
  low:    { color: '#94a3b8', bg: '#94a3b818' },
};

function ChecklistItem({ text }) {
  const isWarning = text.startsWith('⚠️');
  return (
    <li className={`mc-checklist-item ${isWarning ? 'mc-warn' : ''}`}>
      {isWarning ? '⚠️ ' : '• '}{text.replace('⚠️ ', '')}
    </li>
  );
}

export default function MarketContextPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['market-context'],
    queryFn: () => apiGet('/api/trading/sessions/market-context'),
    refetchInterval: 120_000,
  });

  const day = data?.currentDay;
  const sessions = data?.sessions || [];
  const events = data?.upcomingEvents || [];
  const warnings = data?.warnings || [];
  const preflightOk = data?.preflightOk ?? true;

  const mood = MOOD_COLORS[day?.mood] || MOOD_COLORS.normal;

  // Active sessions count
  const activeSessions = sessions.filter((s) => s.active);
  const anyActive = activeSessions.length > 0;

  if (isLoading) return (
    <div className="mc-page">
      <header className="mc-header"><h1>Market Context</h1></header>
      <LoadingSkeleton variant="card" count={3} />
    </div>
  );

  return (
    <div className="mc-page">
      <header className="mc-header">
        <div>
          <h1>Market Context</h1>
          <p className="mc-subtitle">7-day market awareness — upcoming events, session timing, and day-specific pre-flight checks</p>
          <p className="mc-description">
            A protocol-agnostic view of the trading environment. Shows which sessions are active,
            what economic events are approaching, and day-of-week checklists. Individual protocols
            use this context internally to adjust their signals.
          </p>
        </div>
        <button className="mc-refresh-btn" onClick={() => refetch()}>↻ Refresh</button>
      </header>

      {isError && <ApiOfflineBanner />}

      {/* ── Pre-flight status ── */}
      <Notice level={preflightOk ? 'success' : 'warning'}>
        <strong>{preflightOk ? 'Pre-flight OK' : 'Pre-flight warnings active'}</strong>
        {' '}{preflightOk ? 'All systems clear for trading.' : 'Review warnings below before trading.'}
      </Notice>

      {/* ── Day Context Card ── */}
      {day && (
        <motion.div className="mc-day-card" style={{ borderColor: mood.border, background: mood.bg }}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        >
          <div className="mc-day-head">
            <span className="mc-day-icon">{mood.icon}</span>
            <h2 className="mc-day-label" style={{ color: mood.text }}>{day.label}</h2>
            <span className="mc-day-mood" style={{ color: mood.text }}>{day.mood.toUpperCase()}</span>
          </div>
          <p className="mc-day-note">{day.sessionNote}</p>
          <div className="mc-day-tags">
            {day.gapExposure !== 'none' && (
              <span className="mc-tag" style={{ background: day.gapExposure === 'high' ? '#ef444418' : '#f59e0b18', color: day.gapExposure === 'high' ? '#ef4444' : '#f59e0b' }}>
                Gap: {day.gapExposure}
              </span>
            )}
            <span className="mc-tag" style={{ background: day.swapRisk === 'triple' ? '#ef444418' : '#22c55e18', color: day.swapRisk === 'triple' ? '#ef4444' : '#22c55e' }}>
              Swap: {day.swapRisk}
            </span>
          </div>
        </motion.div>
      )}

      {/* ── Two-column layout ── */}
      <div className="mc-two-col">
        {/* Sessions */}
        <motion.section className="mc-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <h2>Sessions</h2>
          {sessions.map((s) => (
            <div key={s.name} className={`mc-session-row ${s.active ? 'mc-session-active' : ''}`}>
              <div className="mc-session-left">
                <span className={`mc-session-dot ${s.active ? 'mc-dot-live' : 'mc-dot-off'}`} />
                <span className="mc-session-name">{s.name}</span>
              </div>
              <div className="mc-session-right">
                <span className="mc-session-time">{s.timeRange}</span>
                {s.active && s.closesIn != null && (
                  <span className="mc-session-timer">Closes in {Math.round(s.closesIn / 60)}h {s.closesIn % 60}m</span>
                )}
                {!s.active && s.opensIn != null && (
                  <span className="mc-session-timer mc-next">Opens in {Math.round(s.opensIn / 60)}h {s.opensIn % 60}m</span>
                )}
              </div>
            </div>
          ))}
          {!anyActive && <p className="mc-empty-note">No major sessions active — liquidity may be thin.</p>}
        </motion.section>

        {/* Checklist */}
        {day?.checklist && (
          <motion.section className="mc-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <h2>{day.isFriday ? 'EOW Checklist' : day.isMonday ? 'Monday Checklist' : 'Daily Checklist'}</h2>
            <ul className="mc-checklist">
              {day.checklist.map((item, i) => (
                <ChecklistItem key={i} text={item} />
              ))}
            </ul>
          </motion.section>
        )}
      </div>

      {/* ── Upcoming Events ── */}
      {events.length > 0 && (
        <motion.section className="mc-panel mc-events" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <h2>Upcoming Events (7 days)</h2>
          <div className="mc-events-list">
            {events.map((e, i) => {
              const impact = IMPACT_COLORS[e.impact] || IMPACT_COLORS.low;
              return (
                <div key={i} className="mc-event-row">
                  <span className="mc-event-type" style={{ color: impact.color, background: impact.bg }}>{e.type}</span>
                  <span className="mc-event-label">{e.label}</span>
                  <span className="mc-event-days" style={{ color: impact.color }}>
                    {e.daysUntil === 0 ? 'Today' : e.daysUntil === 1 ? 'Tomorrow' : `${e.daysUntil}d`}
                  </span>
                </div>
              );
            })}
          </div>
        </motion.section>
      )}

      {/* ── Warnings ── */}
      {warnings.length > 0 && (
        <motion.div className="mc-warnings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
          {warnings.map((w, i) => (
            <Notice key={i} level={w.startsWith('⚠️') ? 'critical' : 'warning'}>{w}</Notice>
          ))}
        </motion.div>
      )}
    </div>
  );
}
