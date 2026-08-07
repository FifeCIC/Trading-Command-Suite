/**
 * Protocols Performance — P&L metrics per protocol based on scoring signals.
 * =========================================================================
 * Shows each protocol's trading performance: profit, win rate derived from
 * score signals vs actual price movement, and strategy linkage.
 *
 * Step 1 (current): Shows strategies/with-ratios data grouped by protocol.
 * Step 2 (future): Price-change-based win rate using score→price correlation.
 *
 * Data: GET /api/trading/strategies/with-ratios
 *
 * @created 2026-08-07 — Protocols area rework
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import './protocols-ladder.css';

function pnlClass(v) {
  if (v > 0) return 'pl-score-high';
  if (v < 0) return 'pl-score-low';
  return 'pl-muted';
}

function pnlSign(v) {
  if (v > 0) return `+$${v.toFixed(2)}`;
  return `$${v.toFixed(2)}`;
}

function ratioBar(ratio) {
  if (ratio == null) return null;
  const w = Math.max(4, Math.min(100, Math.abs(ratio) * 20));
  const color = ratio > 0 ? '#22c55e' : '#ef4444';
  return <span className="pl-bar" style={{ width: w, background: color }} />;
}

export default function ProtocolsPerformancePage() {
  const [sortBy, setSortBy] = useState('pnl');
  const [protocolFilter, setProtocolFilter] = useState('all');

  const { data: strategiesData, isLoading } = useQuery({
    queryKey: ['protocols-perf-strategies'],
    queryFn: () => apiGet('/api/trading/strategies/with-ratios').catch(() => []),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: protocolsData } = useQuery({
    queryKey: ['protocols-perf-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 60_000,
  });

  // Group strategies by protocol
  const protocolPerf = useMemo(() => {
    const strats = Array.isArray(strategiesData) ? strategiesData : (strategiesData?.strategies || []);
    const byProto = new Map();

    for (const s of strats) {
      const protoId = s.protocolId || s.shortProtocolId || '—';
      if (!byProto.has(protoId)) {
        byProto.set(protoId, { pnl: 0, count: 0, active: 0, ratioSum: 0, strategies: [] });
      }
      const g = byProto.get(protoId);
      g.pnl += s.totalPnl || 0;
      g.count++;
      if (s.active) g.active++;
      if (s.profitRatio != null) g.ratioSum += s.profitRatio;
      g.strategies.push({
        name: s.name || s.id,
        symbol: s.symbol,
        pnl: s.totalPnl || 0,
        ratio: s.profitRatio,
        active: s.active,
        evalCount: s.evaluationCount,
      });
    }

    let result = [...byProto.entries()].map(([protoId, g]) => ({
      protocolName: protoId,
      totalPnl: g.pnl,
      strategyCount: g.count,
      activeCount: g.active,
      avgRatio: g.count > 0 ? g.ratioSum / g.count : null,
      strategies: g.strategies,
    }));

    if (protocolFilter !== 'all') {
      result = result.filter(p => p.protocolName === protocolFilter);
    }

    if (sortBy === 'pnl') result.sort((a, b) => b.totalPnl - a.totalPnl);
    else if (sortBy === 'ratio') result.sort((a, b) => (b.avgRatio || 0) - (a.avgRatio || 0));
    else if (sortBy === 'count') result.sort((a, b) => b.strategyCount - a.strategyCount);
    else if (sortBy === 'alpha') result.sort((a, b) => a.protocolName.localeCompare(b.protocolName));

    return result;
  }, [strategiesData, sortBy, protocolFilter]);

  const protoNames = useMemo(() => {
    const set = new Set(protocolPerf.map(p => p.protocolName));
    return ['all', ...set].filter(Boolean).sort();
  }, [protocolPerf]);

  const totalPnl = protocolPerf.reduce((s, p) => s + p.totalPnl, 0);

  return (
    <div className="pl-page">
      <motion.header className="pl-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Protocols Performance
          <PageInfoPopover>
            P&L and win-rate metrics per protocol. Grouped from live trading strategy data. Future iterations will add price-change-based win rate using score→price correlation.
          </PageInfoPopover>
        </h1>
      </motion.header>

      <div className="pl-toolbar">
        <label className="pl-filter">
          Sort:
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="pnl">P&L ▼</option>
            <option value="ratio">Profit Ratio</option>
            <option value="count">Strategy Count</option>
            <option value="alpha">A → Z</option>
          </select>
        </label>
        <label className="pl-filter">
          Protocol:
          <select value={protocolFilter} onChange={e => setProtocolFilter(e.target.value)}>
            <option value="all">All</option>
            {protoNames.filter(n => n !== 'all').map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <span className="pl-count">
          {protocolPerf.length} protocols · Total: <span className={pnlClass(totalPnl)}>{pnlSign(totalPnl)}</span>
        </span>
      </div>

      {isLoading ? <LoadingSkeleton variant="card" count={5} /> : (
        <div className="pl-table-wrap">
          <table className="pl-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Protocol</th>
                <th>P&L</th>
                <th>Profit Ratio</th>
                <th>Strategies</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {protocolPerf.map((p, i) => (
                <tr key={p.protocolName}>
                  <td className="pl-rank">{i + 1}</td>
                  <td className="pl-symbol">{p.protocolName}</td>
                  <td>
                    <span className="pl-bar-wrap">
                      {ratioBar(p.avgRatio)}
                      <span className={pnlClass(p.totalPnl)}>{pnlSign(p.totalPnl)}</span>
                    </span>
                  </td>
                  <td className="pl-muted">{p.avgRatio != null ? p.avgRatio.toFixed(2) : '—'}</td>
                  <td>{p.strategyCount}</td>
                  <td><span className={p.activeCount > 0 ? 'pl-score-high' : 'pl-muted'}>{p.activeCount}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
