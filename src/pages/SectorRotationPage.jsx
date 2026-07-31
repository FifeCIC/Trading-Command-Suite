import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './sector-rotation.css';
import PageInfoPopover from '../components/PageInfoPopover';

const SECTOR_META = [
  { id: 'xlk', name: 'Technology', etf: 'XLK' },
  { id: 'xlf', name: 'Financials', etf: 'XLF' },
  { id: 'xle', name: 'Energy', etf: 'XLE' },
  { id: 'xlv', name: 'Healthcare', etf: 'XLV' },
  { id: 'xly', name: 'Consumer Disc.', etf: 'XLY' },
  { id: 'xlp', name: 'Consumer Staples', etf: 'XLP' },
  { id: 'xli', name: 'Industrials', etf: 'XLI' },
  { id: 'xlb', name: 'Materials', etf: 'XLB' },
  { id: 'xlre', name: 'Real Estate', etf: 'XLRE' },
  { id: 'xlu', name: 'Utilities', etf: 'XLU' },
  { id: 'xlc', name: 'Communication', etf: 'XLC' },
];

const TIMEFRAMES = [
  { key: 'd1', label: '1 Day' },
  { key: 'w1', label: '1 Week' },
  { key: 'm1', label: '1 Month' },
];

export default function SectorRotationPage() {
  const [sortTf, setSortTf] = useState('m1');

  const { data: perfData, isLoading, isError } = useQuery({
    queryKey: ['sectors', 'rotation'],
    queryFn: () => apiGet('/api/scoring/sectors/rotation'),
    refetchInterval: 120_000,
  });

  const sectorsData = perfData?.sectors || [];
  const protocolMap = perfData?.protocolMap || {};

  const sectors = useMemo(() => {
    return SECTOR_META.map((meta) => {
      const apiSec = sectorsData.find((s) => s.etf === meta.etf);
      return {
        ...meta,
        perf: apiSec?.performance || { d1: 0, w1: 0, m1: 0 },
        momentum: apiSec?.momentum ?? 0,
        trend: apiSec?.trend ?? 0,
        hasData: apiSec?.hasData ?? false,
        bestProtocol: apiSec?.bestProtocol || null,
        protocolScores: apiSec?.protocolScores || [],
      };
    });
  }, [perfData]);

  const sorted = useMemo(() => {
    const arr = [...sectors];
    arr.sort((a, b) => (b.perf[sortTf] ?? 0) - (a.perf[sortTf] ?? 0));
    return arr;
  }, [sectors, sortTf]);

  const hasAnyData = sectors.some((s) => s.hasData);

  // Quadrant chart — scale real percentage returns
  const maxAbs = Math.max(...sectors.map((s) => Math.max(Math.abs(s.momentum), Math.abs(s.trend))), 5);
  const qMin = -maxAbs, qMax = maxAbs, qRange = qMax - qMin || 1;
  const toQuadX = (v) => ((v - qMin) / qRange) * 100;
  const toQuadY = (v) => ((v - qMin) / qRange) * 100;

  return (
    <div className="sr2-page">
      <header className="sr2-header">
        <h1>Sector Rotation
          <PageInfoPopover>
            Track sector performance, momentum, and rotation patterns. Data from sector ETFs.
          </PageInfoPopover>
        </h1>
      </header>

      {isLoading && <LoadingSkeleton variant="card" count={2} />}

      {isError && (
        <div className="sr2-section"><p className="error">Could not load sector data. Is the NestJS API running?</p></div>
      )}

      {!isLoading && !isError && (
      <>
      {/* Quadrant chart */}
      <section className="sr2-section">
        <h2>Rotation Quadrant</h2>
        <p className="sr2-hint">Short-term momentum vs long-term trend. Leading (top-right), Improving (top-left), Weakening (bottom-right), Lagging (bottom-left).</p>
        <div className="sr2-quadrant-wrap">
          <svg viewBox="0 0 100 100" className="sr2-quadrant">
            {/* Quadrant backgrounds */}
            <rect x="0" y="0" width="50" height="50" fill="rgba(34,197,94,0.06)" />      {/* Leading */}
            <rect x="50" y="0" width="50" height="50" fill="rgba(245,158,11,0.04)" />      {/* Improving */}
            <rect x="50" y="50" width="50" height="50" fill="rgba(239,68,68,0.06)" />        {/* Lagging */}
            <rect x="0" y="50" width="50" height="50" fill="rgba(14,165,166,0.04)" />       {/* Weakening */}
            {/* Axes */}
            <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(255,255,255,0.1)" strokeWidth="0.3" />
            <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.1)" strokeWidth="0.3" />
            {/* Labels */}
            <text x="2" y="5" fill="rgba(255,255,255,0.3)" fontSize="2.8">Leading</text>
            <text x="66" y="5" fill="rgba(255,255,255,0.3)" fontSize="2.8">Improving</text>
            <text x="66" y="97" fill="rgba(255,255,255,0.3)" fontSize="2.8">Lagging</text>
            <text x="2" y="97" fill="rgba(255,255,255,0.3)" fontSize="2.8">Weakening</text>
            {/* Axis labels */}
            <text x="48" y="98" fill="rgba(255,255,255,0.2)" fontSize="2.2" textAnchor="end">Momentum →</text>
            <text x="4" y="2" fill="rgba(255,255,255,0.2)" fontSize="2.2" transform="rotate(-90, 4, 2)">Trend →</text>
            {/* Dots */}
            {sectors.map((s) => {
              const cx = toQuadX(s.momentum);
              const cy = 100 - toQuadY(s.trend); // invert Y
              return (
                <g key={s.id}>
                  <circle cx={cx} cy={cy} r="2.5" fill={s.momentum > 0 && s.trend > 0 ? '#22c55e' : s.momentum > 0 ? '#f59e0b' : s.trend > 0 ? '#0ea5a6' : '#ef4444'} opacity="0.9" />
                  <text x={cx + 3} y={cy + 1} fill="rgba(255,255,255,0.7)" fontSize="2.4" fontWeight="600">{s.etf}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </section>

      {/* Performance table */}
      <section className="sr2-section">
        <h2>Sector Performance</h2>
        <div className="sr2-tf-tabs">
          {TIMEFRAMES.map((tf) => (
            <button key={tf.key} type="button" className={`sr2-tf-tab ${sortTf === tf.key ? 'sr2-tf-active' : ''}`} onClick={() => setSortTf(tf.key)}>
              {tf.label}
            </button>
          ))}
        </div>
        <div className="sr2-table-wrap">
          <table className="sr2-table">
            <thead>
              <tr>
                <th>#</th><th>Sector</th><th>ETF</th>
                {TIMEFRAMES.map((tf) => <th key={tf.key} className={`sr2-right ${sortTf === tf.key ? 'sr2-sorted' : ''}`}>{tf.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => (
                <tr key={s.id}>
                  <td className="sr2-rank">{i + 1}</td>
                  <td className="sr2-name">{s.name}</td>
                  <td className="sr2-etf">{s.etf}</td>
                  {TIMEFRAMES.map((tf) => {
                    if (!s.hasData) return <td key={tf.key} className="sr2-right sr2-mono" style={{ color: 'var(--ink-soft)', fontSize: '0.7rem' }}>No data</td>;
                    const v = s.perf[tf.key] ?? 0;
                    const cls = v >= 2 ? 'sr2-up-strong' : v >= 0 ? 'sr2-up' : 'sr2-down';
                    return <td key={tf.key} className={`sr2-right sr2-mono ${cls} ${sortTf === tf.key ? 'sr2-sorted' : ''}`}>{v >= 0 ? '+' : ''}{v.toFixed(1)}%</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Protocol Stratification */}
      <section className="sr2-section">
        <h2>Protocol Stratification</h2>
        <p className="sr2-hint">Which scoring protocols perform best per sector. Shows best protocol for each sector and the score it assigns.</p>
        <div className="sr2-table-wrap">
          <table className="sr2-table">
            <thead>
              <tr>
                <th>Sector</th>
                <th>ETF</th>
                <th>Best Protocol</th>
                <th>Score</th>
                <th>All Protocols</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.id}>
                  <td className="sr2-name">{s.name}</td>
                  <td className="sr2-etf">{s.etf}</td>
                  <td>
                    {s.bestProtocol ? (
                      <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{s.bestProtocol.name}</span>
                    ) : <span className="sr2-down">No data</span>}
                  </td>
                  <td className="sr2-mono">
                    {s.bestProtocol ? (
                      <span className={s.bestProtocol.score >= 65 ? 'sr2-up-strong' : s.bestProtocol.score >= 40 ? 'sr2-up' : 'sr2-down'}>
                        {s.bestProtocol.score.toFixed(0)}
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {s.protocolScores.map((ps) => (
                        <span key={ps.protocolId}
                          className={ps.score >= 65 ? 'sr2-up-strong' : ps.score >= 40 ? 'sr2-up' : 'sr2-down'}
                          style={{ fontSize: '0.6rem', padding: '1px 5px', borderRadius: 3, border: '1px solid currentColor', opacity: 0.85 }}
                          title={`${ps.protocolName}: ${ps.score.toFixed(0)} — ${ps.signal}`}>
                          {ps.protocolName.replace(/ V\d+$/, '')}: {ps.score.toFixed(0)}
                        </span>
                      ))}
                      {s.protocolScores.length === 0 && s.hasData && <span className="sr2-hint">No protocols match</span>}
                      {!s.hasData && <span className="sr2-hint">No market data</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      </>
      )}
    </div>
  );
}
