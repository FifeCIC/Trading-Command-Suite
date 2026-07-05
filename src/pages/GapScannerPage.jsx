/**
 * GapScannerPage — Pre-Market Gap Scanner
 * =======================================
 * Analyses pre-market gaps for selected symbols using the
 * gap-scanner directive from the SEES scoring pipeline.
 * Route: /research/gap-scanner
 */
import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './gap-scanner.css';

const DEFAULT_SYMBOLS = 'AAPL,NVDA,TSLA,MSFT,AMD,SPY,QQQ,META,GOOGL,AMZN';

function GapCard({ symbol, data }) {
  if (!data) return null;

  const gapDirective = (data.breakdown || []).find(d => d.directiveId === 'gap-scanner');
  if (!gapDirective) return null;

  const score = gapDirective.score;
  const reason = gapDirective.reason || '';
  const signalClass = gapDirective.signalClass || 'neutral';

  // Parse gap info from reason string
  const gapMatch = reason.match(/Gap\s+(up|down|none)/i);
  const pctMatch = reason.match(/([\d.]+)%/);
  const gapType = gapMatch ? gapMatch[1].toLowerCase() : 'none';
  const gapPct = pctMatch ? parseFloat(pctMatch[1]) : 0;

  const isGapUp = gapType === 'up';
  const isGapDown = gapType === 'down';
  const hasGap = isGapUp || isGapDown;

  const color = isGapUp ? '#22c55e' : isGapDown ? '#ef4444' : '#94a3b8';
  const bg = isGapUp ? '#22c55e12' : isGapDown ? '#ef444412' : '#94a3b812';
  const icon = isGapUp ? '▲' : isGapDown ? '▼' : '—';

  return (
    <motion.div className="gs-card" style={{ borderColor: color, background: bg }}
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
    >
      <div className="gs-card-head">
        <span className="gs-symbol">{symbol}</span>
        <span className="gs-icon" style={{ color }}>{icon}</span>
      </div>
      <div className="gs-card-body">
        <div className="gs-stat">
          <span className="gs-stat-label">Gap</span>
          <span className="gs-stat-val" style={{ color }}>
            {hasGap ? `${gapType} ${gapPct.toFixed(1)}%` : 'None'}
          </span>
        </div>
        <div className="gs-stat">
          <span className="gs-stat-label">Score</span>
          <span className="gs-stat-val" style={{ color: score >= 60 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#94a3b8' }}>
            {score.toFixed(0)}/100
          </span>
        </div>
        <div className="gs-stat">
          <span className="gs-stat-label">Signal</span>
          <span className={`gs-signal gs-sig-${signalClass}`}>{signalClass}</span>
        </div>
      </div>
      <div className="gs-reason">{reason}</div>
    </motion.div>
  );
}

export default function GapScannerPage() {
  const [input, setInput] = useState(DEFAULT_SYMBOLS);
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSymbols(input);
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['gap-scanner', symbols],
    queryFn: () => apiGet(`/api/scoring/ranked?limit=50`),
    refetchInterval: 120_000,
  });

  const ranked = Array.isArray(data?.ranked) ? data.ranked : [];
  const requestedSymbols = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

  const results = useMemo(() => {
    return requestedSymbols.map(sym => {
      const match = ranked.find(r => r.ticker === sym);
      return { symbol: sym, data: match || null };
    });
  }, [ranked, requestedSymbols]);

  const gapsFound = results.filter(r => {
    const gd = r.data?.breakdown?.find(d => d.directiveId === 'gap-scanner');
    return gd && gd.score > 0;
  }).length;

  return (
    <div className="gs-page">
      <header className="gs-header">
        <div>
          <h1>Gap Scanner</h1>
          <p className="gs-subtitle">Pre-market gap analysis — powered by the gap-scanner directive in the SEES pipeline</p>
        </div>
        <button className="gs-refresh-btn" onClick={() => refetch()}>↻ Refresh</button>
      </header>

      <form className="gs-form" onSubmit={handleSubmit}>
        <input
          className="gs-input"
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Symbols (comma-separated)"
        />
        <button className="gs-btn" type="submit" disabled={isLoading}>Scan</button>
      </form>

      {isError && <ApiOfflineBanner />}

      {isLoading ? (
        <LoadingSkeleton variant="card" count={4} />
      ) : (
        <>
          <div className="gs-summary">
            {results.length} symbols scanned · {gapsFound} gaps detected
          </div>
          <div className="gs-grid">
            {results.map(r => (
              <GapCard key={r.symbol} symbol={r.symbol} data={r.data} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
