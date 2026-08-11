/**
 * Protocols Performance — All symbols per protocol with score + P&L.
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageInfoPopover from '../components/PageInfoPopover';
import './protocols-ladder.css';

import { scoreClass, signalBadge, pnlClass, pnlSign } from '../core/signal-utils';

export default function ProtocolsPerformancePage() {
  const [sortBy, setSortBy] = useState('score');
  const [protocolFilter, setProtocolFilter] = useState('all');

  const { data: protocolsData } = useQuery({
    queryKey: ['perf-protocols'], queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })), staleTime: 60_000,
  });
  const { data: runsData, isLoading: rLoading } = useQuery({
    queryKey: ['perf-runs'], queryFn: () => apiGet('/api/scoring/runs?limit=200&groupBy=protocol').catch(() => ({ runs: [] })), staleTime: 10_000, refetchInterval: 30_000,
  });
  const { data: stratsData } = useQuery({
    queryKey: ['perf-strats'], queryFn: () => apiGet('/api/trading/strategies/with-ratios').catch(() => []), staleTime: 15_000, refetchInterval: 30_000,
  });

  const protoMap = useMemo(() => {
    const map = {}; (protocolsData?.protocols || []).forEach(p => { map[p.id] = p.name || p.id; }); return map;
  }, [protocolsData]);

  const pnlMap = useMemo(() => {
    const strats = Array.isArray(stratsData) ? stratsData : (stratsData?.strategies || []);
    const map = new Map();
    for (const s of strats) { const k = `${s.protocolId || ''}:${(s.symbol || '').toUpperCase()}`; if (!map.has(k)) map.set(k, { pnl: 0, ratio: null }); const e = map.get(k); e.pnl += s.totalPnl || 0; if (s.profitRatio != null) e.ratio = s.profitRatio; }
    return map;
  }, [stratsData]);

  const entries = useMemo(() => {
    const best = new Map();
    for (const run of (runsData?.runs || [])) {
      const pid = run.protocolId || '—';
      if (run.scores?.length) for (const s of run.scores) {
        const t = (s.ticker || s.symbol || '—').toUpperCase(); const k = `${pid}:${t}`; const sc = s.value ?? s.score ?? 0;
        if (!best.has(k) || sc > best.get(k).score) best.set(k, { ticker: t, score: sc, protocolId: pid });
      }
    }
    let list = [...best.values()].map(e => {
      const p = pnlMap.get(`${e.protocolId}:${e.ticker}`);
      return { ...e, protocolName: protoMap[e.protocolId] || e.protocolId, pnl: p?.pnl ?? null, ratio: p?.ratio ?? null };
    });
    if (protocolFilter !== 'all') list = list.filter(e => e.protocolId === protocolFilter);
    if (sortBy === 'score') list.sort((a, b) => b.score - a.score);
    else if (sortBy === 'pnl') list.sort((a, b) => (b.pnl ?? -Infinity) - (a.pnl ?? -Infinity));
    else if (sortBy === 'alpha') list.sort((a, b) => a.ticker.localeCompare(b.ticker));
    return list;
  }, [runsData, sortBy, protocolFilter, protoMap, pnlMap]);

  const ids = useMemo(() => { const s = new Set(entries.map(e => e.protocolId)); return ['all', ...s].sort(); }, [entries]);

  return (
    <div className="pl-page">
      <motion.header className="pl-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>Protocols Performance <PageInfoPopover>Every symbol per protocol with score + P&amp;L from live trading.</PageInfoPopover></h1>
      </motion.header>
      <div className="pl-toolbar">
        <label className="pl-filter">Sort:<select value={sortBy} onChange={e => setSortBy(e.target.value)}><option value="score">Score ▼</option><option value="pnl">P&amp;L ▼</option><option value="alpha">A→Z</option></select></label>
        <label className="pl-filter">Protocol:<select value={protocolFilter} onChange={e => setProtocolFilter(e.target.value)}><option value="all">All</option>{ids.filter(n => n !== 'all').map(id => <option key={id} value={id}>{protoMap[id] || id}</option>)}</select></label>
        <span className="pl-count">{entries.length} entries</span>
      </div>
      {rLoading ? <LoadingSkeleton variant="card" count={5} /> : (
        <div className="pl-table-wrap"><table className="pl-table"><thead><tr><th>#</th><th>Symbol</th><th>Score</th><th>Signal</th><th>Protocol</th><th>P&amp;L</th><th>Ratio</th></tr></thead><tbody>
          {entries.map((e, i) => (<tr key={`${e.protocolId}:${e.ticker}`}><td className="pl-rank">{i + 1}</td><td className="pl-symbol">{e.ticker}</td><td><span className={scoreClass(e.score)}>{e.score ?? '—'}</span></td><td>{signalBadge(e.score)}</td><td className="pl-muted">{e.protocolName}</td><td className={pnlClass(e.pnl)}>{pnlSign(e.pnl)}</td><td className="pl-muted">{e.ratio != null ? e.ratio.toFixed(2) : '—'}</td></tr>))}
        </tbody></table></div>
      )}
    </div>
  );
}
