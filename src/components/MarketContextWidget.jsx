/**
 * MarketContextWidget — Compact market context for Dashboard
 * ===========================================================
 * Extracted from MarketContextPage for reuse on Dashboard (#563).
 * Shows: day mood, active sessions, upcoming events count.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './market-context-widget.css';

const MOOD_COLORS = {
  caution:  { color: '#f59e0b', icon: '⚠️' },
  normal:   { color: '#22c55e', icon: '✅' },
  watchful: { color: '#f59e0b', icon: '👁️' },
  prep:     { color: '#3b82f6', icon: '📋' },
};

export default function MarketContextWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['market-context-widget'],
    queryFn: () => apiGet('/api/trading/sessions/market-context').catch(() => null),
    refetchInterval: 120_000,
  });

  const day = data?.currentDay;
  const sessions = data?.sessions || [];
  const events = data?.upcomingEvents || [];
  const preflightOk = data?.preflightOk ?? true;
  const mood = MOOD_COLORS[day?.mood] || MOOD_COLORS.normal;

  const activeSessions = useMemo(() => sessions.filter(s => s.active), [sessions]);
  const highImpactEvents = useMemo(() => events.filter(e => e.impact === 'high'), [events]);

  if (isLoading) return <div className="mcw-widget mcw-loading">Loading market data…</div>;

  return (
    <div className="mcw-widget">
      <div className="mcw-header">
        <span className="mcw-title">🌐 Market Context</span>
        <span className="mcw-mood" style={{ color: mood.color }}>{mood.icon} {day?.mood || 'normal'}</span>
      </div>
      <div className="mcw-body">
        <div className="mcw-row">
          <span className="mcw-label">Pre-flight</span>
          <span className={`mcw-value ${preflightOk ? 'mcw-ok' : 'mcw-warn'}`}>
            {preflightOk ? '✅ Clear' : '⚠️ Issues'}
          </span>
        </div>
        {activeSessions.length > 0 && (
          <div className="mcw-row">
            <span className="mcw-label">Active</span>
            <span className="mcw-value">{activeSessions.map(s => s.name).join(', ')}</span>
          </div>
        )}
        {events.length > 0 && (
          <div className="mcw-row">
            <span className="mcw-label">Events</span>
            <span className="mcw-value">
              {events.length} upcoming{highImpactEvents.length > 0 && (
                <span className="mcw-high"> ({highImpactEvents.length} high impact)</span>
              )}
            </span>
          </div>
        )}
        {day?.dayLabel && (
          <div className="mcw-row">
            <span className="mcw-label">Day</span>
            <span className="mcw-value">{day.dayLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}
