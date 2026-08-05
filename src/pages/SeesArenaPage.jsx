import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './sees-arena.css';
import PageInfoPopover from '../components/PageInfoPopover';

const STORAGE_KEY = 'tcs:arena-state';

/** Load persisted arena state from localStorage */
function loadArenaState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { symbolsInput: 'SPY, QQQ, NVDA, XAUUSD, BTCUSD', selectedProtocols: null, autoRun: false };
}

/** Save arena state to localStorage */
function saveArenaState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }
}

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

function ProtocolChip({ id, name, description, active, onToggle, dataInsufficient }) {
  return (
    <button
      type="button"
      className={`sa-protocol-chip ${active ? 'sa-chip-active' : ''} ${dataInsufficient ? 'sa-chip-disabled' : ''}`}
      onClick={() => onToggle(id)}
      title={dataInsufficient ? `${name}: insufficient data (requires MT5 connected)` : description}
    >
      {dataInsufficient && <span className="sa-chip-warn">⚠️</span>}
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
  // ── Persisted state from localStorage ──
  const saved = useMemo(() => loadArenaState(), []);

  const [tab, setTab] = useState('compare');
  const [selectedProtocols, setSelectedProtocols] = useState(saved.selectedProtocols);
  const [compResult, setCompResult] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [autoRun, setAutoRun] = useState(saved.autoRun);
  const autoRunRef = useRef(autoRun);

  useEffect(() => { autoRunRef.current = autoRun; }, [autoRun]);

  useEffect(() => {
    saveArenaState({ symbolsInput: '', selectedProtocols, autoRun });
  }, [selectedProtocols, autoRun]);

  const filtersQuery = useQuery({
    queryKey: ['arena-filters'], queryFn: () => apiGet('/api/scoring/arena/filters'), staleTime: 60_000,
  });
  const protocols = filtersQuery.data?.protocols || [];
  const allProtocolIds = useMemo(() => protocols.map((p) => p.id), [protocols]);

  // Determine which protocols have insufficient data (e.g. need MT5)
  const dataInsufficientIds = useMemo(() => {
    return new Set(
      protocols
        .filter((p) => p.requiresMt5 && !filtersQuery.data?.mt5Connected)
        .map((p) => p.id)
    );
  }, [protocols, filtersQuery.data?.mt5Connected]);

  // Build protocol lookup map early (needed by defaultProtocols)
  const protocolMap = useMemo(() => {
    const m = {}; for (const p of protocols) m[p.id] = p; return m;
  }, [protocols]);

  // Default active = all protocols that have sufficient data AND are active
  const defaultProtocols = useMemo(
    () => allProtocolIds.filter((id) => {
      if (dataInsufficientIds.has(id)) return false;
      const proto = protocolMap[id];
      // Filter out inactive/disabled protocols
      if (proto && (proto.active === false || proto.status === 'inactive' || proto.status === 'disabled')) return false;
      return true;
    }),
    [allProtocolIds, dataInsufficientIds, protocolMap]
  );

  const activeProtocols = selectedProtocols || defaultProtocols;

  const arenaQuery = useQuery({
    queryKey: ['arena'], queryFn: () => apiGet('/api/scoring/arena'),
    staleTime: 15_000, refetchInterval: 30_000, enabled: tab === 'stacks',
  });

  function toggleProtocol(id) {
    if (dataInsufficientIds.has(id)) return; // can't toggle data-insufficient
    if (!selectedProtocols) {
      setSelectedProtocols(defaultProtocols.filter((p) => p !== id));
    } else if (selectedProtocols.includes(id)) {
      const next = selectedProtocols.filter((p) => p !== id);
      setSelectedProtocols(next.length === 0 ? null : next);
    } else { setSelectedProtocols([...selectedProtocols, id]); }
  }

  // ── Derive symbols from selected protocols' linked watchlists ──
  const derivedSymbols = useMemo(() => {
    if (!selectedProtocols || !protocols.length) return [];
    const symbolSet = new Set();
    for (const pid of selectedProtocols) {
      const proto = protocolMap[pid];
      const watchlists = proto?.linkedWatchlists || [];
      for (const wl of watchlists) {
        // linkedWatchlists can be strings (names) or objects with symbols
        if (typeof wl === 'string') {
          // We'll collect watchlist names; symbols resolved at compare time
          symbolSet.add(`__wl__${wl}`);
        }
      }
    }
    return [...symbolSet];
  }, [selectedProtocols, protocolMap, protocols]);

  const runComparison = useCallback(async () => {
    if (!selectedProtocols?.length) return;
    setComparing(true);
    try {
      // Collect all symbols from all selected protocols via the new symbols endpoint
      const allSymbols = new Set();
      for (const pid of selectedProtocols) {
        try {
          const res = await apiGet(`/api/scoring/gated/protocols/${pid}/symbols`).catch(() => ({ symbols: [] }));
          for (const s of (res.symbols || [])) {
            if (s) allSymbols.add(s.toUpperCase());
          }
        } catch { /* protocol may not have symbols */ }
      }
      const symbols = [...allSymbols];
      if (!symbols.length) {
        setCompResult({ error: 'No symbols found for the selected protocols. Check that protocols have linked watchlists or single-symbol config.' });
        setComparing(false);
        return;
      }
      const r = await apiPost('/api/scoring/arena/compare', { symbols, protocols: selectedProtocols });
      setCompResult(r);
    } catch { setCompResult({ error: 'Comparison failed — backend may be offline.' }); }
    setComparing(false);
  }, [selectedProtocols, protocolMap]);

  // ── Auto-run on mount if user had it enabled ──
  useEffect(() => {
    if (autoRunRef.current && protocols.length > 0 && selectedProtocols?.length > 0) {
      runComparison();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protocols.length]);

  return (
    <div className="sa-page">
      <header className="sa-header">
        <div>
          <h1>SEES Arena
          <PageInfoPopover>
            Multi-protocol scoring comparison — see how different strategies rate your symbols. Only selected protocols run — data-insufficient ones (⚠️) are automatically excluded.
          </PageInfoPopover>
        </h1>
        </div>
      </header>

      <div className="sa-tabs">
        <button className="sa-tab sa-active">Compare Protocols</button>
      </div>

      <>
        <div className="sa-controls">
          <button className="sa-btn" onClick={() => runComparison()} disabled={comparing || !selectedProtocols?.length}>
            {comparing ? '⟳ Comparing...' : '▶ Compare All Watchlist Symbols'}
          </button>
          <label className="sa-autorun-toggle" title="Remember selections and auto-run on return">
            <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
            <span>Auto-run</span>
          </label>
        </div>

        <div className="sa-protocol-toggles">
          {protocols.map((p) => (
            <ProtocolChip key={p.id} id={p.id} name={p.name} description={p.description}
              active={activeProtocols.includes(p.id)} dataInsufficient={dataInsufficientIds.has(p.id)}
              onToggle={toggleProtocol} />
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
                          {ps.hardGated ? '⛔' : `${ps.score.toFixed(0)}%`}
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
            <p>Select protocols above and click <strong>Compare</strong> to see how they rate their watchlist symbols side-by-side.</p>
            <p className="sa-hint">Symbols are auto-derived from each protocol's linked watchlists. Hover over <strong>?</strong> icons for methodology.</p>
          </div>
        )}

        {compResult?.comparison?.length > 0 && (
          <div className="il-flex-wrap il-mt-1 il-fs-065" style={{ color: 'var(--ink-soft)' }}>
            <span><span className="sa-score-high il-chip-pad">65+</span> Strong</span>
            <span><span className="sa-score-med il-chip-pad">40-64</span> Moderate</span>
            <span><span className="sa-score-low il-chip-pad">&lt;40</span> Weak</span>
            <span><span className="sa-score-gated il-chip-pad">⛔</span> Hard-gated</span>
            <span>|</span>
            <span><span className="sa-div-high">20+</span> High divergence</span>
          </div>
        )}
      </>
    </div>
  );
}
