import { useState, useEffect, useCallback, useRef } from 'react';
import { apiGet } from '../core/api/client';
import './portfolio-lab.css';

const REFRESH_MS = 30_000;

function chatPost(body) {
  return fetch('http://localhost:3201/api/lab/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

function analyzePost(body) {
  return fetch('http://localhost:3201/api/lab/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

function classifyPost(body) {
  return fetch('http://localhost:3201/api/lab/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

// ── Colour coding ────────────────────────────────────────
const SIGNAL_COLORS = {
  strong_buy: '#22c55e',
  buy: '#3b82f6',
  hold: '#a1a1aa',
  weak: '#f59e0b',
  no_data: '#ef4444',
};

const REC_COLORS = {
  buy_more: '#22c55e',
  hold: '#a1a1aa',
  reduce: '#f59e0b',
  sell: '#ef4444',
  average_down: '#3b82f6',
  evaluate: '#f59e0b',
};

export default function PortfolioLabPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [scores, setScores] = useState(null);
  const [classifications, setClassifications] = useState(null);
  const [scenarios, setScenarios] = useState(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  // ── Load portfolio + scores ──────────────────────────
  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [portfolio, scoreData] = await Promise.all([
        apiGet('/api/portfolio/summary?source=trading212').catch(() => null),
        apiGet('/api/portfolio/scores').catch(() => null),
      ]);
      setData(portfolio);
      setScores(scoreData);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh
  useEffect(() => {
    const i = setInterval(loadData, REFRESH_MS);
    return () => clearInterval(i);
  }, [loadData]);

  // ── Classify when data arrives ────────────────────────
  useEffect(() => {
    if (!data?.summary || !scores?.scores) return;

    // Build positions array from summary (positions come from the same API)
    // The summary endpoint may not return individual positions, so we use scores as canonical
    const merged = scores.scores.map((s, i) => ({
      symbol: s.symbol,
      ticker: s.ticker,
      quantity: 1,
      avgCost: 0,
      currentPrice: 0,
      value: 0,
      pnl: 0,
      pnlPct: 0,
    }));

    classifyPost({
      positions: merged,
      scores: scores.scores,
      cash: data.summary?.cash ?? 0,
    }).then(r => {
      if (r.ok) {
        setClassifications(r.classifications);
        setScenarios(r.scenarios);
      }
    }).catch(() => {});
  }, [data, scores]);

  // ── Chat: initial analysis ────────────────────────────
  const runInitialAnalysis = useCallback(async () => {
    if (!data || !scores) return;
    setChatLoading(true);
    try {
      const r = await analyzePost({
        positions: [],
        scores: scores.scores,
        cash: data.summary?.cash ?? 0,
      });
      if (r.ok && r.analysis) {
        setChatMessages([
          { role: 'assistant', content: r.analysis, usage: r.usage },
        ]);
        setClassifications(r.classifications);
        setScenarios(r.scenarios);
      }
    } catch (e) {
      setChatMessages([{ role: 'assistant', content: 'Failed to connect to AI. Is the server running?', error: true }]);
    }
    setChatLoading(false);
  }, [data, scores]);

  // ── Chat: send message ────────────────────────────────
  const sendMessage = async () => {
    const msg = chatInput.trim();
    if (!msg) return;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: msg }]);
    setChatLoading(true);
    try {
      const r = await analyzePost({
        positions: [],
        scores: scores?.scores ?? [],
        cash: data?.summary?.cash ?? 0,
        question: msg,
      });
      if (r.ok && r.analysis) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: r.analysis, usage: r.usage }]);
      } else {
        setChatMessages(prev => [...prev, { role: 'assistant', content: r.error || 'No response', error: true }]);
      }
    } catch (e) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + e.message, error: true }]);
    }
    setChatLoading(false);
  };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // ── Render ────────────────────────────────────────────
  if (loading) return <div className="plab-loading">Loading portfolio data…</div>;
  if (error) return <div className="plab-error">Error: {error}</div>;

  const summary = data?.summary;
  const posList = classifications || [];

  return (
    <div className="plab-page">
      <h1 className="plab-title">🧪 Portfolio Lab</h1>

      {/* Summary bar */}
      <div className="plab-bar">
        <span className="plab-stat">${summary?.totalValue?.toFixed(2) ?? '?'} total</span>
        <span className="plab-stat">${summary?.cash?.toFixed(2) ?? '?'} cash</span>
        <span className={`plab-stat ${(summary?.pnlPct ?? 0) >= 0 ? 'positive' : 'negative'}`}>
          ${summary?.totalPnl?.toFixed(2) ?? '?'} ({summary?.pnlPct?.toFixed(1) ?? '?'}%)
        </span>
        <span className="plab-stat">{summary?.positionCount ?? 0} positions</span>
        {!chatMessages.length && (
          <button className="plab-analyze-btn" onClick={runInitialAnalysis}>
            🤖 Analyze with DeepSeek
          </button>
        )}
      </div>

      <div className="plab-layout">
        {/* ── Left: Position list ── */}
        <div className="plab-positions">
          <h3>Positions</h3>
          {posList.length === 0 && <p className="plab-empty">Click "Analyze with DeepSeek" to begin</p>}
          {posList.map(p => (
            <div key={p.symbol} className="plab-pos-card">
              <div className="plab-pos-header">
                <span className="plab-pos-symbol">{p.symbol}</span>
                <span className="plab-pos-score" style={{ color: SIGNAL_COLORS[p.signal] || '#999' }}>
                  {p.score > 0 ? p.score : '—'}
                </span>
              </div>
              <div className="plab-pos-meta">
                <span className="plab-pos-signal" style={{ color: SIGNAL_COLORS[p.signal] || '#999' }}>
                  {p.signal.replace('_', ' ')}
                </span>
                <span className={`plab-pos-pnl ${p.pnlPct >= 0 ? 'positive' : 'negative'}`}>
                  {p.pnlPct > 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%
                </span>
              </div>
              <div className="plab-pos-rec" style={{ color: REC_COLORS[p.recommendation] || '#999' }}>
                → {p.recommendation.replace('_', ' ')}
              </div>
              {p.reasoning && <div className="plab-pos-reason">{p.reasoning}</div>}
            </div>
          ))}
        </div>

        {/* ── Center: Chat ── */}
        <div className="plab-chat">
          <h3>💬 DeepSeek Analysis</h3>
          <div className="plab-chat-log">
            {chatMessages.length === 0 && !chatLoading && (
              <div className="plab-chat-empty">
                <p>Click <strong>Analyze with DeepSeek</strong> to get AI-powered portfolio restructuring advice.</p>
                <p className="plab-chat-hint">The AI will classify your positions, suggest specific trades, and answer follow-up questions.</p>
              </div>
            )}
            {chatMessages.map((m, i) => (
              <div key={i} className={`plab-msg ${m.role} ${m.error ? 'error' : ''}`}>
                <div className="plab-msg-content">{m.content}</div>
                {m.usage && (
                  <div className="plab-msg-meta">{m.usage.totalTokens} tokens</div>
                )}
              </div>
            ))}
            {chatLoading && <div className="plab-msg assistant loading">Analyzing…</div>}
            <div ref={chatEndRef} />
          </div>
          <div className="plab-chat-input">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="Ask about your portfolio…"
              disabled={chatLoading}
            />
            <button onClick={sendMessage} disabled={chatLoading || !chatInput.trim()}>Send</button>
          </div>
        </div>

        {/* ── Right: Scenarios ── */}
        <div className="plab-scenarios">
          <h3>Scenarios</h3>
          {scenarios?.map(s => (
            <div key={s.id} className={`plab-scenario-card risk-${s.riskLevel}`}>
              <div className="plab-scenario-name">{s.name}</div>
              <div className="plab-scenario-risk">{s.riskLevel} risk</div>
              <div className="plab-scenario-desc">{s.description}</div>
              <div className="plab-scenario-return">
                Projected: {s.projectedReturn.min}% – {s.projectedReturn.expected}% – {s.projectedReturn.max}%
              </div>
              <div className="plab-scenario-time">{s.projectedTimeframe}</div>
              {s.actions?.length > 0 && (
                <div className="plab-scenario-actions">
                  {s.actions.map((a, i) => (
                    <div key={i} className={`plab-action action-${a.type}`}>
                      <span className="plab-action-type">{a.type}</span>
                      <span className="plab-action-symbol">{a.symbol}</span>
                      {a.dollarAmount > 0 && <span className="plab-action-amt">${a.dollarAmount.toFixed(2)}</span>}
                      <span className="plab-action-reason">{a.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!scenarios && <p className="plab-empty">Scenarios appear after analysis</p>}
        </div>
      </div>
    </div>
  );
}
