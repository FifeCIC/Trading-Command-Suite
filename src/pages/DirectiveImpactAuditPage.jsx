/**
 * Directive Impact Audit Page — #283
 * ===================================
 * Ranks directives by real-world impact: which ones contribute the most
 * AND move the most with the market. Use to identify heavyweight directives
 * for building high-swing protocols.
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import Notice from '../components/Notice';
import './directive-impact-audit.css';

const TIER_COLORS = {
  heavyweight: { bg: '#7c3aed', text: '#ede9fe', label: 'Heavyweight' },
  mover: { bg: '#2563eb', text: '#dbeafe', label: 'Mover' },
  steady: { bg: '#0891b2', text: '#cffafe', label: 'Steady' },
  lightweight: { bg: '#64748b', text: '#e2e8f0', label: 'Lightweight' },
};

const READINESS_COLORS = {
  ready: '#22c55e',
  bravo: '#f59e0b',
  alpha: '#ef4444',
};

export default function DirectiveImpactAuditPage() {
  const [searchParams] = useSearchParams();
  const symbolParam = searchParams.get('symbol')?.toUpperCase();
  const [symbol, setSymbol] = useState(symbolParam || 'XAUUSD');
  const [windowSize, setWindowSize] = useState(10);
  const [sortBy, setSortBy] = useState('impactScore');
  const [tierFilter, setTierFilter] = useState('all');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['directive-impact', symbol, windowSize],
    queryFn: () => apiGet(`/api/scoring/directive-impact/${symbol}?window=${windowSize}`).catch(() => null),
    refetchInterval: 60_000,
    enabled: !!symbol,
  });

  const report = data;

  const filteredDirectives = useMemo(() => {
    if (!report?.directives) return [];
    let list = [...report.directives];
    if (tierFilter !== 'all') {
      list = list.filter(d => d.tier === tierFilter);
    }
    list.sort((a, b) => {
      if (sortBy === 'impactScore') return b.impactScore - a.impactScore;
      if (sortBy === 'avgContribution') return b.avgContribution - a.avgContribution;
      if (sortBy === 'volatility') return b.volatility - a.volatility;
      if (sortBy === 'hitRate') return b.hitRate - a.hitRate;
      if (sortBy === 'trend') return b.trend - a.trend;
      return 0;
    });
    return list;
  }, [report, sortBy, tierFilter]);

  const maxImpact = filteredDirectives.length > 0 ? filteredDirectives[0]?.impactScore || 1 : 1;

  return (
    <div className="dia-page">
      <motion.header className="dia-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Directive Impact Audit</h1>
          <p className="muted">
            Rank directives by real-world impact — avg contribution &times; volatility.
            Heavyweights are the directives that matter most for protocol building.
          </p>
        </div>
      </motion.header>

      {/* ── Controls ── */}
      <motion.div className="dia-controls" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
        <div className="dia-control-group">
          <label>Symbol</label>
          <input
            type="text"
            value={symbol}
            onChange={e => setSymbol(e.target.value.toUpperCase())}
            className="dia-input"
            placeholder="XAUUSD"
          />
        </div>
        <div className="dia-control-group">
          <label>Window</label>
          <select value={windowSize} onChange={e => setWindowSize(Number(e.target.value))} className="dia-select">
            <option value={5}>5 snapshots</option>
            <option value={10}>10 snapshots</option>
            <option value={20}>20 snapshots</option>
            <option value={50}>50 snapshots</option>
          </select>
        </div>
        <div className="dia-control-group">
          <label>Sort by</label>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="dia-select">
            <option value="impactScore">Impact Score</option>
            <option value="avgContribution">Avg Contribution</option>
            <option value="volatility">Volatility</option>
            <option value="hitRate">Hit Rate</option>
            <option value="trend">Trend</option>
          </select>
        </div>
        <div className="dia-control-group">
          <label>Filter tier</label>
          <select value={tierFilter} onChange={e => setTierFilter(e.target.value)} className="dia-select">
            <option value="all">All Tiers</option>
            <option value="heavyweight">Heavyweight</option>
            <option value="mover">Mover</option>
            <option value="steady">Steady</option>
            <option value="lightweight">Lightweight</option>
          </select>
        </div>
      </motion.div>

      {isLoading && <LoadingSkeleton variant="card" count={5} />}
      {isError && <Notice level="error">Failed to load impact data. Is the API running?</Notice>}

      {/* ── Summary Bar ── */}
      {report && report.sampleCount > 0 && (
        <motion.div className="dia-summary-bar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 }}>
          <span>{report.sampleCount} snapshots &middot; {report.windowMinutes}m window</span>
          <span className="dia-summary-sep">|</span>
          <span className="dia-tier-badge" style={{ background: TIER_COLORS.heavyweight.bg, color: TIER_COLORS.heavyweight.text }}>
            {report.summary.heavyweightCount} Heavyweight
          </span>
          <span className="dia-tier-badge" style={{ background: TIER_COLORS.mover.bg, color: TIER_COLORS.mover.text }}>
            {report.summary.moverCount} Mover
          </span>
          <span className="dia-tier-badge" style={{ background: TIER_COLORS.steady.bg, color: TIER_COLORS.steady.text }}>
            {report.summary.steadyCount} Steady
          </span>
          <span className="dia-tier-badge" style={{ background: TIER_COLORS.lightweight.bg, color: TIER_COLORS.lightweight.text }}>
            {report.summary.lightweightCount} Lightweight
          </span>
          <span className="dia-summary-sep">|</span>
          <span style={{fontSize:'0.8rem', color: 'var(--textDim)'}}>
            Top protocol candidates: {report.summary.topProtocolCandidates?.map(d => d.name).join(', ') || '—'}
          </span>
        </motion.div>
      )}

      {/* ── Directive Table ── */}
      {filteredDirectives.length > 0 ? (
        <motion.div className="dia-table-wrap" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <table className="dia-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Directive</th>
                <th>Tier</th>
                <th>Readiness</th>
                <th>Impact Score</th>
                <th>Avg Contrib</th>
                <th>Max Contrib</th>
                <th>Volatility</th>
                <th>Hit Rate</th>
                <th>Trend</th>
                <th>Impact Bar</th>
              </tr>
            </thead>
            <tbody>
              {filteredDirectives.map((d, i) => {
                const tier = TIER_COLORS[d.tier] || TIER_COLORS.lightweight;
                const barWidth = Math.max(1, (d.impactScore / maxImpact) * 100);
                return (
                  <motion.tr
                    key={d.directiveId}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.015 }}
                    className={d.tier === 'heavyweight' ? 'dia-row-hw' : ''}
                  >
                    <td className="dia-rank">{i + 1}</td>
                    <td className="dia-name" title={d.directiveId}>{d.name}</td>
                    <td>
                      <span className="dia-tier-badge" style={{ background: tier.bg, color: tier.text }}>
                        {tier.label}
                      </span>
                    </td>
                    <td>
                      <span className="dia-readiness-dot" style={{ background: READINESS_COLORS[d.readiness] || '#64748b' }} />
                      {d.readiness}
                    </td>
                    <td className="dia-num dia-impact">{d.impactScore.toFixed(1)}</td>
                    <td className="dia-num">{d.avgContribution.toFixed(1)}</td>
                    <td className="dia-num">{d.maxContribution.toFixed(1)}</td>
                    <td className="dia-num">{d.volatility.toFixed(1)}</td>
                    <td className="dia-num">
                      <span style={{ color: d.hitRate >= 80 ? '#22c55e' : d.hitRate >= 40 ? '#f59e0b' : '#ef4444' }}>
                        {d.hitRate}%
                      </span>
                    </td>
                    <td className="dia-num" style={{ color: d.trend > 0 ? '#22c55e' : d.trend < 0 ? '#ef4444' : 'var(--textDim)' }}>
                      {d.trend > 0 ? '+' : ''}{d.trend.toFixed(1)}
                    </td>
                    <td className="dia-bar-cell">
                      <div className="dia-bar-track">
                        <div
                          className="dia-bar-fill"
                          style={{
                            width: `${barWidth}%`,
                            background: `linear-gradient(90deg, ${tier.bg}, ${tier.bg}88)`,
                          }}
                        />
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </motion.div>
      ) : (
        !isLoading && !isError && (
          <Notice level="info">
            No impact data for {symbol}. Try a symbol with active scoring history (e.g. XAUUSD) or increase the window.
          </Notice>
        )
      )}

      {/* ── Legend ── */}
      <motion.div className="dia-legend" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
        <h3>How Impact Score Works</h3>
        <p className="muted">
          <strong>Impact Score = Avg Contribution &times; Volatility</strong> — combines how much a directive
          contributes with how much it moves. High-impact directives are ideal for building protocols
          with big score swings.
        </p>
        <div className="dia-legend-grid">
          <div><span className="dia-tier-badge" style={{ background: TIER_COLORS.heavyweight.bg, color: TIER_COLORS.heavyweight.text }}>Heavyweight</span> impact &ge; 500 — dominant market movers</div>
          <div><span className="dia-tier-badge" style={{ background: TIER_COLORS.mover.bg, color: TIER_COLORS.mover.text }}>Mover</span> impact 100–499 — significant contributors</div>
          <div><span className="dia-tier-badge" style={{ background: TIER_COLORS.steady.bg, color: TIER_COLORS.steady.text }}>Steady</span> impact 20–99 — consistent background signal</div>
          <div><span className="dia-tier-badge" style={{ background: TIER_COLORS.lightweight.bg, color: TIER_COLORS.lightweight.text }}>Lightweight</span> impact &lt; 20 — negligible contribution</div>
        </div>
      </motion.div>
    </div>
  );
}
