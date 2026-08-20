import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './speed-scanner.css';
import '../components/signal-badge.css';

const SCAN_INTERVALS = [5000, 10000, 15000, 30000, 60000];
const TREND_COLORS = {
  strong: '#22c55e',
  moderate: '#3b82f6',
  weak: '#f59e0b',
  sideways: '#ef4444',
};
// Map a recommendation to the shared badge tone (see signal-badge.css).
// The tone classes own the colours — no local hex map, so the theme stays unified.
const REC_TONES = {
  trade: 'trade',
  caution: 'caution',
  pause: 'no-trade',
};

export default function SpeedScannerPage() {
  const [interval, setInterval] = useState(10000);
  const [sortBy, setSortBy] = useState('composite');
  const [filterRec, setFilterRec] = useState('all');
  const [filterSignal, setFilterSignal] = useState('all');
  const [tradeMode, setTradeMode] = useState(() => {
    try { return localStorage.getItem('ss-trade-mode') || 'quick-trade'; }
    catch { return 'quick-trade'; }
  });
  const [tradeResult, setTradeResult] = useState(null);
  const queryClient = useQueryClient();

  // Read "Include Inactive Protocols" from Screen Options preference
  const includeInactive = (() => {
    try { return localStorage.getItem('ss-include-inactive') === 'true'; }
    catch { return false; }
  })();

  const scanQuery = useQuery({
    queryKey: ['speed', 'scan'],
    queryFn: () => apiPost('/api/speed/scan', { symbols: undefined, timeframe: '5s' }),
    refetchInterval: interval,
  });

  const tradeMutation = useMutation({
    mutationFn: (body) => apiPost('/api/speed/trade', body),
    onSuccess: (result) => {
      setTradeResult(result);
      if (result?.status === 'EXECUTED' || result?.status === 'QUEUED_FOR_AUTOMATION') {
        queryClient.invalidateQueries({ queryKey: ['speed', 'scan'] });
      }
    },
    onSettled: () => {
      setTimeout(() => setTradeResult(null), 5000);
    },
  });

  const handleTrade = (symbol, mode = 'quick-trade') => {
    setTradeResult(null);
    tradeMutation.mutate({ symbol, mode });
  };

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

  // Sort + filter
  const CLARITY_ORDER = { strong: 3, moderate: 2, weak: 1 };
  const sortedScanned = useMemo(() => {
    let list = [...scanned];

    // Filter by recommendation
    if (filterRec === 'trade') list = list.filter(s => s.trend?.recommendation === 'trade');
    else if (filterRec === 'actionable') list = list.filter(s => s.trend?.recommendation !== 'pause');
    else if (filterRec === 'not-pause') list = list.filter(s => s.trend?.recommendation !== 'pause');

    // Filter by signal
    if (filterSignal === 'buy') list = list.filter(s => s.signal === 'buy');
    else if (filterSignal === 'sell') list = list.filter(s => s.signal === 'sell');

    // Filter inactive protocols (unless explicitly included)
    if (!includeInactive) list = list.filter(s => s.protocolActive !== false);

    // Sort
    switch (sortBy) {
      case 'adx': list.sort((a, b) => (b.trend?.adx || 0) - (a.trend?.adx || 0)); break;
      case 'patterns': list.sort((a, b) => (b.trend?.patternCount || 0) - (a.trend?.patternCount || 0)); break;
      case 'clarity': list.sort((a, b) => (CLARITY_ORDER[b.trend?.clarity] || 0) - (CLARITY_ORDER[a.trend?.clarity] || 0)); break;
      case 'composite':
      default: list.sort((a, b) => (b.composite || 0) - (a.composite || 0)); break;
    }
    return list;
  }, [scanned, sortBy, filterRec, filterSignal]);

  return (
    <div className="ss-page" aria-live="polite" aria-atomic="true">
      <motion.header className="ss-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>⚡ Speed Scanner</h1>
          <p className="ss-subtitle">
            Real-time symbol ranking with trend clarity, pattern detection, and trade/pause recommendations.
            {!isLoading && <span> {stats.total} symbols · {stats.trending} trending · {stats.trade} tradeable</span>}
            {apiOnline && (
              <span className="ss-live-badge" title="Live market data pipeline: MT5 candles → SpeedScanService → directive scoring → trend detection → trade/pause recommendation">
                <span className="ss-live-dot" /> Live Data
              </span>
            )}
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
        <>
          {tradeResult && (
            <div className={`ss-trade-result ${tradeResult.status === 'EXECUTED' || tradeResult.status === 'QUEUED_FOR_AUTOMATION' ? 'ss-trade-success' : 'ss-trade-error'}`}>
              {tradeResult.status === 'EXECUTED' && <span>✅ Trade executed: {tradeResult.symbol} @ {tradeResult.price} — Order #{tradeResult.orderId}</span>}
              {tradeResult.status === 'QUEUED_FOR_AUTOMATION' && <span>🤖 Queued: {tradeResult.symbol} — will execute on next loop ({tradeResult.protocol || 'default'} protocol)</span>}
              {tradeResult.status === 'DUPLICATE' && <span>⚠️ {tradeResult.message}</span>}
              {tradeResult.status === 'ERROR' && <span>❌ {tradeResult.message}</span>}
              {tradeResult.status === 'ONE_CLICK_READY' && <span>🎯 Ready: {tradeResult.symbol} — {tradeResult.executeAction || 'confirm in terminal'}</span>}
              {tradeResult.status === 'KEYBOARD_READY' && <span>⌨️ {tradeResult.symbol} mapped to {tradeResult.hotkey || 'default key'} — press to execute</span>}
            </div>
          )}
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
        </>
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

      {/* Sort & Filter bar */}
      {!isLoading && scanned.length > 0 && (
        <div className="ss-filter-bar">
          <div className="ss-filter-group">
            <span className="ss-filter-label">Sort:</span>
            {[
              { key: 'composite', label: 'Score' },
              { key: 'adx', label: 'ADX' },
              { key: 'patterns', label: 'Patterns' },
              { key: 'clarity', label: 'Clarity' },
            ].map(s => (
              <button key={s.key} className={`ss-filter-chip ${sortBy === s.key ? 'ss-filter-active' : ''}`} onClick={() => setSortBy(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="ss-filter-group">
            <span className="ss-filter-label">Rec:</span>
            {[
              { key: 'all', label: 'All' },
              { key: 'trade', label: 'Trade' },
              { key: 'actionable', label: 'Actionable' },
            ].map(f => (
              <button key={f.key} className={`ss-filter-chip ${filterRec === f.key ? 'ss-filter-active' : ''}`} onClick={() => setFilterRec(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="ss-filter-group">
            <span className="ss-filter-label">Signal:</span>
            {[
              { key: 'all', label: 'All' },
              { key: 'buy', label: 'Buy' },
              { key: 'sell', label: 'Sell' },
            ].map(f => (
              <button key={f.key} className={`ss-filter-chip ${filterSignal === f.key ? 'ss-filter-active' : ''}`} onClick={() => setFilterSignal(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <span className="ss-filter-count">{sortedScanned.length} of {scanned.length} symbols</span>
        </div>
      )}

      {/* Symbol ranking */}
      <div className="ss-list">
        {sortedScanned.map((sym, i) => {
          const t = sym.trend ?? {};
          const isTop = sym.symbol === topPick;
          const trendColor = TREND_COLORS[t.clarity] || '#6b7280';
          const recTone = REC_TONES[t.recommendation] || 'muted';

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
                <span className={`signal-badge signal-badge--${recTone}`}>
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

              {/* Trade action */}
              <div className="ss-trade-col">
                {t.recommendation === 'trade' ? (
                  <button
                    className={`ss-trade-btn ${tradeMutation.isPending && tradeMutation.variables?.symbol === sym.symbol ? 'ss-trade-loading' : ''}`}
                    onClick={() => handleTrade(sym.symbol, tradeMode)}
                    disabled={tradeMutation.isPending}
                    title={`${tradeMode} ${sym.symbol}`}
                  >
                    {tradeMutation.isPending && tradeMutation.variables?.symbol === sym.symbol ? '⟳' : tradeMode === 'quick-trade' ? '⚡' : tradeMode === 'one-click' ? '🎯' : tradeMode === 'automation' ? '🤖' : '⌨️'}
                  </button>
                ) : (
                  <span className="ss-trade-disabled" title="Only tradeable symbols">—</span>
                )}
              </div>
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
