/**
 * Strategies Ladder — Strategy-focused scoring ladder
 * ====================================================
 * Aggregates active scoring strategies. Shows scored symbols ranked by
 * score with strategy attribution. Toggle between ALL symbols or SIGNALS only.
 *
 * Used by the Scoring Strategies area. For Protocols area, see ProtocolsLadderPage.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import './sees-arena.css';

function scoreClass(v) {
  if (v >= 65) return 'sa-score-high';
  if (v >= 40) return 'sa-score-med';
  return 'sa-score-low';
}

export default function StrategyLaddersPage() {
  const [mode, setMode] = useState('all');
  const [sortBy, setSortBy] = useState('score');

  const arenaQuery = useQuery({
    queryKey: ['strategy-ladders-arena'],
    queryFn: () => apiGet('/api/scoring/arena').catch(() => ({ stacks: [] })),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const entries = useMemo(() => {
    const stacks = arenaQuery.data?.stacks || [];
    const all = [];
    for (const stack of stacks) {
      for (const s of (stack.symbols || [])) {
        all.push({
          symbol: s.symbol,
          score: s.score,
          signal: s.signal || 'HOLD',
          strategyName: stack.strategyName,
          strategyId: stack.strategyId,
          color: stack.color,
        });
      }
    }
    let filtered = mode === 'signals'
      ? all.filter(e => e.signal === 'BUY' || e.signal === 'SELL')
      : all;
    if (sortBy === 'score') filtered.sort((a, b) => b.score - a.score);
    else filtered.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return filtered;
  }, [arenaQuery.data, mode, sortBy]);

  const signalCount = useMemo(() => {
    const stacks = arenaQuery.data?.stacks || [];
    let total = 0, sigs = 0;
    for (const stack of stacks) {
      for (const s of (stack.symbols || [])) {
        total++;
        if (s.signal === 'BUY' || s.signal === 'SELL') sigs++;
      }
    }
    return { total, signals: sigs };
  }, [arenaQuery.data]);

  return (
    <div className="sa-page">
      <header className="sa-header">
        <div>
          <h1>Strategies Ladder
          <PageInfoPopover>
            Aggregates all active scoring strategies. Toggle between ALL scored symbols
            or SIGNALS only (highest-scoring, gate-passing entries).
          </PageInfoPopover>
          </h1>
        </div>
      </header>

      <div className="sl-ladder-bar">
        <div className="sl-ladder-toggles">
          <button className={`sl-ladder-chip ${mode === 'all' ? 'active' : ''}`} onClick={() => setMode('all')}>All Symbols ({signalCount.total})</button>
          <button className={`sl-ladder-chip ${mode === 'signals' ? 'active' : ''}`} onClick={() => setMode('signals')}>Signals Only ({signalCount.signals})</button>
          <span className="sl-ladder-sep" />
          <button className={`sl-ladder-chip ${sortBy === 'score' ? 'active' : ''}`} onClick={() => setSortBy('score')}>By Score ↓</button>
          <button className={`sl-ladder-chip ${sortBy === 'symbol' ? 'active' : ''}`} onClick={() => setSortBy('symbol')}>A–Z</button>
        </div>
        <span className="sl-ladder-count">{entries.length} shown</span>
      </div>

      {arenaQuery.isLoading && <LoadingSkeleton variant="text" lines={8} />}

      {entries.length > 0 && (
        <div className="sl-ladder-table-wrap">
          <table className="sl-ladder-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Symbol</th>
                <th>Strategy</th>
                <th>Signal</th>
                <th style={{ width: 80 }}>Score</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.strategyId}-${e.symbol}`} className="sl-ladder-row">
                  <td className="sl-ladder-rank">#{i + 1}</td>
                  <td><strong>{e.symbol}</strong></td>
                  <td><span className="sl-ladder-strat" style={{ borderLeftColor: e.color || 'var(--accent)' }}>{e.strategyName}</span></td>
                  <td><span className={`sl-ladder-signal ${e.signal.toLowerCase()}`}>{e.signal === 'BUY' ? '▲ BUY' : e.signal === 'SELL' ? '▼ SELL' : '◆ HOLD'}</span></td>
                  <td><span className={scoreClass(e.score)} style={{ fontWeight: 700, padding: '1px 6px', borderRadius: 4, fontSize: '0.78rem' }}>{e.score.toFixed(0)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!arenaQuery.isLoading && entries.length === 0 && (
        <div className="sa-empty">
          <p>No {mode === 'signals' ? 'signals' : 'scored symbols'} found.</p>
          <p className="sa-hint">Run scoring or wait for the next automation tick to populate the ladder.</p>
        </div>
      )}

      {!arenaQuery.isLoading && arenaQuery.isError && (
        <p className="sa-empty">Backend unavailable — is the NestJS API running?</p>
      )}
    </div>
  );
}
