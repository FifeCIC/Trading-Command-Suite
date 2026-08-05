/**
 * Directive Performance Audit (#283)
 * ===================================
 * Runs every directive against historical data and classifies into:
 *   TOP (>55% win rate) — keep and optimize
 *   REFINE (45-55%) — tweak parameters
 *   STUB (<45%) — remove or mark inactive
 *
 * Features:
 *   - Cross-symbol comparison (?symbols=XAUUSD,EURUSD)
 *   - Protocol impact chips (which protocols each directive affects)
 *   - One-click stub button
 *   - Trend history
 *
 * Data: GET /api/backtest/directive-audit
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import './directive-audit.css';

const BUCKETS = [
  { id: 'top', label: 'TOP', color: '#22c55e', desc: '>55% win rate' },
  { id: 'refine', label: 'REFINE', color: '#f59e0b', desc: '45-55% — near-random' },
  { id: 'stub', label: 'STUB', color: '#ef4444', desc: '<45% — no edge' },
  { id: 'noSignals', label: 'NO DATA', color: '#64748b', desc: '<3 signals' },
];

function WinRateBar({ value }) {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct > 55 ? '#22c55e' : pct >= 45 ? '#f59e0b' : '#ef4444';
  return (
    <div className="da-bar-track">
      <div className="da-bar-fill" style={{ width: `${pct}%`, background: color }} />
      <span className="da-bar-label">{value}%</span>
    </div>
  );
}

function ProtoChip({ slug }) {
  const isXau = slug.includes('xau'); const isGold = slug.includes('gold');
  const color = isXau ? '#f59e0b' : isGold ? '#eab308' : '#64748b';
  return <span className="da-proto-chip" style={{ background: color + '18', color, borderColor: color + '33' }}>{slug}</span>;
}

export default function DirectiveAuditPage() {
  const [symbol, setSymbol] = useState('XAUUSD,EURUSD');
  const [days, setDays] = useState(365);
  const [run, setRun] = useState(false);
  const [msg, setMsg] = useState('');
  const queryClient = useQueryClient();

  // ── Audit query ──
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['directive-audit', symbol, days],
    queryFn: () => {
      const isMulti = symbol.includes(',');
      const param = isMulti ? `symbols=${symbol}` : `symbol=${symbol}`;
      return apiGet(`/api/backtest/directive-audit?${param}&days=${days}`);
    },
    enabled: run,
    staleTime: 300_000,
  });

  // ── History query ──
  const { data: history } = useQuery({
    queryKey: ['audit-history'],
    queryFn: () => apiGet('/api/backtest/directive-audit/history?limit=10'),
    enabled: run,
    refetchInterval: 60000,
  });

  // ── Stub mutation ──
  const stubMutation = useMutation({
    mutationFn: (directiveId) => apiPost(`/api/directives/${directiveId}/stub`),
    onSuccess: (_, directiveId) => {
      setMsg(`Stubbed ${directiveId}`);
      setTimeout(() => setMsg(''), 2000);
      queryClient.invalidateQueries({ queryKey: ['directive-audit'] });
    },
    onError: (err) => { setMsg(`Failed: ${err.message}`); setTimeout(() => setMsg(''), 2000); },
  });

  const symbolResults = data?.perSymbol || [];
  const historyRuns = history?.runs || [];

  return (
    <div className="da-page">
      <motion.header className="da-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Directive Performance Audit</h1>
          <p className="da-subtitle">
            Backtests every directive individually. Classifies into TOP / REFINE / STUB buckets based on 10-day forward win rate.
            Use commas for cross-symbol: XAUUSD,EURUSD,SPX500.
          </p>
        </div>
        <div className="da-controls">
          <input className="da-input da-input-wide" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="XAUUSD,EURUSD" />
          <select className="da-input" value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={90}>90 days</option><option value={180}>180 days</option><option value={365}>365 days</option><option value={730}>730 days</option>
          </select>
          <button className="da-btn" onClick={() => setRun(true)} disabled={isFetching}>
            {isFetching ? '⏳ Running...' : run ? '🔄 Re-run' : '▶ Run Audit'}
          </button>
          {msg && <span className="da-msg">{msg}</span>}
        </div>
      </motion.header>

      {!run && <EmptyState icon="📊" title="Run the audit" description="Enter symbols (comma-separated for cross-symbol), pick days, and click Run." />}
      {isLoading && <LoadingSkeleton variant="card" count={3} />}

      {data && symbolResults.map((symResult, si) => {
        if (symResult.error) return <div key={si} className="da-error">{symResult.symbol}: {symResult.error}</div>;
        const s = symResult.summary;
        const allBuckets = BUCKETS.map(b => ({ ...b, items: symResult[b.id] || [], count: symResult[b.id]?.length || 0 }));
        return (
          <div key={symResult.symbol}>
            {/* Summary bar */}
            <motion.div className="da-summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: si * 0.15 }}>
              <strong className="da-sym-label">{symResult.symbol}</strong>
              <span className="da-summary-stat">{s.totalDirectives} directives</span>
              <span className="da-summary-stat" style={{ color: '#22c55e' }}>{s.top} TOP</span>
              <span className="da-summary-stat" style={{ color: '#f59e0b' }}>{s.refine} REFINE</span>
              <span className="da-summary-stat" style={{ color: '#ef4444' }}>{s.stub} STUB</span>
              <span className="da-summary-stat" style={{ color: '#64748b' }}>{s.noSignals} no data</span>
            </motion.div>

            {allBuckets.map((bucket, bi) => (
              <motion.section key={bucket.id} className="da-bucket" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: si * 0.15 + bi * 0.08 }}>
                <h2 className="da-bucket-title" style={{ color: bucket.color }}>
                  {bucket.label} ({bucket.count})
                  <span className="da-bucket-desc">{bucket.desc}</span>
                </h2>
                {bucket.count === 0 ? <p className="da-empty">No directives in this bucket.</p> : (
                  <div className="da-table">
                    <div className="da-thead">
                      <span className="da-th da-th-name">Directive</span>
                      <span className="da-th da-th-num">Signals</span>
                      <span className="da-th da-th-num">Win 5d</span>
                      <span className="da-th da-th-num">Ret 5d</span>
                      <span className="da-th da-th-num">Win 10d</span>
                      <span className="da-th da-th-num">Ret 10d</span>
                      <span className="da-th da-th-proto">Protocols</span>
                      <span className="da-th da-th-act">Action</span>
                    </div>
                    {bucket.items.map((d) => (
                      <div key={d.directiveId} className="da-tr">
                        <span className="da-td da-td-name">
                          <code className="da-code">{d.directiveId}</code>
                          <a className="da-name-link" href={`/scoring/directive-detail?id=${encodeURIComponent(d.directiveId)}`} target="_blank" rel="noopener noreferrer" title="Open directive detail in new tab">{d.name}</a>
                        </span>
                        <span className="da-td da-td-num">{d.signals}</span>
                        <span className="da-td da-td-num"><WinRateBar value={d.winRate5d} /></span>
                        <span className="da-td da-td-num" style={{ color: (d.avgReturn5d || 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                          {(d.avgReturn5d || 0) >= 0 ? '+' : ''}{d.avgReturn5d}%
                        </span>
                        <span className="da-td da-td-num"><WinRateBar value={d.winRate10d} /></span>
                        <span className="da-td da-td-num" style={{ color: (d.avgReturn10d || 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                          {(d.avgReturn10d || 0) >= 0 ? '+' : ''}{d.avgReturn10d}%
                        </span>
                        <span className="da-td da-td-proto">
                          {(d.protocols || []).slice(0, 4).map(p => <ProtoChip key={p} slug={p} />)}
                          {(d.protocols || []).length > 4 && <span className="da-proto-more">+{d.protocols.length - 4}</span>}
                        </span>
                        <span className="da-td da-td-act">
                          {bucket.id === 'stub' && (
                            <button className="da-stub-btn" onClick={() => stubMutation.mutate(d.directiveId)} title="Mark as alpha — exclude from composites">
                              STUB
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </motion.section>
            ))}
          </div>
        );
      })}

      {/* Trend History */}
      {historyRuns.length > 0 && (
        <motion.section className="da-bucket" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
          <h2 className="da-bucket-title" style={{ color: '#8b5cf6' }}>Audit History ({historyRuns.length})</h2>
          <div className="da-table">
            <div className="da-thead">
              <span className="da-th da-th-name">Date</span>
              <span className="da-th da-th-num">Symbol</span>
              <span className="da-th da-th-num">Days</span>
              <span className="da-th da-th-num">TOP</span>
              <span className="da-th da-th-num">REFINE</span>
              <span className="da-th da-th-num">STUB</span>
            </div>
            {historyRuns.map((r) => (
              <div key={r.id} className="da-tr">
                <span className="da-td da-td-name">{new Date(r.runAt).toLocaleDateString()} {new Date(r.runAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="da-td da-td-num">{r.symbol}</span>
                <span className="da-td da-td-num">{r.days}</span>
                <span className="da-td da-td-num" style={{ color: '#22c55e' }}>{r.topCount}</span>
                <span className="da-td da-td-num" style={{ color: '#f59e0b' }}>{r.refineCount}</span>
                <span className="da-td da-td-num" style={{ color: '#ef4444' }}>{r.stubCount}</span>
              </div>
            ))}
          </div>
        </motion.section>
      )}
    </div>
  );
}
