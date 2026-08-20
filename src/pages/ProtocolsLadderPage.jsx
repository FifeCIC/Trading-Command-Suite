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
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { useProtocolData } from '../core/useProtocolData';
import { useProtocolStatuses, buildProtocolStatus } from '../core/protocol-status';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import './protocols-ladder.css';

import { scoreClass, DIRECTION_MODE_LABELS } from '../core/signal-utils';

export default function ProtocolsLadderPage() {
  const [sortBy, setSortBy] = useState('top-symbol');
  const [aggSize, setAggSize] = useState(3);
  const [directionFilter, setDirectionFilter] = useState('all');

  const { protocols: registry, runs, protoName, isLoading } = useProtocolData();
  const { statusMap, statuses } = useProtocolStatuses();

  // Short human-readable labels for why a protocol has no scores on the ladder.
  const STALL_SHORT = {
    'no-data': 'no data',
    'no-symbols': 'not configured',
    paused: 'paused',
    error: 'error',
    pending: 'pending',
  };

  // Merge scoring data into the active protocol registry.
  // Only active protocols appear — inactive ones are skipped.
  const protocols = useMemo(() => {
    // Only the LATEST run per protocol is canonical — stale or ad-hoc runs
    // (A/B tests, explorer scoring of unrelated symbols) must not pollute the
    // ladder. Runs are timestamp-desc, so the first match per protocol wins.
    const latestByProto = new Map();
    for (const run of runs) {
      const pId = run.protocolId;
      if (!pId || !run.scores?.length) continue;
      if (!latestByProto.has(pId)) latestByProto.set(pId, run);
    }

    // Build protocolId → best-per-symbol entries from the latest run only
    const scored = new Map();
    for (const [pId, run] of latestByProto) {
      const best = new Map();
      for (const s of run.scores) {
        const ticker = (s.ticker || s.symbol || '—').toUpperCase();
        const value = s.value ?? s.score ?? 0;
        const prev = best.get(ticker);
        if (!prev || value > prev.score) {
          best.set(ticker, { score: value, signal: s.signal ?? null });
        }
      }
      scored.set(pId, best);
    }

    // Compute aggregates per protocol
    const aggByProto = new Map();
    for (const [pId, best] of scored) {
      const sorted = [...best.entries()].sort((a, b) => b[1].score - a[1].score);
      const topSymbol = sorted[0];
      const topN = sorted.slice(0, aggSize).reduce((sum, [, s]) => sum + s.score, 0);
      const avg = sorted.length > 0
        ? Math.round(sorted.reduce((sum, [, s]) => sum + s.score, 0) / sorted.length)
        : 0;
      aggByProto.set(pId, {
        topSymbol: topSymbol?.[0] || '—',
        topScore: topSymbol?.[1]?.score || 0,
        topSignal: topSymbol?.[1]?.signal ?? null,
        topNScore: topN,
        symbolCount: sorted.length,
        avgScore: avg,
      });
    }

    // Build result from the full registry, falling back to runs-only protocols
    const seen = new Set();
    const result = [];

    // First: active protocols from registry
    for (const p of registry) {
      if (p.active === false) continue;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const agg = aggByProto.get(p.id);
      result.push({
        protocolId: p.id,
        protocolName: p.name || p.id,
        active: p.active !== false,
        vs: buildProtocolStatus(
          { active: p.active !== false, note: p.note ?? statusMap[p.id]?.note },
          statusMap[p.id]?.status,
        ),
        topSymbol: agg?.topSymbol || '—',
        topScore: agg?.topScore ?? 0,
        topSignal: agg?.topSignal ?? null,
        topNScore: agg?.topNScore ?? 0,
        symbolCount: agg?.symbolCount ?? 0,
        avgScore: agg?.avgScore ?? 0,
        hasData: !!agg,
        directionMode: p.directionMode || 'BOTH',
      });
    }

    // Filter by direction mode (LONG_ONLY / SHORT_ONLY / BOTH).
    const filtered = directionFilter === 'all'
      ? result
      : result.filter(p => (p.directionMode || 'BOTH') === directionFilter);

    // Sort — ladders order only on scoring strength.
    if (sortBy === 'top-symbol') filtered.sort((a, b) => b.topScore - a.topScore);
    else if (sortBy === 'aggregate') filtered.sort((a, b) => b.topNScore - a.topNScore);
    else if (sortBy === 'avg') filtered.sort((a, b) => b.avgScore - a.avgScore);

    return filtered;
  }, [registry, runs, sortBy, aggSize, protoName, directionFilter, statusMap]);

  const stalledCount = protocols.filter(p => p.vs && ['no-data', 'no-symbols', 'paused', 'error'].includes(p.vs.state)).length;
  const disabledList = statuses.filter(s => s.active === false && s.note);
  const disabledNoNote = statuses.filter(s => s.active === false && !s.note).length;

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
        <label className="pl-filter">
          Direction:
          <select value={directionFilter} onChange={e => setDirectionFilter(e.target.value)}>
            <option value="all">All</option>
            {Object.entries(DIRECTION_MODE_LABELS).map(([mode, label]) => (
              <option key={mode} value={mode}>{label}</option>
            ))}
          </select>
        </label>
        <span className="pl-count">
          {protocols.length} protocols{stalledCount > 0 ? ` · ${stalledCount} stalled` : ''}
        </span>
      </div>

      {isLoading ? <LoadingSkeleton variant="card" count={5} /> : (
        <div className="pl-table-wrap">
          <table className="pl-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Protocol</th>
                <th>Status</th>
                <th>Highest Scorer</th>
                <th>Highest Score</th>
                <th>
                  <span className="pl-th" tabIndex={0}>
                    Agg ({aggSize})
                    <span className="pl-th-pop" role="tooltip">
                      Aggregate — the combined score of the top {aggSize} scored symbols for this protocol.
                    </span>
                  </span>
                </th>
                <th>Avg</th>
                <th># Sym</th>
              </tr>
            </thead>
            <tbody>
              {protocols.map((p, i) => (
                <tr key={p.protocolId} className={!p.hasData ? 'pl-no-data' : ''}>
                  <td className="pl-rank">{i + 1}</td>
                  <td className="pl-symbol">
                    <Link to={`/protocols/protocols-registry?proto=${encodeURIComponent(p.protocolId)}`} className="pl-proto-link">{p.protocolName}</Link>
                  </td>
                  <td>
                    <span
                      className={`pl-status pl-status-${p.vs?.kind || 'muted'}`}
                      title={[p.vs?.reason, p.vs?.note].filter(Boolean).join(' · ') || p.vs?.help || ''}
                    >
                      {p.vs?.label || '—'}
                    </span>
                  </td>
                  <td className={p.hasData ? '' : 'pl-muted'}>
                    {p.hasData ? (
                      <span className="pl-highest">
                        <span className="pl-highest-symbol">
                          {p.topSymbol ? (
                            <Link to={`/research/symbol/${encodeURIComponent(p.topSymbol)}`} className="pl-proto-link">{p.topSymbol}</Link>
                          ) : '—'}
                        </span>
                        {p.topSignal ? (
                          <span className={`pl-badge pl-badge-${String(p.topSignal).replace('STRONG_', '').toLowerCase()}`}>{p.topSignal}</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="pl-stall-reason" title={p.vs?.reason || p.vs?.note || ''}>
                        {STALL_SHORT[p.vs?.state] || '—'}
                      </span>
                    )}
                  </td>
                  <td className={p.hasData ? '' : 'pl-muted'}>
                    {p.hasData ? <span className={`pl-highest-score ${scoreClass(p.topScore)}`}>{p.topScore}</span> : '—'}
                  </td>
                  <td><strong>{p.hasData ? p.topNScore : '—'}</strong></td>
                  <td className="pl-muted">{p.hasData ? p.avgScore : '—'}</td>
                  <td className="pl-muted">{p.hasData ? p.symbolCount : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {disabledList.length > 0 && (
        <div className="pl-disabled">
          <h2>Disabled protocols</h2>
          {disabledList.map(d => (
            <div key={d.protocolId} className="pl-disabled-row">
              <Link to={`/protocols/protocols-registry?proto=${encodeURIComponent(d.protocolId)}`} className="pl-proto-link">{d.name}</Link>
              <span className="pl-disabled-note">{d.note}</span>
            </div>
          ))}
          {disabledNoNote > 0 && (
            <div className="pl-disabled-row">
              <Link to="/protocols/protocols-registry" className="pl-proto-link">
                +{disabledNoNote} more disabled protocol{disabledNoNote === 1 ? '' : 's'} (no note) — see registry
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
