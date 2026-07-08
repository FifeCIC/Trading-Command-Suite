import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import './events-calendar.css';

const EVENT_TYPES = {
  earnings: { color: '#3b82f6', icon: '📊' },
  fomc: { color: '#8b5cf6', icon: '🏛️' },
  cpi: { color: '#f59e0b', icon: '📈' },
  nfp: { color: '#f59e0b', icon: '👷' },
  gdp: { color: '#06b6d4', icon: '📉' },
  dividend: { color: '#22c55e', icon: '💰' },
  economic: { color: '#8b5cf6', icon: '🏛️' },
  default: { color: '#94a3b8', icon: '📅' },
};

const SOURCE_LINKS = {
  fomc: { label: 'Federal Reserve', url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' },
  cpi: { label: 'BLS CPI', url: 'https://www.bls.gov/news.release/cpi.toc.htm' },
  nfp: { label: 'BLS Employment', url: 'https://www.bls.gov/news.release/empsit.toc.htm' },
  gdp: { label: 'BEA GDP', url: 'https://www.bea.gov/data/gdp/gross-domestic-product' },
  economic: { label: 'Investing.com Calendar', url: 'https://www.investing.com/economic-calendar/' },
};

function mapEventType(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('earnings')) return 'earnings';
  if (t.includes('fomc') || t.includes('rate')) return 'fomc';
  if (t.includes('cpi') || t.includes('inflation')) return 'cpi';
  if (t.includes('nfp') || t.includes('payroll')) return 'nfp';
  if (t.includes('gdp')) return 'gdp';
  if (t.includes('dividend')) return 'dividend';
  return 'economic';
}

export default function EventsCalendarPage() {
  const [expanded, setExpanded] = useState(null);

  // Real earnings from Finnhub
  const earningsQuery = useQuery({
    queryKey: ['events', 'earnings'],
    queryFn: () => apiGet('/api/research/earnings/calendar'),
    staleTime: 300_000,
  });

  // Real macro events from timeline
  const timelineQuery = useQuery({
    queryKey: ['events', 'timeline'],
    queryFn: () => apiGet('/api/automation/timeline?lookahead=240'),
    staleTime: 300_000,
  });

  // Portfolio positions for cross-reference
  const portfolioQuery = useQuery({
    queryKey: ['events', 'portfolio'],
    queryFn: () => apiGet('/api/portfolio'),
    staleTime: 120_000,
  });

  const isLoading = earningsQuery.isLoading && timelineQuery.isLoading;

  const heldSymbols = useMemo(() => {
    const positions = portfolioQuery.data?.positions || portfolioQuery.data || [];
    if (!Array.isArray(positions)) return new Set();
    return new Set(positions.map(p => (p.symbol || '').toUpperCase()).filter(Boolean));
  }, [portfolioQuery.data]);

  const events = useMemo(() => {
    const all = [];

    // Map earnings events
    const earningsData = earningsQuery.data?.events || earningsQuery.data || [];
    if (Array.isArray(earningsData)) {
      for (const e of earningsData) {
        all.push({
          id: `earn-${e.symbol || e.ticker}-${e.date || e.earningsDate}`,
          symbol: e.symbol || e.ticker || '?',
          type: 'earnings',
          date: new Date(e.date || e.earningsDate),
          label: `${e.symbol || e.ticker || '?'} Earnings`,
          impact: 'high',
        });
      }
    }

    // Map timeline macro events
    const timelineEvents = timelineQuery.data?.events || timelineQuery.data || [];
    if (Array.isArray(timelineEvents)) {
      for (const ev of timelineEvents) {
        const date = new Date(ev.startsAt || ev.date || ev.timestamp);
        if (isNaN(date.getTime())) continue;
        all.push({
          id: `macro-${ev.id || ev.label || Math.random()}`,
          symbol: ev.label?.split(' ')[0] || 'MACRO',
          type: mapEventType(ev.type || ev.label),
          date,
          label: ev.label || ev.description || 'Economic Event',
          impact: ev.impact || 'medium',
          description: ev.description,
          affectsPositions: ev.affectsPositions,
        });
      }
    }

    // Sort by date, future only
    const now = new Date();
    return all
      .filter(e => e.date >= now)
      .sort((a, b) => a.date - b.date)
      .slice(0, 30);
  }, [earningsQuery.data, timelineQuery.data]);

  return (
    <div className="ec-page">
      <header className="ec-header">
        <h1>Events Calendar</h1>
        <p className="ec-subtitle">
          {events.length} upcoming events from Finnhub earnings + timeline. Protocol time-gating preview shows which directives are affected.
        </p>
      </header>

      {isLoading ? (
        <LoadingSkeleton variant="card" count={5} />
      ) : events.length === 0 ? (
        <EmptyState icon="📅" title="No upcoming events" description="Earnings and macro events will appear here when data is available." />
      ) : (
      /* Timeline */
      <div className="ec-timeline">
        <AnimatePresence>
          {events.map((evt, i) => {
            const typeMeta = EVENT_TYPES[evt.type] || EVENT_TYPES.default;
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
                    {heldSymbols.has(evt.symbol?.toUpperCase()) && <span className="ec-held-badge" title="You hold this symbol">🎯 Held</span>}
                    <span className={`ec-impact ec-impact-${evt.impact}`}>{evt.impact}</span>
                  </div>
                  <div className="ec-event-meta">
                    <span>{evt.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    <span className="ec-countdown">{daysUntil}d away</span>
                    <div className="ec-countdown-bar">
                      <motion.div
                        className="ec-countdown-fill"
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, Math.max(0, 100 - daysUntil * 5))}%` }}
                        transition={{ duration: 0.5 }}
                        style={{ background: typeMeta.color }}
                      />
                    </div>
                  </div>
                  {evt.affectsPositions?.length > 0 && (
                    <div className="ec-affects">
                      🎯 Affects: {evt.affectsPositions.join(', ')}
                    </div>
                  )}

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div className="ec-expand" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                        <div className="ec-protocol-impact">
                          <strong>Protocol Impact</strong>
                          <p>Directives affected: <code>earnings-proximity</code>{evt.type === 'earnings' ? ', earnings-momentum' : ''}{evt.type === 'fomc' || evt.type === 'cpi' || evt.type === 'nfp' ? ', session-timing-filter' : ''}</p>
                          <p className="ec-impact-note">
                            {evt.type === 'earnings'
                              ? `${evt.symbol} earnings will affect scoring proximity. Earnings proximity directive reduces score as the date approaches.`
                              : evt.description || 'Macro event may increase volatility regime scoring for affected symbols.'}
                          </p>
                          {SOURCE_LINKS[evt.type] && (
                            <a className="ec-source-link" href={SOURCE_LINKS[evt.type].url} target="_blank" rel="noopener noreferrer">
                              🔗 {SOURCE_LINKS[evt.type].label} →
                            </a>
                          )}
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
      )}
    </div>
  );
}
