/**
 * Protocols Ladder — Protocol-focused scoring ladder
 * ====================================================
 * Shows all active protocols and their scored symbols ranked by score.
 * Data comes from the database (scoring runs) — each run represents a
 * protocol scoring pass over its watchlist symbols.
 *
 * Created 2026-08-05 — split from StrategyLaddersPage for the Protocols area.
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

export default function ProtocolsLadderPage() {
  const [sortBy, setSortBy] = useState('score');

  const protocolsQuery = useQuery({
    queryKey: ['protocols-ladder-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 30_000,
  });

  const runsQuery = useQuery({
    queryKey: ['protocols-ladder-runs'],
    queryFn: () => apiGet('/api/scoring/runs?limit=50').catch(() => ({ runs: [] })),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const activeProtocols = useMemo(() => {
    const protos = protocolsQuery.data?.protocols || [];
    return protos.filter(p => p.active !== false);
  }, [protocolsQuery.data]);

  const entries = useMemo(() => {
    const runs = runsQuery.data?.runs || [];
    const all = [];
    for (const run of runs) {
      const protoName = run.strategyName || '—';
      if (run.scores?.length) {
        for (const s of run.scores) {
          all.push({
            symbol: s.ticker || '—',
            score: s.value || 0,
            signal: s.value >= 65 ? 'BUY' : s.value >= 40 ? 'HOLD' : 'SELL',
            protocolName: protoName,
          });
        }
      }
    }
    const seen = new Map();
    const deduped = [];
    for (const e of all) {
      const existing = seen.get(e.symbol);
      if (!existing || e.score > existing.score) {
        seen.set(e.symbol, e);
      }
    }
    for (const e of seen.values()) deduped.push(e);

    if (sortBy === 'score') deduped.sort((a, b) => b.score - a.score);
    else deduped.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return deduped;
  }, [runsQuery.data, sortBy]);

  const isLoading = protocolsQuery.isLoading || runsQuery.isLoading;

  return (
    <div className="sa-page">
      <header className="sa-header">
        <div>
          <h1>Protocols Ladder
          <PageInfoPopover>
            All active protocols and their scored symbols ranked by score.
            Each row shows which protocol scored that symbol. Data from the database.
          </PageInfoPopover>
          </h1>
        </div>
      </header>

      <div className="sl-ladder-bar">
        <div className="sl-ladder-toggles">
          <span className="sl-ladder-chip active">All Protocols ({activeProtocols.length})</span>
          <span className="sl-ladder-sep" />
          <button className={`sl-ladder-chip ${sortBy === 'score' ? 'active' : ''}`} onClick={() => setSortBy('score')}>By Score ↓</button>
          <button className={`sl-ladder-chip ${sortBy === 'symbol' ? 'active' : ''}`} onClick={() => setSortBy('symbol')}>A–Z</button>
        </div>
        <span className="sl-ladder-count">{entries.length} scored</span>
      </div>

      {isLoading && <LoadingSkeleton variant="text" lines={8} />}

      {entries.length > 0 && (
        <div className="sl-ladder-table-wrap">
          <table className="sl-ladder-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Symbol</th>
                <th>Protocols</th>
                <th>Signal</th>
                <th style={{ width: 80 }}>Score</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.protocolName}-${e.symbol}-${i}`} className="sl-ladder-row">
                  <td className="sl-ladder-rank">#{i + 1}</td>
                  <td><strong>{e.symbol}</strong></td>
                  <td><span className="sl-ladder-strat" style={{ borderLeftColor: 'var(--accent)' }}>{e.protocolName}</span></td>
                  <td><span className={`sl-ladder-signal ${(e.signal || '').toLowerCase()}`}>{e.signal === 'BUY' ? '▲ BUY' : e.signal === 'SELL' ? '▼ SELL' : '◆ HOLD'}</span></td>
                  <td><span className={scoreClass(e.score)} style={{ fontWeight: 700, padding: '1px 6px', borderRadius: 4, fontSize: '0.78rem' }}>{e.score.toFixed(0)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && entries.length === 0 && (
        <div className="sa-empty">
          <p>No scored symbols found for active protocols.</p>
          <p className="sa-hint">Run scoring or wait for the next automation tick to populate the ladder.</p>
        </div>
      )}

      {!isLoading && runsQuery.isError && (
        <p className="sa-empty">Backend unavailable — is the NestJS API running?</p>
      )}
    </div>
  );
}
