import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './speed-scanner.css';

const SCAN_INTERVALS = [5000, 10000, 15000, 30000, 60000];
const TREND_COLORS = {
  strong: '#22c55e',
  moderate: '#3b82f6',
  weak: '#f59e0b',
  sideways: '#ef4444',
};
const REC_COLORS = {
  trade: '#22c55e',
  caution: '#f59e0b',
  pause: '#ef4444',
};

export default function SpeedScannerPage() {
  const [interval, setInterval] = useState(10000);

  const scanQuery = useQuery({
    queryKey: ['speed', 'scan'],
    queryFn: () => apiPost('/api/speed/scan', { symbols: undefined, timeframe: '5s' }),
    refetchInterval: interval,
  });

  const data = scanQuery.data ?? {};
  const scanned = data.scan ?? [];
  const skipped = data.skipped ?? [];
  const topPick = data.topPick;
  const topPickTrend = data.topPickTrend;
  const nextBest = data.nextBestSymbol;
  const scanMs = data.scanMs;

  const apiOnline = !scanQuery.isError;
  const isLoading = scanQuery.isLoading;

  const stats = useMemo(() => {
    const trending = scanned.filter((s) => s.trend?.clarity === 'strong' || s.trend?.clarity === 'moderate').length;
    const sideways = scanned.filter((s) => s.trend?.sideways).length;
    const trade = scanned.filter((s) => s.trend?.recommendation === 'trade').length;
    return { total: scanned.length, trending, sideways, trade };
  }, [scanned]);

  return (
    <div className="ss-page">
      <motion.header className="ss-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>⚡ Speed Scanner</h1>
          <p className="ss-subtitle">
            Real-time symbol ranking with trend clarity, pattern detection, and trade/pause recommendations.
            {!isLoading && <span> {stats.total} symbols · {stats.trending} trending · {stats.trade} tradeable</span>}
          </p>
        </div>
        <div className="ss-header-right">
          {topPick && (
            <div className="ss-top-pick">
              <span className="ss-top-label">Top Pick</span>
              <span className="ss-top-symbol">{topPick}</span>
              {topPickTrend && <span className="ss-top-trend">{topPickTrend}</span>}
            </div>
          )}
          <select className="ss-interval" value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
            {SCAN_INTERVALS.map((ms) => (
              <option key={ms} value={ms}>Every {ms / 1000}s</option>
            ))}
          </select>
        </div>
      </motion.header>

      {!apiOnline && <ApiOfflineBanner />}
      {isLoading && <LoadingSkeleton variant="text" lines={8} />}

      {/* Summary bar */}
      {!isLoading && (
        <div className="ss-summary">
          <div className="ss-summary-item">
            <span className="ss-summary-label">Scanned</span>
            <span className="ss-summary-value">{stats.total}</span>
          </div>
          <div className="ss-summary-item ss-trending">
            <span className="ss-summary-label">Trending</span>
            <span className="ss-summary-value">{stats.trending}</span>
          </div>
          <div className="ss-summary-item ss-sideways">
            <span className="ss-summary-label">Sideways</span>
            <span className="ss-summary-value">{stats.sideways}</span>
          </div>
          <div className="ss-summary-item ss-tradeable">
            <span className="ss-summary-label">Tradeable</span>
            <span className="ss-summary-value">{stats.trade}</span>
          </div>
          <div className="ss-summary-item">
            <span className="ss-summary-label">Scan time</span>
            <span className="ss-summary-value">{scanMs ?? '—'}ms</span>
          </div>
        </div>
      )}

      {/* Next best alert */}
      {nextBest && topPick && (
        <div className="ss-next-best">
          {(() => {
            const top = scanned.find((s) => s.symbol === topPick);
            const next = scanned.find((s) => s.symbol === nextBest);
            const topSideways = top?.trend?.sideways;
            if (topSideways) {
              return (
                <span className="ss-switch-hint">
                  ⚠️ {topPick} is sideways — consider switching to <strong>{nextBest}</strong>
                  {next?.trend && ` (${next.trend.clarity} ${next.trend.direction}, composite ${next.composite})`}
                </span>
              );
            }
            return (
              <span className="ss-next-hint">
                Next best: <strong>{nextBest}</strong>
                {next?.trend && ` — ${next.trend.clarity} ${next.trend.direction}, composite ${next.composite}`}
              </span>
            );
          })()}
        </div>
      )}

      {/* Symbol ranking */}
      <div className="ss-list">
        {scanned.map((sym, i) => {
          const t = sym.trend ?? {};
          const isTop = sym.symbol === topPick;
          const trendColor = TREND_COLORS[t.clarity] || '#6b7280';
          const recColor = REC_COLORS[t.recommendation] || '#6b7280';

          return (
            <motion.div
              key={sym.symbol}
              className={`ss-row ${isTop ? 'ss-top' : ''} ${t.sideways ? 'ss-sideways-row' : ''}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.02 }}
            >
              {/* Rank */}
              <div className="ss-rank">#{i + 1}</div>

              {/* Symbol & score */}
              <div className="ss-symbol-col">
                <div className="ss-symbol-name">
                  {isTop && '⭐ '}{sym.symbol}
                </div>
                <div className="ss-protocol">{sym.protocol}</div>
              </div>

              {/* Composite score */}
              <div className="ss-score-col">
                <div className="ss-composite">{sym.composite}</div>
                <div className="ss-signal" style={{ color: sym.signal === 'buy' ? '#22c55e' : sym.signal === 'sell' ? '#ef4444' : '#f59e0b' }}>
                  {sym.signal}
                </div>
              </div>

              {/* Trend bar */}
              <div className="ss-trend-col">
                <div className="ss-trend-header">
                  <span className="ss-trend-label" style={{ color: trendColor }}>
                    {t.clarity ?? '—'} {t.direction && t.direction !== 'none' ? (t.direction === 'up' ? '↑' : '↓') : ''}
                  </span>
                  <span className="ss-adx">ADX {t.adx ?? '—'}</span>
                </div>
                <div className="ss-trend-bar">
                  <div
                    className="ss-trend-fill"
                    style={{
                      width: `${Math.min(100, (t.adx ?? 0) * 1.5)}%`,
                      background: trendColor,
                    }}
                  />
                </div>
                <div className="ss-trend-detail">
                  {t.persistence > 0 && <span>{t.persistence} consecutive {t.direction} candles</span>}
                  {t.noiseRatio != null && <span>Noise: {t.noiseRatio}%</span>}
                </div>
              </div>

              {/* Patterns */}
              <div className="ss-pattern-col">
                {t.patternCount > 0 ? (
                  <>
                    <span className="ss-pattern-signal" style={{ color: t.patternSignal === 'bullish' ? '#22c55e' : t.patternSignal === 'bearish' ? '#ef4444' : '#f59e0b' }}>
                      {t.patternSignal}
                    </span>
                    <span className="ss-pattern-count">{t.patternCount} patterns</span>
                    <div className="ss-pattern-types">
                      {(t.patternTypes || []).slice(0, 3).map((pt, pi) => (
                        <span key={pi} className="ss-pattern-tag">{pt}</span>
                      ))}
                      {(t.patternTypes || []).length > 3 && <span className="ss-pattern-more">+{t.patternTypes.length - 3}</span>}
                    </div>
                  </>
                ) : (
                  <span className="ss-no-patterns">—</span>
                )}
              </div>

              {/* Recommendation */}
              <div className="ss-rec-col">
                <span className="ss-rec-badge" style={{ background: recColor + '20', color: recColor, borderColor: recColor }}>
                  {t.recommendation ?? '—'}
                </span>
                {t.recommendationReason && (
                  <span className="ss-rec-reason">{t.recommendationReason}</span>
                )}
              </div>

              {/* Sideways warning */}
              {t.sideways && (
                <div className="ss-sideways-warn">
                  ⚠️ {t.sidewaysReasons?.[0] ?? 'Sideways market'}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Skipped symbols */}
      {skipped.length > 0 && (
        <details className="ss-skipped">
          <summary>{skipped.length} symbols skipped</summary>
          <ul>
            {skipped.map((s) => (
              <li key={s.symbol}>{s.symbol}: {s.reason}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="ss-footer">
        <span>Last scan: {data.scannedAt ? new Date(data.scannedAt).toLocaleTimeString() : '—'}</span>
        {scanQuery.isFetching && <span className="ss-refreshing">⟳ Refreshing...</span>}
      </div>
    </div>
  );
}
