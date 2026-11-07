import { useState, useEffect, useCallback } from 'react';
import NoticeBlock from '../components/NoticeBlock';
import { noticeFromError } from '../core/notices/from-error.js';
import './scoring-debug-lab.css';

const API = '/api';
const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDCAD', 'XAUUSD', 'USDJPY', 'US500', 'BTC-USD'];
const TIMEFRAMES = ['5m', '15m', '1h'];

/**
 * FALLBACK_PAIR — the pair this page used to hardcode, kept so the inspector still runs when the
 * protocol list cannot be read. A picker that empties itself because one request failed would hide
 * the feature rather than degrade it.
 */
const FALLBACK_PAIR = { key: 'mt5-technical-core-v1', long: 'mt5-technical-core-v1-long', short: 'default-short' };

/**
 * pairsFrom(protocols) — group protocols into LONG × SHORT pairs.
 *
 * ⚠️ THE PAIR IS THE THING BEING COMPARED, NOT THE SYMBOL (owner, 2026-11-07: *"change this menu to
 * contain protocol pairs"*). The ids follow `<base>-long` / `<base>-short`, so the base is the pair's
 * identity. A base with only one side is still offered — comparing a live protocol against the
 * fallback short is exactly what this page was doing before, and hiding it would remove a case that
 * works.
 */
function pairsFrom(protocols) {
  const byBase = new Map();
  for (const p of protocols || []) {
    const id = p.protocolId || p.id || p.slug;
    if (!id) continue;
    const base = id.replace(/-(long|short)$/i, '');
    const entry = byBase.get(base) || { key: base, label: p.name || base };
    if (/-short$/i.test(id)) entry.short = id; else entry.long = id;
    byBase.set(base, entry);
  }
  return [...byBase.values()]
    .filter((e) => e.long || e.short)
    .map((e) => ({ ...e, long: e.long || e.short, short: e.short || e.long }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export default function ScoringDebugLab() {
  const [symbol, setSymbol] = useState('EURUSD');
  const [timeframe, setTimeframe] = useState('5m');
  const [barCount, setBarCount] = useState(100);
  const [pairs, setPairs] = useState([FALLBACK_PAIR]);
  const [pairKey, setPairKey] = useState(FALLBACK_PAIR.key);
  const [search, setSearch] = useState('');
  const [longResult, setLongResult] = useState(null);
  const [shortResult, setShortResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /** The chosen pair, falling back to the first option so a stale selection cannot empty the page. */
  const activePair = pairs.find((p) => p.key === pairKey) || pairs[0] || FALLBACK_PAIR;

  /* Protocol list → pairs. Fail-open: a failed read leaves the fallback pair in place. */
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/scoring/protocols`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((list) => {
        if (cancelled) return;
        const found = pairsFrom(Array.isArray(list) ? list : list?.protocols);
        if (found.length) setPairs(found);
      })
      .catch(() => { /* keep the fallback pair — see FALLBACK_PAIR */ });
    return () => { cancelled = true; };
  }, []);

  const filteredPairs = pairs.filter((p) => (
    !search.trim() || `${p.key} ${p.label || ''} ${p.long} ${p.short}`.toLowerCase().includes(search.trim().toLowerCase())
  ));

  const fetchScores = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = `protocol=${encodeURIComponent(activePair.long)}&bars=${barCount}&timeframe=${timeframe}`;
      const shortParams = `protocol=${encodeURIComponent(activePair.short)}&bars=${barCount}&timeframe=${timeframe}`;
      const [l, s] = await Promise.all([
        fetch(`${API}/scoring/gated/${symbol}?${params}`).then(r => r.json()),
        fetch(`${API}/scoring/gated/${symbol}?${shortParams}`).then(r => r.json()),
      ]);
      setLongResult(l);
      setShortResult(s);
    } catch (err) {
      setError(noticeFromError(err, 'TCS-SYS-007', { operation: 'load the gated scoring result' }));
    }
    setLoading(false);
  }, [symbol, timeframe, barCount, activePair.long, activePair.short]);

  useEffect(() => { fetchScores(); }, [fetchScores]);

  const winner =
    !longResult || !shortResult ? null :
    longResult.composite > shortResult.composite ? 'LONG' :
    shortResult.composite > longResult.composite ? 'SHORT' : 'HOLD';

  const winnerClass = winner === 'LONG' ? 'win-long' : winner === 'SHORT' ? 'win-short' : 'win-hold';

  return (
    <div className="sdl-page">
      <header className="sdl-header">
        <h2>🔬 Dual-Protocol Inspector</h2>
        <p className="muted">
          Compare LONG (mt5-technical-core-v1-long) vs SHORT (vix-spike-v1-short) protocol scores in real time.
          This is a Lab tool to explore the dual-protocol scoring pipeline.
        </p>
      </header>

      {/* Controls */}
      <div className="sdl-controls">
        {/* ⚠️ SEARCH + PAIR PICKER (owner, 2026-11-07: *"Add a search to this bar … and change this menu
            to contain protocol pairs"*). The bar used to offer a SYMBOL list while the two protocols
            being compared were hardcoded in the fetch — so the one thing the page is named after was
            the one thing that could not be chosen. Symbol stays (a score is per symbol); the PAIR is
            now the primary selection and the search filters it. */}
        <label>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter protocols…"
            aria-label="Filter protocol pairs"
          />
        </label>
        <label>
          Protocol pair
          <select value={activePair.key} onChange={(e) => setPairKey(e.target.value)}>
            {filteredPairs.length === 0 && <option value={activePair.key}>No pair matches “{search}”</option>}
            {filteredPairs.map((p) => (
              <option key={p.key} value={p.key}>{p.key}</option>
            ))}
          </select>
        </label>
        <label>
          Symbol
          <select value={symbol} onChange={e => setSymbol(e.target.value)}>
            {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Timeframe
          <select value={timeframe} onChange={e => setTimeframe(e.target.value)}>
            {TIMEFRAMES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Bars
          <input type="number" value={barCount} min={10} max={500} step={10}
            onChange={e => setBarCount(Number(e.target.value))} />
        </label>
        <button onClick={fetchScores} disabled={loading} className="sdl-refresh">
          {loading ? '⏳ Scoring...' : '↻ Refresh'}
        </button>
      </div>

{error && <div className="sdl-error"><NoticeBlock notice={error} compact /></div>}

      {/* Head-to-Head Comparison */}
      <div className="sdl-comparison">
        {/* LONG side */}
        <div className={`sdl-protocol ${winner === 'LONG' ? 'sdl-winner' : ''}`}>
          <div className="sdl-protocol-header long">
            <h3>📈 LONG Protocol</h3>
            <code>mt5-technical-core-v1-long</code>
            <span className="sdl-direction">LONG_ONLY</span>
          </div>
          {longResult ? (
            <>
              <div className="sdl-big-score">
                <span className="sdl-composite">{longResult.composite}</span>
                <span className={`sdl-signal sdl-${longResult.signal?.toLowerCase()}`}>
                  {longResult.signal}
                </span>
              </div>
              {/* Raw total summary */}
              {longResult.subRawTotals && (
                <div className="sdl-raw-total">
                  {(() => {
                    const raw = Object.values(longResult.subRawTotals || {}).reduce((a,b) => a+b, 0);
                    const max = Object.values(longResult.subMaxTotals || {}).reduce((a,b) => a+b, 0);
                    return <span>Raw: <strong>{raw}</strong> / {max} = <strong>{max > 0 ? Math.round(raw/max*100) : 0}%</strong></span>;
                  })()}
                </div>
              )}
              <div className="sdl-subscores">
                {Object.entries(longResult.subScores || {}).map(([key, val]) => {
                  const raw = longResult.subRawTotals?.[key];
                  const max = longResult.subMaxTotals?.[key];
                  return (
                    <div key={key} className="sdl-subscore">
                      <span className="sdl-sub-label">{key}</span>
                      <div className="sdl-sub-bar-wrap">
                        <div className="sdl-sub-bar" style={{ width: `${Math.min(100, val || 0)}%` }} />
                      </div>
                      <span className="sdl-sub-val">{val ?? '—'}%</span>
                      {raw !== undefined && <span className="sdl-sub-raw">{raw}/{max}</span>}
                    </div>
                  );
                })}
              </div>
              {longResult.riskGating && (
                <div className="sdl-risk-info">
                  <span className="muted">Risk gate:</span>
                  <span>×{longResult.riskGating.multiplier?.toFixed(2) || '—'}</span>
                  {longResult.riskGating.hardGateTriggered && <span className="sdl-hard-gate">🚫 HARD GATE</span>}
                </div>
              )}
              {longResult.breakouts && (
                <details className="sdl-breakdown">
                  <summary>Directive breakdown ({Object.values(longResult.breakouts).flat().length} directives)</summary>
                  <div className="sdl-directive-list">
                    {Object.entries(longResult.breakouts).map(([groupId, directives]) => (
                      <div key={groupId} className="sdl-directive-group">
                        <h5>{groupId}</h5>
                        {directives.slice(0, 5).map((d, i) => (
                          <div key={i} className={`sdl-directive ${d.signalClass}`}>
                            <span className="sdl-dir-name">{d.name}</span>
                            <span className="sdl-dir-score">{d.normalizedScore ?? d.score}</span>
                            <span className="sdl-dir-class">{d.signalClass}</span>
                          </div>
                        ))}
                        {directives.length > 5 && <div className="sdl-more">+{directives.length - 5} more</div>}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          ) : <div className="sdl-loading">Loading...</div>}
        </div>

        {/* VS */}
        <div className="sdl-vs">
          <div className={`sdl-winner-badge ${winnerClass}`}>
            {winner === 'LONG' ? '← LONG WINS' : winner === 'SHORT' ? 'SHORT WINS →' : 'HOLD'}
          </div>
        </div>

        {/* SHORT side */}
        <div className={`sdl-protocol ${winner === 'SHORT' ? 'sdl-winner' : ''}`}>
          <div className="sdl-protocol-header short">
            <h3>📉 SHORT Protocol</h3>
            <code>default-short</code>
            <span className="sdl-direction">SHORT_ONLY</span>
          </div>
          {shortResult ? (
            <>
              <div className="sdl-big-score">
                <span className="sdl-composite">{shortResult.composite}</span>
                <span className={`sdl-signal sdl-${shortResult.signal?.toLowerCase()}`}>
                  {shortResult.signal}
                </span>
              </div>
              {/* Raw total summary */}
              {shortResult.subRawTotals && (
                <div className="sdl-raw-total">
                  {(() => {
                    const raw = Object.values(shortResult.subRawTotals || {}).reduce((a,b) => a+b, 0);
                    const max = Object.values(shortResult.subMaxTotals || {}).reduce((a,b) => a+b, 0);
                    return <span>Raw: <strong>{raw}</strong> / {max} = <strong>{max > 0 ? Math.round(raw/max*100) : 0}%</strong></span>;
                  })()}
                </div>
              )}
              <div className="sdl-subscores">
                {Object.entries(shortResult.subScores || {}).map(([key, val]) => {
                  const raw = shortResult.subRawTotals?.[key];
                  const max = shortResult.subMaxTotals?.[key];
                  return (
                    <div key={key} className="sdl-subscore">
                      <span className="sdl-sub-label">{key}</span>
                      <div className="sdl-sub-bar-wrap">
                        <div className="sdl-sub-bar short" style={{ width: `${Math.min(100, val || 0)}%` }} />
                      </div>
                      <span className="sdl-sub-val">{val ?? '—'}%</span>
                      {raw !== undefined && <span className="sdl-sub-raw">{raw}/{max}</span>}
                    </div>
                  );
                })}
              </div>
              {shortResult.riskGating && (
                <div className="sdl-risk-info">
                  <span className="muted">Risk gate:</span>
                  <span>×{shortResult.riskGating.multiplier?.toFixed(2) || '—'}</span>
                  {shortResult.riskGating.hardGateTriggered && <span className="sdl-hard-gate">🚫 HARD GATE</span>}
                </div>
              )}
              {shortResult.breakouts && (
                <details className="sdl-breakdown">
                  <summary>Directive breakdown ({Object.values(shortResult.breakouts).flat().length} directives)</summary>
                  <div className="sdl-directive-list">
                    {Object.entries(shortResult.breakouts).map(([groupId, directives]) => (
                      <div key={groupId} className="sdl-directive-group">
                        <h5>{groupId}</h5>
                        {directives.slice(0, 5).map((d, i) => (
                          <div key={i} className={`sdl-directive ${d.signalClass}`}>
                            <span className="sdl-dir-name">{d.name}</span>
                            <span className="sdl-dir-score">{d.normalizedScore ?? d.score}</span>
                            <span className="sdl-dir-class">{d.signalClass}</span>
                          </div>
                        ))}
                        {directives.length > 5 && <div className="sdl-more">+{directives.length - 5} more</div>}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          ) : <div className="sdl-loading">Loading...</div>}
        </div>
      </div>

      {/* Decision Summary */}
      {winner && (
        <div className={`sdl-decision ${winnerClass}`}>
          <h3>Decision: {winner}</h3>
          <p>
            {winner === 'HOLD'
              ? `Both protocols scored too low to act. LONG=${longResult?.composite} SHORT=${shortResult?.composite}`
              : `${winner} protocol wins: ${winner === 'LONG' ? longResult?.composite : shortResult?.composite} vs ${winner === 'LONG' ? shortResult?.composite : longResult?.composite}`
            }
          </p>
        </div>
      )}

      {/* How This Works */}
      <details className="sdl-how">
        <summary>How dual-protocol scoring works</summary>
        <div className="sdl-how-content">
          <ol>
            <li><strong>LONG protocol</strong> runs directives tagged <code>bullish</code> or <code>neutral</code>. Bearish directives are filtered out.</li>
            <li><strong>SHORT protocol</strong> runs directives tagged <code>bearish</code> or <code>neutral</code>. Bullish directives are filtered out.</li>
            <li>Each side computes a composite (0–100) from technical + sentiment groups, gated by risk multipliers.</li>
            <li>The <strong>higher composite wins</strong> — if LONG &gt; SHORT → BUY, if SHORT &gt; LONG → SELL.</li>
            <li>If both sides are close or below minimum threshold → <strong>HOLD</strong> (no trade).</li>
          </ol>
        </div>
      </details>
    </div>
  );
}
