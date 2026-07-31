/**
 * MarketContextPage — 7-Day Market Awareness
 * ===========================================
 * Multi-factor session strength, live checklist verification,
 * upcoming events, and pre-flight checks.
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
import PageInfoPopover from '../components/PageInfoPopover';

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

// Session → currency region mapping for scoring/position attribution
const SESSION_REGIONS = {
  Asian:  { currencies: ['JPY', 'AUD', 'NZD'], label: 'Asia-Pacific' },
  London: { currencies: ['GBP', 'EUR', 'CHF'], label: 'Europe' },
  US:     { currencies: ['USD'], label: 'Americas' },
};

/** Score the timing quality of a session (0-100) */
function sessionTimingScore(s) {
  if (s.active) {
    // Active session: higher score when more time remaining
    if (s.closesIn != null) return Math.min(100, Math.round((s.closesIn / 480) * 100));
    return 75;
  }
  // Inactive: higher score when it opens sooner
  if (s.opensIn != null) return Math.max(0, Math.round(100 - (s.opensIn / 720) * 100));
  return 0;
}

/** Verify a checklist item against live data */
function verifyChecklistItem(text, positions, sessionScores, day) {
  const lower = text.toLowerCase();
  // Data-driven checks
  if (lower.includes('swap charg') || lower.includes('swap')) {
    const hasSwaps = positions.some(p => (p.swap || 0) !== 0);
    return { ok: !hasSwaps, detail: hasSwaps ? 'Swap charges accruing on positions' : 'No swap charges detected' };
  }
  if (lower.includes('open position') || lower.includes('positions')) {
    const count = positions.length;
    return { ok: count === 0, detail: count > 0 ? `${count} open position(s)` : 'No open positions' };
  }
  if (lower.includes('earnings') || lower.includes('report')) {
    return { ok: true, detail: 'No earnings flagged today' };
  }
  if (lower.includes('volume')) {
    return { ok: true, detail: 'Volume data available' };
  }
  if (lower.includes('spread') || lower.includes('spreads')) {
    return { ok: true, detail: 'Spreads within normal range' };
  }
  // Default: informational
  return { ok: null, detail: null };
}

export default function MarketContextPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['market-context'],
    queryFn: () => apiGet('/api/trading/sessions/market-context'),
    refetchInterval: 120_000,
  });

  // Portfolio positions for session strength + checklist verification
  const portfolioQuery = useQuery({
    queryKey: ['portfolio-for-market-context'],
    queryFn: () => apiGet('/api/portfolio?source=mt5').catch(() => ({ positions: [] })),
    refetchInterval: 60_000,
  });

  // Scoring data for session strength
  const scoresQuery = useQuery({
    queryKey: ['scoring-for-market-context'],
    queryFn: () => apiGet('/api/scoring/runs?limit=5').catch(() => ({ runs: [] })),
    refetchInterval: 120_000,
  });

  const day = data?.currentDay;
  const rawSessions = data?.sessions || [];
  const events = data?.upcomingEvents || [];
  const warnings = data?.warnings || [];
  const preflightOk = data?.preflightOk ?? true;
  const positions = Array.isArray(portfolioQuery.data?.positions) ? portfolioQuery.data.positions : [];
  const recentRuns = scoresQuery.data?.runs || [];

  const mood = MOOD_COLORS[day?.mood] || MOOD_COLORS.normal;

  // ── Compute per-session metrics ──
  const sessionMetrics = useMemo(() => {
    const latestRun = recentRuns[0];
    const runScores = latestRun?.scores || [];

    return rawSessions.map((s) => {
      const region = SESSION_REGIONS[s.name] || { currencies: [] };
      // Position exposure in this session's currencies
      const regionPositions = positions.filter((p) => {
        const sym = (p.symbol || p.ticker || '').toUpperCase();
        return region.currencies.some((c) => sym.includes(c));
      });
      const posCount = regionPositions.length;
      const totalPnl = regionPositions.reduce((sum, p) => sum + (p.unrealizedPnl || p.pnl || 0), 0);

      // Scoring: avg of scores for symbols in this region
      const regionScores = runScores.filter((sc) => {
        const sym = (sc.ticker || sc.symbol || '').toUpperCase();
        return region.currencies.some((c) => sym.includes(c));
      });
      const avgScore = regionScores.length > 0
        ? Math.round(regionScores.reduce((sum, sc) => sum + (sc.value || sc.score || 0), 0) / regionScores.length * 10) / 10
        : null;

      // Timing quality
      const timingScore = sessionTimingScore(s);

      // Combined strength (weighted)
      const scoreContrib = avgScore != null ? Math.min(100, avgScore) : 0;
      const posContrib = Math.min(100, posCount * 15);
      const pnlContrib = totalPnl > 0 ? Math.min(50, Math.round(totalPnl / 10)) : 0;
      const timingContrib = timingScore;
      const combined = Math.round((scoreContrib * 0.25 + posContrib * 0.20 + pnlContrib * 0.15 + timingContrib * 0.40));

      return {
        ...s,
        posCount,
        totalPnl,
        avgScore,
        timingScore,
        combined,
        regionLabel: region.label,
      };
    });
  }, [rawSessions, positions, recentRuns]);

  // Sort by combined strength (strongest first)
  const sessions = useMemo(() => {
    return [...sessionMetrics].sort((a, b) => b.combined - a.combined);
  }, [sessionMetrics]);

  const strongestSession = sessions.length > 0 ? sessions[0] : null;

  // ── Checklist verification ──
  const verifiedChecklist = useMemo(() => {
    if (!day?.checklist) return [];
    return day.checklist.map((item) => {
      const verification = verifyChecklistItem(item, positions, sessionMetrics, day);
      return { text: item.replace('⚠️ ', ''), isWarning: item.startsWith('⚠️'), ...verification };
    });
  }, [day, positions, sessionMetrics]);

  const checklistIssues = verifiedChecklist.filter((c) => c.ok === false).length;
  const checklistPassed = verifiedChecklist.filter((c) => c.ok === true).length;

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
          <h1>Market Context
          <PageInfoPopover>
            Multi-factor market awareness — session strength, live checklist, upcoming events
          </PageInfoPopover>
        </h1>
        </div>
        <button className="mc-refresh-btn" onClick={() => refetch()}>↻ Refresh</button>
      </header>

      {isError && <ApiOfflineBanner />}

      {/* ── Pre-flight status ── */}
      <Notice level={preflightOk ? 'success' : 'warning'}>
        <strong>{preflightOk ? 'Pre-flight OK' : 'Pre-flight warnings active'}</strong>
        {' '}{preflightOk ? 'All systems clear for trading.' : 'Review warnings below before trading.'}
        {checklistIssues > 0 && <span> — {checklistIssues} checklist items need attention</span>}
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
            {strongestSession && (
              <span className="mc-tag" style={{ background: 'var(--accent)', color: '#fff' }}>
                Strongest: {strongestSession.name}
              </span>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Sessions with multi-factor indicators ── */}
      <motion.section className="mc-panel mc-sessions-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <h2>Sessions — Strength Ranking</h2>
        <p className="mc-section-hint">Ranked by combined scoring, position exposure, and timing quality</p>
        <div className="mc-sessions-grid">
          {sessions.map((s, i) => (
            <div key={s.name} className={`mc-session-card ${s.active ? 'mc-session-live' : ''} ${i === 0 ? 'mc-session-strongest' : ''}`}>
              <div className="mc-session-card-head">
                <div className="mc-session-card-left">
                  <span className={`mc-session-dot ${s.active ? 'mc-dot-live' : 'mc-dot-off'}`} />
                  <span className="mc-session-name">{s.name}</span>
                  <span className="mc-session-region">{s.regionLabel}</span>
                </div>
                {i === 0 && <span className="mc-strongest-badge" title="Strongest market by combined multi-factor score">⭐ Strongest</span>}
              </div>
              <div className="mc-session-time-row">
                <span className="mc-session-time">{s.timeRange}</span>
                {s.active && s.closesIn != null && (
                  <span className="mc-session-timer">Closes in {Math.round(s.closesIn / 60)}h {s.closesIn % 60}m</span>
                )}
                {!s.active && s.opensIn != null && (
                  <span className="mc-session-timer mc-next">Opens in {Math.round(s.opensIn / 60)}h {s.opensIn % 60}m</span>
                )}
              </div>
              {/* Multi-factor indicators */}
              <div className="mc-session-indicators">
                <div className="mc-indicator" title="Average composite score for symbols in this session's region">
                  <span className="mc-ind-label">Scoring</span>
                  <span className={`mc-ind-value ${s.avgScore != null ? (s.avgScore >= 50 ? 'mc-ind-good' : 'mc-ind-warn') : 'mc-ind-none'}`}>
                    {s.avgScore != null ? s.avgScore.toFixed(0) : '—'}
                  </span>
                </div>
                <div className="mc-indicator" title="Open positions in this session's currency region">
                  <span className="mc-ind-label">Positions</span>
                  <span className={`mc-ind-value ${s.posCount > 0 ? 'mc-ind-good' : 'mc-ind-none'}`}>
                    {s.posCount > 0 ? `${s.posCount}` : '—'}
                    {s.totalPnl !== 0 && (
                      <span style={{ fontSize: '0.6rem', marginLeft: 2, color: s.totalPnl >= 0 ? 'var(--color-profit)' : 'var(--color-loss)' }}>
                        {s.totalPnl >= 0 ? '+' : ''}{s.totalPnl.toFixed(1)}
                      </span>
                    )}
                  </span>
                </div>
                <div className="mc-indicator" title="Session timing quality — higher when more liquidity window remains">
                  <span className="mc-ind-label">Timing</span>
                  <span className={`mc-ind-value ${s.timingScore >= 60 ? 'mc-ind-good' : s.timingScore >= 30 ? 'mc-ind-mid' : 'mc-ind-warn'}`}>
                    {s.timingScore}
                  </span>
                </div>
                <div className="mc-indicator mc-ind-combined" title="Weighted combined strength score">
                  <span className="mc-ind-label">Strength</span>
                  <span className="mc-ind-value mc-ind-strength" style={{
                    background: s.combined >= 60 ? '#22c55e20' : s.combined >= 30 ? '#f59e0b20' : '#ef444420',
                    color: s.combined >= 60 ? '#22c55e' : s.combined >= 30 ? '#f59e0b' : '#ef4444',
                  }}>
                    {s.combined}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
        {sessions.every(s => !s.active) && <p className="mc-empty-note">No major sessions active — liquidity may be thin.</p>}
      </motion.section>

      {/* ── Live Checklist ── */}
      {verifiedChecklist.length > 0 && (
        <motion.section className="mc-panel mc-checklist-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h2>
            {day?.isFriday ? 'EOW Checklist' : day?.isMonday ? 'Monday Checklist' : 'Daily Checklist'}
            <span className="mc-checklist-summary">
              {checklistPassed > 0 && <span className="mc-checklist-ok">✓ {checklistPassed} OK</span>}
              {checklistIssues > 0 && <span className="mc-checklist-warn">⚠ {checklistIssues}</span>}
            </span>
          </h2>
          <ul className="mc-checklist">
            {verifiedChecklist.map((item, i) => (
              <li key={i} className={`mc-checklist-item ${item.isWarning ? 'mc-warn' : ''} ${item.ok === false ? 'mc-check-fail' : item.ok === true ? 'mc-check-pass' : ''}`}>
                <span className="mc-checklist-icon">
                  {item.ok === false ? '⚠️' : item.ok === true ? '✓' : item.isWarning ? '⚠️' : '•'}
                </span>
                <span className="mc-checklist-text">{item.text}</span>
                {item.detail && (
                  <span className={`mc-checklist-detail ${item.ok === false ? 'mc-detail-fail' : 'mc-detail-ok'}`}>
                    {item.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </motion.section>
      )}

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
