import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './market-correlations.css';

const DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'GLD', 'SLV', 'XLK', 'XLF', 'XLE', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'EURUSD', 'XAUUSD'];

function corrColor(v) {
  if (v >= 0.7) return '#22c55e';
  if (v >= 0.4) return '#4ade80';
  if (v >= 0.1) return '#86efac';
  if (v >= -0.1) return '#475569';
  if (v >= -0.4) return '#fca5a5';
  return '#ef4444';
}

export default function MarketCorrelationsPage() {
  const [pairA, setPairA] = useState('SPY');
  const [pairB, setPairB] = useState('QQQ');

  const matrixQuery = useQuery({
    queryKey: ['correlation', 'matrix'],
    queryFn: () => apiGet('/api/portfolio/correlation'),
    refetchInterval: 300000,
  });

  const matrixData = matrixQuery.data;
  const symbols = matrixData?.symbols?.length ? matrixData.symbols.slice(0, 15) : DEFAULT_SYMBOLS;
  const flags = matrixData?.flags ?? [];
  const isLoading = matrixQuery.isLoading;
  const isError = matrixQuery.isError;

  // Pair correlation derived from matrix — no separate API call
  const getPairCorr = (a, b) => {
    if (!matrixData?.symbols || !matrixData?.matrix) return null;
    const ai = matrixData.symbols.indexOf(a);
    const bi = matrixData.symbols.indexOf(b);
    if (ai === -1 || bi === -1) return null;
    return matrixData.matrix[ai]?.[bi] ?? null;
  };
  const pairCorr = getPairCorr(pairA, pairB);

  return (
    <div className="mc-page">
      <header className="mc-header">
        <h1>Market Correlations</h1>
        <p className="mc-subtitle">
          Real Pearson correlation matrix from 90-day market data.
          {!isLoading && matrixData?.computedAt && <span> Updated {new Date(matrixData.computedAt).toLocaleString()}</span>}
        </p>
      </header>

      {isError && <ApiOfflineBanner />}
      {isLoading && <LoadingSkeleton variant="card" count={3} />}

      {!isLoading && !isError && (
      <section className="mc-section">
        <h2>Correlation Matrix <span className="mc-tf-label">— 90-day Pearson from live market data</span></h2>
        <div className="mc-heatmap-wrap">
          <table className="mc-heatmap">
            <thead><tr><th></th>{symbols.map((s) => <th key={s}>{s}</th>)}</tr></thead>
            <tbody>
              {symbols.map((row, ri) => (
                <tr key={row}><th>{row}</th>
                  {symbols.map((col, ci) => {
                    const isDiag = row === col;
                    const v = isDiag ? 1 : (matrixData?.matrix?.[ri]?.[ci] ?? null);
                    const displayV = v !== null ? v.toFixed(2) : '—';
                    const bg = v !== null ? corrColor(v) : 'transparent';
                    return (
                      <td key={col} className={`mc-cell ${isDiag ? 'mc-diag' : ''}`}
                        style={{ backgroundColor: isDiag ? 'transparent' : bg, color: isDiag ? 'var(--ink-soft)' : (v !== null && Math.abs(v) > 0.4) ? '#fff' : 'var(--ink)' }}
                        title={`${row} ↔ ${col}: ${displayV}`}>{displayV}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>)}

      {!isLoading && !isError && (
      <section className="mc-section">
        <h2>Pair Comparison</h2>
        <div className="mc-pair-controls">
          <select value={pairA} onChange={(e) => setPairA(e.target.value)}>{symbols.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <span className="mc-pair-vs">vs</span>
          <select value={pairB} onChange={(e) => setPairB(e.target.value)}>{symbols.filter(s => s !== pairA).map((s) => <option key={s} value={s}>{s}</option>)}</select>
          {isLoading && <span className="mc-loading">Loading...</span>}
        </div>

        {pairCorr !== null ? (
          <div className="mc-pair-result">
            <div className="mc-pair-score" style={{ color: corrColor(pairCorr) }}>
              <span className="mc-pair-value">{pairCorr.toFixed(3)}</span>
              <span className="mc-pair-label">
                {pairCorr >= 0.7 ? 'Strong Positive' : pairCorr >= 0.3 ? 'Moderate Positive' : pairCorr >= -0.3 ? 'Weak/No Correlation' : pairCorr >= -0.7 ? 'Moderate Negative' : 'Strong Negative'}
              </span>
            </div>
            <p className="mc-pair-explanation">
              {pairCorr >= 0.7 ? `⚠️ ${pairA} and ${pairB} move together strongly. Holding both amplifies exposure — treat as one position for risk sizing.`
               : pairCorr >= 0.3 ? `${pairA} and ${pairB} have moderate positive correlation. Consider reducing combined allocation.`
               : pairCorr >= -0.3 ? `${pairA} and ${pairB} move independently — good diversification.`
               : pairCorr >= -0.7 ? `${pairA} and ${pairB} move opposite — useful partial hedge.`
               : `🔒 ${pairA} and ${pairB} are strongly inversely correlated — hedge pairing.`}
            </p>
          </div>
        ) : (
          <p className="mc-no-data">Correlation not yet computed for this pair. Import market data or run the daily correlation cron.</p>
        )}
      </section>)}

      {!isLoading && !isError && flags.length > 0 && (
      <section className="mc-section">
        <h2>Position Risk Flags <span className="mc-tf-label">{flags.length} pair(s)</span></h2>
        {/* Tidied 2026-10-06. Owner (Page Walkthrough, /research/market-correlations): *"Tidy up this
            list"*. It was one unaligned flex row per pair, so the correlation numbers never lined up
            down the column and the warning text started wherever the pair name happened to end — three
            facts per row with no columns to read them down. Now a grid with a header, so the list can
            be SCANNED rather than read. */}
        <div className="mc-flags">
          <div className="mc-flag mc-flag--head" aria-hidden="true">
            <span>Pair</span>
            <span>Corr</span>
            <span>Why it is flagged</span>
          </div>
          {flags.map((f, i) => (
            <div key={i} className="mc-flag">
              <span className="mc-flag-pair">{f.pair}</span>
              <span className="mc-flag-corr" style={{ color: corrColor(f.correlation) }}>{f.correlation.toFixed(2)}</span>
              <span className="mc-flag-warn">{f.warning}</span>
            </div>
          ))}
        </div>
      </section>)}

      <div className="mc-footer-note">
        <p>💡 90-day rolling Pearson correlation on daily closes. +1 = move together (low diversification). -1 = move opposite (hedging). 0 = independent.</p>
      </div>
    </div>
  );
}
