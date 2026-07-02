import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './sees-arena.css';

// ── Tooltip (hover for methodology) ──
function Tooltip({ content }) {
  if (!content) return null;
  return (
    <span className="sa-tooltip-wrap">
      <span className="sa-tooltip-trigger">?</span>
      <span className="sa-tooltip-content">{content}</span>
    </span>
  );
}

function ProtocolChip({ id, name, description, active, onToggle }) {
  return (
    <button type="button" className={`sa-protocol-chip ${active ? 'sa-chip-active' : ''}`}
      onClick={() => onToggle(id)} title={description}>
      {name || id}
    </button>
  );
}

function scoreClass(v, hardGated) {
  if (hardGated) return 'sa-score-gated';
  if (v >= 65) return 'sa-score-high';
  if (v >= 40) return 'sa-score-med';
  return 'sa-score-low';
}

const CONSENSUS_LABELS = {
  strong_buy: '🔥 Strong Buy', buy: '▲ Buy', mixed: '◆ Mixed',
  sell: '▼ Sell', strong_sell: '🧊 Strong Sell',
};

export default function SeesArenaPage() {
  const [tab, setTab] = useState('compare');
  const [symbolsInput, setSymbolsInput] = useState('SPY, QQQ, NVDA, XAUUSD, BTCUSD');
  const [selectedProtocols, setSelectedProtocols] = useState(null);
  const [compResult, setCompResult] = useState(null);
  const [comparing, setComparing] = useState(false);

  const filtersQuery = useQuery({
    queryKey: ['arena-filters'], queryFn: () => apiGet('/api/scoring/arena/filters'), staleTime: 60_000,
  });
  const protocols = filtersQuery.data?.protocols || [];
  const allProtocolIds = useMemo(() => protocols.map((p) => p.id), [protocols]);
  const activeProtocols = selectedProtocols || allProtocolIds;
  const protocolMap = useMemo(() => {
    const m = {}; for (const p of protocols) m[p.id] = p; return m;
  }, [protocols]);

  const arenaQuery = useQuery({
    queryKey: ['arena'], queryFn: () => apiGet('/api/scoring/arena'),
    staleTime: 15_000, refetchInterval: 30_000, enabled: tab === 'stacks',
  });

  function toggleProtocol(id) {
    if (!selectedProtocols) {
      setSelectedProtocols(allProtocolIds.filter((p) => p !== id));
    } else if (selectedProtocols.includes(id)) {
      const next = selectedProtocols.filter((p) => p !== id);
      setSelectedProtocols(next.length === 0 ? null : next);
    } else { setSelectedProtocols([...selectedProtocols, id]); }
  }

  async function runComparison() {
    const syms = symbolsInput.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!syms.length) return;
    setComparing(true);
    try {
      const r = await apiPost('/api/scoring/arena/compare', { symbols: syms, protocols: selectedProtocols || undefined });
      setCompResult(r);
    } catch { setCompResult({ error: 'Comparison failed — backend may be offline.' }); }
    setComparing(false);
  }

  return (
    <div className="sa-page">
      <header className="sa-header">
        <div>
          <h1>SEES Arena</h1>
          <p className="sa-subtitle">Multi-protocol scoring comparison — see how different strategies rate your symbols.</p>
        </div>
      </header>

      <div className="sa-tabs">
        <button className={`sa-tab ${tab === 'compare' ? 'sa-active' : ''}`} onClick={() => setTab('compare')}>Compare Protocols</button>
        <button className={`sa-tab ${tab === 'stacks' ? 'sa-active' : ''}`} onClick={() => setTab('stacks')}>Strategy Stacks</button>
      </div>

      {tab === 'compare' && (<>
        <div className="sa-controls">
          <input type="text" className="sa-symbol-input" placeholder="Symbols: SPY, QQQ, NVDA, XAUUSD..."
            value={symbolsInput} onChange={(e) => setSymbolsInput(e.target.value)} />
          <button className="sa-btn" onClick={runComparison} disabled={comparing}>
            {comparing ? '⟳ Comparing...' : '▶ Compare'}
          </button>
        </div>

        <div className="sa-protocol-toggles">
          {protocols.map((p) => (
            <ProtocolChip key={p.id} id={p.id} name={p.name} description={p.description}
              active={activeProtocols.includes(p.id)} onToggle={toggleProtocol} />
          ))}
          {protocols.length === 0 && <span className="sa-hint">Loading protocols...</span>}
        </div>

        {comparing && <LoadingSkeleton variant="card" count={4} />}
        {compResult?.error && <p className="sa-empty">{compResult.error}</p>}

        {compResult?.comparison?.length > 0 && (
          <div className="sa-compare-wrap">
            <table className="sa-compare-table">
              <thead><tr>
                <th>Symbol</th>
                {activeProtocols.map((pid) => (
                  <th key={pid} className="sa-th-protocol">
                    {protocolMap[pid]?.name || pid}
                    <Tooltip content={
                      (protocolMap[pid]?.description || '') +
                      '\n\nStyle: ' + (protocolMap[pid]?.tradingStyle || '—') +
                      '  |  TF: ' + (protocolMap[pid]?.recommendedTimeframe || '—') +
                      '\nBest for: ' + (protocolMap[pid]?.idealFor || '—')
                    } />
                  </th>
                ))}
                <th>Consensus</th>
                <th>Diverge</th>
              </tr></thead>
              <tbody>
                {compResult.comparison.map((row) => (
                  <tr key={row.symbol}>
                    <td className="sa-td-symbol">{row.symbol}</td>
                    {activeProtocols.map((pid) => {
                      const ps = row.protocolScores.find((p) => p.protocolId === pid);
                      if (!ps) return <td key={pid}>—</td>;
                      return (<td key={pid}>
                        <span className={`sa-score-cell ${scoreClass(ps.score, ps.hardGated)}`}
                          title={ps.warnings?.join('; ') || (ps.hardGated ? 'Hard-gated' : '')}>
                          {ps.hardGated ? '⛔' : ps.score.toFixed(0)}
                        </span><br/>
                        <span className={`sa-sig-badge sa-sig-${ps.signal}`}>{ps.signal}</span>
                      </td>);
                    })}
                    <td><span className={`sa-consensus sa-con-${row.consensus}`}>
                      {CONSENSUS_LABELS[row.consensus] || row.consensus}</span></td>
                    <td><span className={`sa-divergence ${row.divergence >= 20 ? 'sa-div-high' : 'sa-div-low'}`}>
                      {row.divergence.toFixed(1)}</span>
                      {row.divergence >= 20 && <Tooltip content="High divergence — protocols disagree. Investigate before trading." />}
                    </td>
                  </tr>
                ))}
                <tr className="sa-summary-row">
                  <td className="sa-td-symbol"><strong>Summary</strong>
                    <Tooltip content="Average scores + consensus across protocols. High divergence = disagreement — investigate. Strong consensus = clearer signal." />
                  </td>
                  {activeProtocols.map((pid) => {
                    const vals = compResult.comparison.map((r) => r.protocolScores.find((p) => p.protocolId === pid)?.score || 0);
                    const avg = vals.length ? vals.reduce((a,b) => a+b,0)/vals.length : 0;
                    return <td key={pid}><strong>{avg.toFixed(0)}</strong></td>;
                  })}
                  <td><span className="sa-hint">
                    {compResult.comparison.filter((r) => r.consensus === 'strong_buy' || r.consensus === 'buy').length} buy / {compResult.comparison.length} total
                  </span></td><td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {!compResult && !comparing && (
          <div className="sa-empty">
            <p>Enter symbols and click <strong>Compare</strong> to see how protocols rate them side-by-side.</p>
            <p className="sa-hint">Hover over <strong>?</strong> icons for protocol methodology explanations.</p>
          </div>
        )}

        {compResult?.comparison?.length > 0 && (
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', fontSize: '0.65rem', color: 'var(--ink-soft)', flexWrap: 'wrap' }}>
            <span><span className="sa-score-high" style={{ padding: '1px 6px', borderRadius: 3 }}>65+</span> Strong</span>
            <span><span className="sa-score-med" style={{ padding: '1px 6px', borderRadius: 3 }}>40-64</span> Moderate</span>
            <span><span className="sa-score-low" style={{ padding: '1px 6px', borderRadius: 3 }}>&lt;40</span> Weak</span>
            <span><span className="sa-score-gated" style={{ padding: '1px 6px', borderRadius: 3 }}>⛔</span> Hard-gated</span>
            <span>|</span>
            <span><span className="sa-div-high">20+</span> High divergence</span>
          </div>
        )}
      </>)}

      {tab === 'stacks' && (<>
        {arenaQuery.isLoading && <p className="sa-loading">Loading strategies...</p>}
        {arenaQuery.data?.stacks?.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem' }}>
            {arenaQuery.data.stacks.map((stack) => (
              <div key={stack.strategyId} style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, padding: '0.75rem' }}>
                <div style={{ borderTop: `3px solid ${stack.color}`, paddingTop: '0.5rem', marginBottom: '0.5rem' }}>
                  <strong style={{ fontSize: '0.82rem' }}>{stack.strategyName}</strong>
                  {stack.description && (
                    <span style={{ fontSize: '0.62rem', color: 'var(--ink-soft)', display: 'block', marginTop: 2, lineHeight: 1.4 }}>
                      {stack.description}
                    </span>
                  )}
                  <span style={{ fontSize: '0.62rem', color: 'var(--ink-soft)', display: 'block', marginTop: 4 }}>
                    {stack.symbols?.length ?? 0} symbols scored
                  </span>
                </div>
                <div style={{ maxHeight: 350, overflowY: 'auto' }}>
                  {stack.symbols?.map((s) => (
                    <div key={s.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.25rem 0', fontSize: '0.73rem', borderBottom: '1px solid rgba(128,128,128,0.06)' }}>
                      <span>
                        <strong>{s.symbol}</strong>
                        <span style={{ fontSize: '0.6rem', color: 'var(--ink-soft)', marginLeft: 4 }}>
                          {s.signal === 'BUY' ? '▲' : s.signal === 'SELL' ? '▼' : '◆'}
                        </span>
                      </span>
                      <span className={s.score >= 65 ? 'sa-score-high' : s.score >= 40 ? 'sa-score-med' : 'sa-score-low'}
                        style={{ fontWeight: 700, padding: '1px 4px', borderRadius: 3 }}>
                        {s.score.toFixed(0)}
                      </span>
                    </div>
                  ))}
                  {(!stack.symbols || stack.symbols.length === 0) && (
                    <span style={{ fontSize: '0.65rem', color: 'var(--ink-soft)' }}>No symbols scored yet — run Compare first or wait for background scoring.</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {arenaQuery.data && !arenaQuery.data.stacks?.length && (
          <div className="sa-empty">
            <p>No trading strategies have scored data yet.</p>
            <p className="sa-hint">Strategies score symbols using protocol groups. Run a comparison or scoring run to populate stacks.</p>
          </div>
        )}
        {!arenaQuery.data && !arenaQuery.isLoading && <p className="sa-empty">Backend unavailable.</p>}
      </>)}
    </div>
  );
}
