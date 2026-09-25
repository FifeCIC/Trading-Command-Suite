/**
 * RecentlyAnalysedSymbolsPage — Symbol Analysis History
 * ======================================================
 * Shows recently scored symbols with latest scores, confidence,
 * signal, and analysis time. Replaces the plugin skeleton.
 * Route: /analysis/recently-analysed-symbols
 */
import { useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './recently-analysed.css';
import PageInfoPopover from '../components/PageInfoPopover';

const SIGNAL_CONFIG = {
  entry:     { label: 'Entry',     color: '#22c55e', bg: '#22c55e18' },
  watch:     { label: 'Watch',     color: '#f59e0b', bg: '#f59e0b18' },
  defensive: { label: 'Defensive', color: '#94a3b8', bg: '#94a3b818' },
};

import { timeAgo } from '../core/format-utils';
export default function RecentlyAnalysedSymbolsPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['recently-analysed'],
    queryFn: () => apiGet('/api/scoring/recently-analysed?limit=50'),
    refetchInterval: 60_000,
  });

  const symbols = useMemo(() => {
    return Array.isArray(data) ? data : [];
  }, [data]);

  if (isLoading) return (
    <div className="ra-page">
      <header className="ra-header"><h1>Recently Analysed Symbols</h1></header>
      <LoadingSkeleton variant="table" rows={8} cols={5} />
    </div>
  );

  return (
    <div className="ra-page">
      <header className="ra-header">
        <div>
          <h1>Recently Analysed Symbols
          <PageInfoPopover>
            {/* §9.14.1 — 'SEES' is the scoring engine's name and the free edition does not carry the
                method's vocabulary. Conditional, so the full edition keeps its own term. */}
            Symbols most recently scored by the{' '}
            {import.meta.env.VITE_EDITION === 'free' ? 'scoring pipeline' : 'SEES pipeline'}
            {' '}— ordered by analysis time
          </PageInfoPopover>
        </h1>
        </div>
        <button className="ra-refresh-btn" onClick={() => refetch()}>↻ Refresh</button>
      </header>

      {isError && <ApiOfflineBanner />}

      {symbols.length === 0 ? (
        <div className="ra-empty">
          <p>No symbols have been analysed yet.</p>
          <p className="ra-empty-hint">Scoring runs will populate this list automatically. Trigger a scoring run or wait for the next scheduled run.</p>
        </div>
      ) : (
        <motion.div className="ra-table-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <table className="ra-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Latest Score</th>
                <th>Confidence</th>
                <th>Signal</th>
                <th>Runs</th>
                <th>Last Analysed</th>
              </tr>
            </thead>
            <tbody>
              {symbols.map((s, i) => {
                const sig = SIGNAL_CONFIG[s.signal] || SIGNAL_CONFIG.defensive;
                return (
                  <motion.tr key={s.symbolId}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                  >
                    <td><strong className="ra-ticker">{s.ticker}</strong></td>
                    <td className="ra-num" style={{ color: s.latestScore >= 60 ? '#22c55e' : s.latestScore >= 40 ? '#f59e0b' : '#ef4444' }}>
                      {s.latestScore.toFixed(1)}
                    </td>
                    <td className="ra-num">{s.latestConfidence > 0 ? `${s.latestConfidence}%` : '—'}</td>
                    <td>
                      <span className="ra-signal-chip" style={{ color: sig.color, background: sig.bg }}>
                        {sig.label}
                      </span>
                    </td>
                    <td className="ra-num">{s.totalRuns}</td>
                    <td className="ra-time">{timeAgo(s.lastAnalysedAt)}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </motion.div>
      )}
    </div>
  );
}
