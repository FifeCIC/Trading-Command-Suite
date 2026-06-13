import { useState, useEffect, useRef } from 'react';

const STAGES = [
  { id: 'fetch', label: 'Fetch Data', icon: '📡' },
  { id: 'score', label: 'Score Directives', icon: '📊' },
  { id: 'rank', label: 'Rank Symbols', icon: '🏆' },
  { id: 'filter', label: 'Filter Noise', icon: '🔍' },
  { id: 'signal', label: 'Signal Out', icon: '📢' },
];

const STRATEGIES = ['Forex Mean Reversion', 'Tech Breakout', 'Conviction Dip Accumulation', 'Crypto Scalp'];

function randomStage() {
  return ['done', 'active', 'queued', 'waiting'][Math.floor(Math.random() * 4)];
}

function randomLogEntry() {
  const symbols = ['EURUSD', 'GBPUSD', 'NVDA', 'AAPL', 'TSLA', 'BTC-USD', 'ETH-USD', 'SPY'];
  const sym = symbols[Math.floor(Math.random() * symbols.length)];
  const score = Math.floor(Math.random() * 70) + 30;
  const signal = score >= 70 ? 'BUY' : score <= 45 ? 'SELL' : 'HOLD';
  const actions = ['scored', 'FETCH complete', 'directive run', 'ranked', 'filtered'];
  const action = actions[Math.floor(Math.random() * actions.length)];
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  return `${time}  ${sym} ${action}: score ${score} → ${signal}`;
}

export default function AlgorithmLabPage() {
  const [strategyIdx, setStrategyIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [stages, setStages] = useState(STAGES.map((s) => ({ ...s, status: 'waiting' })));
  const [logs, setLogs] = useState(Array.from({ length: 8 }, randomLogEntry));
  const [procSymbol, setProcSymbol] = useState('EURUSD');
  const [procDir, setProcDir] = useState('rsi-oversold');
  const [procScore, setProcScore] = useState(67);
  const [procDone, setProcDone] = useState(6);
  const logRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Simulate pipeline progression
  useEffect(() => {
    if (paused) return;
    const interval = setInterval(() => {
      setStages((prev) => {
        const cur = prev.findIndex((s) => s.status === 'active' || s.status === 'queued');
        const next = prev.map((s, i) => {
          if (i < cur) return { ...s, status: 'done' };
          if (i === cur) return { ...s, status: 'active' };
          if (i === cur + 1) return { ...s, status: 'queued' };
          return { ...s, status: 'waiting' };
        });
        // Cycle back
        if (cur >= prev.length - 1) {
          return prev.map((s) => ({ ...s, status: 'waiting' }));
        }
        return next.length ? next : prev.map((s) => ({ ...s, status: prev[0].status === 'done' ? 'waiting' : s.status }));
      });

      setProcScore((s) => Math.min(100, Math.max(20, s + (Math.random() - 0.5) * 15)));
      setProcDone((d) => (d + 1) % 19);
      setLogs((l) => [randomLogEntry(), ...l].slice(0, 50));
    }, 2000);
    return () => clearInterval(interval);
  }, [paused]);

  // Re-run when strategy changes
  useEffect(() => {
    setStages(STAGES.map((s) => ({ ...s, status: 'waiting' })));
    setLogs(Array.from({ length: 6 }, randomLogEntry));
    setProcSymbol(['EURUSD','NVDA','AAPL','BTC-USD'][strategyIdx]);
    setProcDir(['rsi-oversold','macd-crossover','ema-structure','atr-dip'][strategyIdx]);
    setProcDone(0);
  }, [strategyIdx]);

  // Auto-scroll log
  useEffect(() => {
    if (autoScroll && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs, autoScroll]);

  const statusIcon = { done: '✅', active: '⚡', queued: '⏳', waiting: '⬜' };
  const currentStage = stages.find((s) => s.status === 'active');

  return (
    <div className="al-page">
      <div className="al-header">
        <h1>Algorithm Lab</h1>
        <button type="button" className={paused ? 'al-resume' : 'al-pause'} onClick={() => setPaused(!paused)}>
          {paused ? '▶ RESUME' : '⏸ PAUSE'}
        </button>
      </div>

      {/* Strategy scroller */}
      <div className="al-strat-nav">
        <button type="button" onClick={() => setStrategyIdx((i) => (i - 1 + STRATEGIES.length) % STRATEGIES.length)}>◄</button>
        <strong>{STRATEGIES[strategyIdx]}</strong>
        <button type="button" onClick={() => setStrategyIdx((i) => (i + 1) % STRATEGIES.length)}>►</button>
      </div>

      {/* Pipeline visualization */}
      <div className="al-pipeline">
        <div className="al-pipe-nodes">
          {stages.map((s, i) => (
            <div key={s.id} className={`al-node al-node-${s.status}`}>
              <div className="al-node-icon">{statusIcon[s.status]}</div>
              <div className="al-node-label">{s.label}</div>
              {i < stages.length - 1 && <div className="al-node-arrow">→</div>}
            </div>
          ))}
        </div>
        {currentStage && (
          <div className="al-current">
            <span>Current: <strong>{currentStage.label}</strong></span>
            <span>Processing: <strong>{procSymbol}</strong> — {procDir} (score: {Math.round(procScore)})</span>
            <span>{procDone} of 18 directives complete</span>
          </div>
        )}
      </div>

      {/* Decision log */}
      <div className="al-log-header">
        <h2>Decision Log</h2>
        <label className="al-autoscroll">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} /> Auto-scroll
        </label>
      </div>
      <div
        className="al-log"
        ref={logRef}
        onScroll={() => {
          if (logRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = logRef.current;
            setAutoScroll(scrollHeight - scrollTop - clientHeight < 20);
          }
        }}
      >
        {logs.map((entry, i) => {
          const isBuy = entry.includes('BUY');
          const isSell = entry.includes('SELL');
          return (
            <div key={i} className={`al-log-entry ${isBuy ? 'al-buy' : isSell ? 'al-sell' : ''}`}>
              {entry}
            </div>
          );
        })}
      </div>
    </div>
  );
}
