import { useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './portfolio-events.css';

export default function PortfolioEventsPage() {
  const eventsQuery = useQuery({
    queryKey: ['portfolio', 'events'],
    queryFn: () => apiGet('/api/portfolio/events?days=90'),
    refetchInterval: 300000,
  });

  const apiOnline = !eventsQuery.isError;
  const data = eventsQuery.data ?? {};
  const upcoming = data.upcomingEvents ?? [];
  const nextEarnings = data.nextEarnings;
  const noData = data.noData ?? [];

  const isLoading = eventsQuery.isLoading;
  const isEmpty = !isLoading && upcoming.length === 0;

  return (
    <div className="pe-page">
      <motion.header className="pe-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>📅 Portfolio Events</h1>
          <p className="pe-subtitle">
            {upcoming.length > 0
              ? `${upcoming.length} positions with upcoming events in the next 90 days`
              : 'Cross-reference portfolio holdings with upcoming earnings and events'}
          </p>
        </div>
        {nextEarnings && (
          <div className="pe-next">
            <span className="pe-next-label">Next Earnings</span>
            <span className="pe-next-symbol">{nextEarnings.symbol}</span>
            <span className="pe-next-days">{nextEarnings.daysUntil} days</span>
            <span className="pe-next-date">{nextEarnings.date}</span>
          </div>
        )}
      </motion.header>

      {!apiOnline && <ApiOfflineBanner />}
      {isLoading && <LoadingSkeleton variant="text" lines={6} />}

      {isEmpty && (
        <div className="pe-empty">
          <p>No upcoming earnings events found for your portfolio positions.</p>
          <p className="pe-hint">Import your Trading212 portfolio to cross-reference with earnings data.</p>
        </div>
      )}

      {!isEmpty && (
        <div className="pe-list">
          {upcoming.map((item, i) => (
            <motion.div
              key={item.symbol}
              className="pe-card"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <div className="pe-card-header">
                <span className="pe-symbol">{item.symbol}</span>
                {item.position && (
                  <span className="pe-position">
                    {item.position.shares} shares · ${item.position.value?.toFixed(0)}
                  </span>
                )}
              </div>
              <div className="pe-events">
                {item.events.map((ev, j) => (
                  <div key={j} className="pe-event">
                    <span className="pe-event-type">{ev.type}</span>
                    <span className="pe-event-date">{ev.date}</span>
                    <span className="pe-event-days">{ev.daysUntil}d</span>
                    {ev.epsEstimate && <span className="pe-event-eps">EPS: ${ev.epsEstimate}</span>}
                    {ev.time && <span className="pe-event-time">{ev.time}</span>}
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {noData.length > 0 && (
        <div className="pe-nodata">
          <span>No earnings data for: {noData.join(', ')}</span>
        </div>
      )}
    </div>
  );
}