import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './events-calendar.css';

const EVENT_TYPES = { earnings: { color: '#3b82f6', icon: '📊' }, fomc: { color: '#8b5cf6', icon: '🏛️' }, cpi: { color: '#f59e0b', icon: '📈' }, nfp: { color: '#f59e0b', icon: '👷' }, gdp: { color: '#06b6d4', icon: '📉' }, dividend: { color: '#22c55e', icon: '💰' } };

// Generate upcoming events (mock until API wired)
function generateEvents() {
  const now = new Date();
  const events = [
    { id: '1', symbol: 'NVDA', type: 'earnings', date: new Date(now.getTime() + 3 * 86400000), label: 'NVDA Q2 Earnings', impact: 'high' },
    { id: '2', symbol: 'AAPL', type: 'earnings', date: new Date(now.getTime() + 10 * 86400000), label: 'AAPL Q3 Earnings', impact: 'high' },
    { id: '3', symbol: 'MSFT', type: 'earnings', date: new Date(now.getTime() + 14 * 86400000), label: 'MSFT Q4 Earnings', impact: 'high' },
    { id: '4', symbol: 'FOMC', type: 'fomc', date: new Date(now.getTime() + 5 * 86400000), label: 'FOMC Rate Decision', impact: 'high' },
    { id: '5', symbol: 'CPI', type: 'cpi', date: new Date(now.getTime() + 2 * 86400000), label: 'CPI Inflation Data', impact: 'high' },
    { id: '6', symbol: 'TSLA', type: 'earnings', date: new Date(now.getTime() + 20 * 86400000), label: 'TSLA Q3 Earnings', impact: 'medium' },
    { id: '7', symbol: 'SPY', type: 'dividend', date: new Date(now.getTime() + 7 * 86400000), label: 'SPY Dividend', impact: 'low' },
    { id: '8', symbol: 'NFP', type: 'nfp', date: new Date(now.getTime() + 1 * 86400000), label: 'Non-Farm Payrolls', impact: 'high' },
  ];
  return events.sort((a, b) => a.date - b.date);
}

export default function EventsCalendarPage() {
  const [expanded, setExpanded] = useState(null);
  const events = useMemo(() => generateEvents(), []);

  return (
    <div className="ec-page">
      <header className="ec-header">
        <h1>Events Calendar</h1>
        <p className="ec-subtitle">{events.length} upcoming events affecting scored symbols. Protocol time-gating preview shows which directives are affected.</p>
      </header>

      {/* Timeline */}
      <div className="ec-timeline">
        <AnimatePresence>
          {events.map((evt, i) => {
            const typeMeta = EVENT_TYPES[evt.type] || { color: '#94a3b8', icon: '📅' };
            const daysUntil = Math.ceil((evt.date - new Date()) / 86400000);
            const isExpanded = expanded === evt.id;
            return (
              <motion.div
                key={evt.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="ec-event"
                style={{ borderLeftColor: typeMeta.color }}
                onClick={() => setExpanded(isExpanded ? null : evt.id)}
              >
                <div className="ec-event-dot" style={{ background: typeMeta.color }} />
                <div className="ec-event-content">
                  <div className="ec-event-header">
                    <span className="ec-event-icon">{typeMeta.icon}</span>
                    <strong>{evt.label}</strong>
                    <span className={`ec-impact ec-impact-${evt.impact}`}>{evt.impact}</span>
                  </div>
                  <div className="ec-event-meta">
                    <span>{evt.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    <span className="ec-countdown">{daysUntil}d away</span>
                    <div className="ec-countdown-bar">
                      <motion.div className="ec-countdown-fill" initial={{ width: 0 }} animate={{ width: `${Math.min(100, Math.max(0, 100 - daysUntil * 5))}%` }}
                        transition={{ duration: 0.5 }} style={{ background: typeMeta.color }} />
                    </div>
                  </div>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div className="ec-expand" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                        <div className="ec-protocol-impact">
                          <strong>Protocol Impact</strong>
                          <p>Directives affected: <code>earnings-proximity</code>{evt.type === 'earnings' ? ', earnings-momentum' : ''}{evt.type === 'fomc' || evt.type === 'cpi' || evt.type === 'nfp' ? ', session-timing-filter' : ''}</p>
                          <p className="ec-impact-note">
                            {evt.type === 'earnings'
                              ? `Earnings proximity directive will reduce ${evt.symbol} score by ~${10 + Math.floor(daysUntil * 2)}% starting ${Math.max(1, daysUntil - 3)} days before.`
                              : `Macro event may increase volatility regime scoring for affected symbols.`}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
