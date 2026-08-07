/**
 * Protocols Ladder — Protocols ranked by scoring strength with aggregation.
 * =========================================================================
 * Each active protocol shows its top-scored symbol. "Aggregate" sort orders
 * protocols by the combined score of their top 3, 5, or 7 symbols.
 *
 * Data: GET /api/scoring/runs (all recent scoring runs)
 *
 * @created 2026-08-05 — original
 * @rebuilt 2026-08-07 — added aggregation, per-protocol ranking
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import './protocols-ladder.css';

function scoreClass(v) {
  if (v >= 65) return 'pl-score-high';
  if (v >= 40) return 'pl-score-med';
  return 'pl-score-low';
}

function signalBadge(score) {
  if (score >= 65) return <span className="pl-badge pl-badge-buy">BUY</span>;
  if (score >= 40) return <span className="pl-badge pl-badge-hold">HOLD</span>;
  return <span className="pl-badge pl-badge-sell">SELL</span>;
}

function scoreBar(pct) {
  const w = Math.max(4, Math.min(100, pct));
  const color = pct >= 65 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
  return <span className="pl-bar" style={{ width: w, background: color }} />;
}

export default function ProtocolsLadderPage() {
  const [sortBy, setSortBy] = useState('top-symbol');
  const [aggSize, setAggSize] = useState(3);

  const { data: protocolsData } = useQuery({
    queryKey: ['pro-ladder-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 60_000,
  });

  const { data: runsData, isLoading } = useQuery({
    queryKey: ['pro-ladder-runs'],
    queryFn: () => apiGet('/api/scoring/runs?limit=100').catch(() => ({ runs: [] })),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  // Build: protocol → { topSymbol, topNScore, symbolCount, avgScore }
  const protocols = useMemo(() => {
    const runs = runsData?.runs || [];

    // Group scores by protocol
    const byProto = new Map();
    for (const run of runs) {
      const protoId = run.strategyName || run.protocolName || run.protocolId || '—';
      if (!run.scores?.length) continue;

      if (!byProto.has(protoId)) byProto.set(protoId, []);
      for (const s of run.scores) {
        byProto.get(protoId).push({
          ticker: (s.ticker || s.symbol || '—').toUpperCase(),
          score: s.value ?? s.score ?? 0,
        });
      }
    }

    // Compute per-protocol stats
    const result = [];
    for (const [protoId, scores] of byProto) {
      const best = new Map();
      for (const s of scores) {
        if (!best.has(s.ticker) || s.score > best.get(s.ticker)) {
          best.set(s.ticker, s.score);
        }
      }

      const sorted = [...best.entries()].sort((a, b) => b[1] - a[1]);
      const topSymbol = sorted[0];
      const topN = sorted.slice(0, aggSize).reduce((sum, [, s]) => sum + s, 0);
      const avg = sorted.length > 0 ? Math.round(sorted.reduce((sum, [, s]) => sum + s, 0) / sorted.length) : 0;

      result.push({
        protocolName: protoId,
        topSymbol: topSymbol?.[0] || '—',
        topScore: topSymbol?.[1] || 0,
        topNScore: topN,
        symbolCount: sorted.length,
        avgScore: avg,
      });
    }

    // Sort
    if (sortBy === 'top-symbol') result.sort((a, b) => b.topScore - a.topScore);
    else if (sortBy === 'aggregate') result.sort((a, b) => b.topNScore - a.topNScore);
    else if (sortBy === 'avg') result.sort((a, b) => b.avgScore - a.avgScore);
    else if (sortBy === 'count') result.sort((a, b) => b.symbolCount - a.symbolCount);
    else if (sortBy === 'alpha') result.sort((a, b) => a.protocolName.localeCompare(b.protocolName));

    return result;
  }, [protocolsData, runsData, sortBy, aggSize]);

  return (
    <div className="pl-page">
      <motion.header className="pl-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Protocols Ladder
          <PageInfoPopover>
            Active protocols ranked by scoring strength. "Aggregate" combines the top N symbols per protocol for a combined strength score.
          </PageInfoPopover>
        </h1>
      </motion.header>

      <div className="pl-toolbar">
        <label className="pl-filter">
          Sort:
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="top-symbol">Top Symbol</option>
            <option value="aggregate">Aggregate (Top {aggSize})</option>
            <option value="avg">Avg Score</option>
            <option value="count">Symbol Count</option>
            <option value="alpha">A → Z</option>
          </select>
        </label>
        {sortBy === 'aggregate' && (
          <label className="pl-filter">
            Top:
            <select value={aggSize} onChange={e => setAggSize(Number(e.target.value))}>
              <option value={3}>Top 3</option>
              <option value={5}>Top 5</option>
              <option value={7}>Top 7</option>
            </select>
          </label>
        )}
        <span className="pl-count">{protocols.length} protocols</span>
      </div>

      {isLoading ? <LoadingSkeleton variant="card" count={5} /> : (
        <div className="pl-table-wrap">
          <table className="pl-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Protocol</th>
                <th>Top Symbol</th>
                <th>Score</th>
                <th>Agg ({aggSize})</th>
                <th>Avg</th>
                <th># Sym</th>
              </tr>
            </thead>
            <tbody>
              {protocols.map((p, i) => (
                <tr key={p.protocolName}>
                  <td className="pl-rank">{i + 1}</td>
                  <td className="pl-symbol">{p.protocolName}</td>
                  <td>{p.topSymbol}</td>
                  <td>
                    <span className="pl-bar-wrap">
                      {scoreBar(p.topScore)}
                      <span className={scoreClass(p.topScore)}>{p.topScore}</span>
                    </span>
                    {' '}{signalBadge(p.topScore)}
                  </td>
                  <td><strong>{p.topNScore}</strong></td>
                  <td className="pl-muted">{p.avgScore}</td>
                  <td className="pl-muted">{p.symbolCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
