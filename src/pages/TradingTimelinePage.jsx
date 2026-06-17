import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import './TradingTimelinePage.css';

const VIEWS = ['Day', '2-Day', 'Week', 'Month'];
const SESSION_ICONS = { london: '🇬🇧', ny: '🇺🇸', asia: '🇯🇵', tokyo: '🇯🇵' };

function ScoreBar({ score, max = 100 }) {
  const pct = (score / max) * 100;
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444';
  return <span className="tl-bar"><span className="tl-bar-fill" style={{ width: `${pct}%`, background: color }} /></span>;
}

export default function TradingTimelinePage() {
  const [view, setView] = useState('Day');
  const [selectedDay, setSelectedDay] = useState(0);
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [tooltip, setTooltip] = useState(null);

  const today = new Date().toISOString().split('T')[0];
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const query = useQuery({
    queryKey: ['timeline', today, weekEnd],
    queryFn: () => fetch(`/api/timeline?from=${today}&to=${weekEnd}`).then((r) => r.json()),
    staleTime: 60000,
  });

  const days = query.data?.days || [];
  const activeDay = days[selectedDay] || days[0];

  const visibleDays = useMemo(() => {
    if (view === 'Day') return days.slice(selectedDay, selectedDay + 1);
    if (view === '2-Day') return days.slice(selectedDay, selectedDay + 2);
    if (view === 'Week') return days.slice(0, 7);
    return days.slice(0, 31);
  }, [days, view, selectedDay]);

  if (query.isLoading) return <div className="tl-page"><p>Loading timeline...</p></div>;

  return (
    <div className="tl-page">
      <header className="tl-header">
        <h2>📅 Trading Timeline</h2>
        <p>Session opens, economic events, earnings, and SEES predictions — all on one timeline.</p>
      </header>

      {/* View controls */}
      <div className="tl-controls">
        <div className="tl-view-btns">
          {VIEWS.map((v) => (
            <button key={v} className={`tl-view-btn ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>
              {v}
            </button>
          ))}
        </div>
        <button className="tl-today-btn" onClick={() => setSelectedDay(0)}>Today</button>
        <label className="tl-star-toggle">
          <input type="checkbox" checked={showStarredOnly} onChange={(e) => setShowStarredOnly(e.target.checked)} />
          Starred only
        </label>
      </div>

      {/* Day navigation */}
      {view !== 'Month' && (
        <div className="tl-day-nav">
          <button disabled={selectedDay === 0} onClick={() => setSelectedDay(Math.max(0, selectedDay - 1))}>← Prev</button>
          <span>{activeDay?.dayOfWeek} {activeDay?.date}</span>
          <button disabled={selectedDay >= days.length - 1} onClick={() => setSelectedDay(Math.min(days.length - 1, selectedDay + 1))}>Next →</button>
        </div>
      )}

      {/* Day / 2-Day / Week View */}
      {view !== 'Month' && (
        <div className={`tl-grid tl-grid--${view.toLowerCase()}`}>
          {visibleDays.map((day, i) => (
            <div key={day.date} className={`tl-day-col ${i === 0 ? 'tl-today' : ''}`}>
              <div className="tl-day-header">
                <span className="tl-day-name">{day.dayOfWeek}</span>
                <span className="tl-day-date">{day.date}</span>
              </div>

              {/* Events */}
              <div className="tl-events">
                <h4>📅 Events</h4>
                {day.events.length === 0 && <p className="tl-muted">No events scheduled</p>}
                {day.events.map((evt) => (
                  <div
                    key={evt.id}
                    className={`tl-event tl-event--${evt.importance} tl-event--${evt.type}`}
                    onMouseEnter={() => setTooltip({ ...evt })}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    <span className="tl-event-time">{new Date(evt.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="tl-event-icon">
                      {evt.type === 'session-open' ? (SESSION_ICONS[evt.session] || '🌍') :
                       evt.type === 'economic' ? '📊' : evt.type === 'earnings' ? '💰' : '📝'}
                    </span>
                    <div className="tl-event-content">
                      <span className="tl-event-title">{evt.title}</span>
                      {evt.prediction && <span className="tl-event-prediction">{evt.prediction}</span>}
                      {evt.symbol && <span className="tl-event-symbol">{evt.symbol}</span>}
                    </div>
                  </div>
                ))}
              </div>

              {/* Priority Symbols */}
              {(view === 'Day' || view === '2-Day') && (
                <div className="tl-priority">
                  <h4>📊 Priority Symbols</h4>
                  {day.prioritySymbols?.map((ps) => (
                    <div key={ps.symbol} className="tl-symbol-row">
                      <span className="tl-symbol-name">{ps.symbol}</span>
                      <ScoreBar score={ps.currentScore} />
                      <span className="tl-symbol-score">{ps.currentScore}</span>
                      <span className={`tl-symbol-dir tl-dir-${ps.direction}`}>
                        {ps.direction === 'up' ? '↑' : ps.direction === 'down' ? '↓' : '→'} {ps.predictedScore}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Month View */}
      {view === 'Month' && (
        <div className="tl-month-grid">
          {days.slice(0, 31).map((day) => {
            const hasEvents = day.events.length > 0;
            const highEvents = day.events.filter((e) => e.importance === 'high');
            return (
              <div
                key={day.date}
                className={`tl-month-day ${hasEvents ? 'has-events' : ''} ${highEvents.length > 0 ? 'has-high' : ''}`}
                onClick={() => { setView('Day'); setSelectedDay(days.indexOf(day)); }}
              >
                <span className="tl-month-num">{new Date(day.date).getDate()}</span>
                <span className="tl-month-dow">{day.dayOfWeek.slice(0, 3)}</span>
                {highEvents.length > 0 && <span className="tl-month-dot high" />}
                {hasEvents && highEvents.length === 0 && <span className="tl-month-dot" />}
              </div>
            );
          })}
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div className="tl-tooltip">
          <strong>{tooltip.title}</strong>
          <p>{tooltip.description}</p>
          {tooltip.prediction && <p className="tl-tooltip-pred">{tooltip.prediction}</p>}
          {tooltip.symbol && <p>Symbol: {tooltip.symbol}</p>}
        </div>
      )}
    </div>
  );
}
