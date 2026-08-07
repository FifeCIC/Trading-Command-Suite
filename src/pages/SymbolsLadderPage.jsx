/**
 * Symbols Ladder — All symbols across all protocols, ranked by score.
 * ===================================================================
 * Every symbol scored by any protocol, deduped with best score + protocol.
 *
 * Data: GET /api/scoring/runs (all recent scoring runs)
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

export default function SymbolsLadderPage() {
  const [sortBy, setSortBy] = useState('score');
  const [signalFilter, setSignalFilter] = useState('all');

  const { data, isLoading } = useQuery({
    queryKey: ['symbols-ladder'],
    queryFn: () => apiGet('/api/scoring/runs?limit=100').catch(() => ({ runs: [] })),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const entries = useMemo(() => {
    const runs = data?.runs || [];
    const bestBySymbol = new Map();
    for (const run of runs) {
      const protoName = run.strategyName || run.protocolName || run.protocolId || '—';
      if (run.scores?.length) {
        for (const s of run.scores) {
          const ticker = (s.ticker || s.symbol || '—').toUpperCase();
          const score = s.value ?? s.score ?? 0;
          if (!bestBySymbol.has(ticker) || score > bestBySymbol.get(ticker).score) {
            bestBySymbol.set(ticker, { ticker, score, protocolName: protoName });
          }
        }
      }
    }

    let list = [...bestBySymbol.values()];

    const signal = (s) => s >= 65 ? 'BUY' : s >= 40 ? 'HOLD' : 'SELL';
    if (signalFilter !== 'all') list = list.filter(e => signal(e.score) === signalFilter);

    if (sortBy === 'score') list.sort((a, b) => b.score - a.score);
    else if (sortBy === 'alpha') list.sort((a, b) => a.ticker.localeCompare(b.ticker));

    return list;
  }, [data, sortBy, signalFilter]);

  return (
    <div className="pl-page">
      <motion.header className="pl-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Symbols Ladder <PageInfoPopover>All symbols scored across all protocols, ranked by best score. Shows which protocol scored each symbol highest.</PageInfoPopover></h1>
      </motion.header>

      <div className="pl-toolbar">
        <label className="pl-filter">
          Sort:
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="score">Score ▼</option>
            <option value="alpha">A → Z</option>
          </select>
        </label>
        <label className="pl-filter">
          Signal:
          <select value={signalFilter} onChange={e => setSignalFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="BUY">Buy only</option>
            <option value="SELL">Sell only</option>
            <option value="HOLD">Hold only</option>
          </select>
        </label>
        <span className="pl-count">{entries.length} symbols</span>
      </div>

      {isLoading ? <LoadingSkeleton variant="card" count={10} /> : (
        <div className="pl-table-wrap">
          <table className="pl-table">
            <thead>
              <tr><th>#</th><th>Symbol</th><th>Score</th><th>Signal</th><th>Best Protocol</th></tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.ticker}>
                  <td className="pl-rank">{i + 1}</td>
                  <td className="pl-symbol">{e.ticker}</td>
                  <td><span className={scoreClass(e.score)}>{e.score}</span></td>
                  <td>{signalBadge(e.score)}</td>
                  <td className="pl-muted">{e.protocolName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
