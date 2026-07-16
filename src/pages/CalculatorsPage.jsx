import { useState, useEffect, useCallback } from 'react';
import './calculators.css';

const HISTORY_KEY = 'tcs:calc-history';
const MAX_HISTORY = 50;
const VISIBILITY_KEY = 'tcs:calc-visibility';

const CALCULATOR_IDS = [
  { id: 'averaging-down', label: 'Averaging Down' },
  { id: 'position-size', label: 'Position Size' },
  { id: 'profit-loss', label: 'Profit / Loss' },
  { id: 'risk-reward', label: 'Risk / Reward' },
];

function loadVisibility() {
  try {
    const saved = JSON.parse(localStorage.getItem(VISIBILITY_KEY));
    if (saved && typeof saved === 'object') return saved;
  } catch { /* use defaults */ }
  const defaults = {};
  CALCULATOR_IDS.forEach(c => { defaults[c.id] = true; });
  return defaults;
}
function saveVisibility(vis) {
  try { localStorage.setItem(VISIBILITY_KEY, JSON.stringify(vis)); } catch { /* noop */ }
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveHistory(entries) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY))); } catch { /* noop */ }
}

function useCalculationHistory() {
  const [history, setHistory] = useState(loadHistory);
  const addEntry = useCallback((type, inputs, result, note) => {
    setHistory((prev) => {
      const next = [{ type, inputs, result, note: note || '', timestamp: Date.now() }, ...prev];
      saveHistory(next);
      return next;
    });
  }, []);
  const clearHistory = useCallback(() => { setHistory([]); saveHistory([]); }, []);
  return { history, addEntry, clearHistory };
}

function CalculatorCard({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="calc-card">
      <button type="button" className="calc-card-header" onClick={() => setOpen(!open)}>
        <h3>{title}</h3>
        <span className="calc-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="calc-card-body">{children}</div>}
    </div>
  );
}

function InputGroup({ label, value, onChange, type = 'number', placeholder, step }) {
  return (
    <div className="calc-input-group">
      <label>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(type === 'number' ? Number(e.target.value) || 0 : e.target.value)}
        placeholder={placeholder}
        step={step}
      />
    </div>
  );
}

function NoteField({ value, onChange }) {
  return (
    <div className="calc-input-group calc-note-field">
      <label>📝 Note (optional)</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Why are you running this calculation?"
      />
    </div>
  );
}

function ResultRow({ label, value, highlight }) {
  return (
    <div className={`calc-result-row${highlight ? ' calc-highlight' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

// ── 1. Averaging Down Calculator ──

function AveragingDownCalc({ onCalculate }) {
  const [shares, setShares] = useState(100);
  const [avgPrice, setAvgPrice] = useState(50);
  const [marketPrice, setMarketPrice] = useState(40);
  const [targetAvg, setTargetAvg] = useState(45);
  const [note, setNote] = useState('');

  const currentValue = shares * marketPrice;
  const currentCost = shares * avgPrice;
  const targetCost = targetAvg * shares;
  const sharesNeeded = marketPrice < targetAvg && marketPrice > 0
    ? Math.ceil((currentCost - targetCost) / (targetAvg - marketPrice))
    : 0;
  const additionalCost = sharesNeeded * marketPrice;
  const newAvg = shares + sharesNeeded > 0
    ? (currentCost + additionalCost) / (shares + sharesNeeded)
    : avgPrice;
  const newTotal = currentValue + additionalCost;

  const handleCalc = () => {
    onCalculate('Averaging Down', { shares, avgPrice, marketPrice, targetAvg }, { sharesToBuy: sharesNeeded, additionalCost, newAvg, newTotal }, note);
  };

  return (
    <div className="calc-grid">
      <div className="calc-inputs">
        <InputGroup label="Current Shares" value={shares} onChange={setShares} />
        <InputGroup label="Avg Price ($)" value={avgPrice} onChange={setAvgPrice} step="0.01" />
        <InputGroup label="Market Price ($)" value={marketPrice} onChange={setMarketPrice} step="0.01" />
        <InputGroup label="Target Avg ($)" value={targetAvg} onChange={setTargetAvg} step="0.01" />
        <NoteField value={note} onChange={setNote} />
        <button type="button" className="calc-save-btn" onClick={handleCalc}>💾 Save to History</button>
      </div>
      <div className="calc-results">
        <ResultRow label="Shares to Buy" value={sharesNeeded} highlight />
        <ResultRow label="Additional Cost" value={`$${additionalCost.toFixed(2)}`} />
        <ResultRow label="New Avg Price" value={`$${newAvg.toFixed(2)}`} highlight />
        <ResultRow label="New Total Value" value={`$${newTotal.toFixed(2)}`} />
        {sharesNeeded > 0 && (
          <div className="calc-visual">
            <div className="calc-avg-bar">
              <div className="calc-avg-current" style={{ left: `${((avgPrice - 0) / 100) * 100}%` }} title={`Current avg: $${avgPrice}`}>▼</div>
              <div className="calc-avg-target" style={{ left: `${((newAvg - 0) / 100) * 100}%` }} title={`New avg: $${newAvg.toFixed(2)}`}>▲</div>
            </div>
            <div className="calc-avg-labels">
              <span>$0</span><span>$50</span><span>$100</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 2. Position Size Calculator ──

function PositionSizeCalc({ onCalculate }) {
  const [account, setAccount] = useState(10000);
  const [riskPct, setRiskPct] = useState(2);
  const [entry, setEntry] = useState(100);
  const [stopLoss, setStopLoss] = useState(95);
  const [note, setNote] = useState('');

  const riskAmount = account * (riskPct / 100);
  const riskPerShare = Math.abs(entry - stopLoss);
  const maxShares = riskPerShare > 0 ? Math.floor(riskAmount / riskPerShare) : 0;
  const totalValue = maxShares * entry;
  const reward2r = entry + (entry - stopLoss) * 2;

  const handleCalc = () => {
    onCalculate('Position Size', { account, riskPct, entry, stopLoss }, { riskAmount, maxShares, totalValue, reward2r }, note);
  };

  return (
    <div className="calc-grid">
      <div className="calc-inputs">
        <InputGroup label="Account Size ($)" value={account} onChange={setAccount} />
        <InputGroup label="Risk %" value={riskPct} onChange={setRiskPct} step="0.1" />
        <InputGroup label="Entry Price ($)" value={entry} onChange={setEntry} step="0.01" />
        <InputGroup label="Stop Loss ($)" value={stopLoss} onChange={setStopLoss} step="0.01" />
        <NoteField value={note} onChange={setNote} />
        <button type="button" className="calc-save-btn" onClick={handleCalc}>💾 Save to History</button>
      </div>
      <div className="calc-results">
        <ResultRow label="Risk Amount" value={`$${riskAmount.toFixed(2)}`} />
        <ResultRow label="Max Shares" value={maxShares} highlight />
        <ResultRow label="Total Position" value={`$${totalValue.toFixed(2)}`} />
        <ResultRow label="2R Target" value={`$${reward2r.toFixed(2)}`} />
      </div>
    </div>
  );
}

// ── 3. P&L Calculator ──

function ProfitLossCalc({ onCalculate }) {
  const [entry, setEntry] = useState(100);
  const [exit, setExit] = useState(110);
  const [shares, setShares] = useState(100);
  const [direction, setDirection] = useState('long');
  const [note, setNote] = useState('');

  const pnlPerShare = direction === 'long' ? exit - entry : entry - exit;
  const totalPnl = pnlPerShare * shares;
  const pnlPct = entry > 0 ? (pnlPerShare / entry) * 100 : 0;
  const feeEstimate = Math.abs(totalPnl) * 0.001; // 0.1% fee estimate

  const handleCalc = () => {
    onCalculate('Profit/Loss', { entry, exit, shares, direction }, { pnlPerShare, totalPnl, pnlPct, feeEstimate, netPnl: totalPnl - feeEstimate }, note);
  };

  return (
    <div className="calc-grid">
      <div className="calc-inputs">
        <InputGroup label="Entry ($)" value={entry} onChange={setEntry} step="0.01" />
        <InputGroup label="Exit ($)" value={exit} onChange={setExit} step="0.01" />
        <InputGroup label="Shares" value={shares} onChange={setShares} />
        <div className="calc-input-group">
          <label>Direction</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </div>
        <NoteField value={note} onChange={setNote} />
        <button type="button" className="calc-save-btn" onClick={handleCalc}>💾 Save to History</button>
      </div>
      <div className="calc-results">
        <ResultRow label="P&L per Share" value={`$${pnlPerShare.toFixed(2)}`} />
        <ResultRow label="Total P&L" value={`$${totalPnl.toFixed(2)}`} highlight />
        <ResultRow label="P&L %" value={`${pnlPct.toFixed(2)}%`} />
        <ResultRow label="Est. Fees" value={`$${feeEstimate.toFixed(2)}`} />
        <ResultRow label="Net P&L" value={`$${(totalPnl - feeEstimate).toFixed(2)}`} highlight />
      </div>
    </div>
  );
}

// ── 4. Risk/Reward Calculator ──

function RiskRewardCalc({ onCalculate }) {
  const [entry, setEntry] = useState(100);
  const [stopLoss, setStopLoss] = useState(95);
  const [takeProfit, setTakeProfit] = useState(115);
  const [note, setNote] = useState('');

  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  const rrRatio = risk > 0 ? reward / risk : 0;
  const breakevenWR = rrRatio > 0 ? (1 / (1 + rrRatio)) * 100 : 0;

  const handleCalc = () => {
    onCalculate('Risk/Reward', { entry, stopLoss, takeProfit }, { risk, reward, rrRatio, breakevenWR }, note);
  };

  return (
    <div className="calc-grid">
      <div className="calc-inputs">
        <InputGroup label="Entry ($)" value={entry} onChange={setEntry} step="0.01" />
        <InputGroup label="Stop Loss ($)" value={stopLoss} onChange={setStopLoss} step="0.01" />
        <InputGroup label="Take Profit ($)" value={takeProfit} onChange={setTakeProfit} step="0.01" />
        <NoteField value={note} onChange={setNote} />
        <button type="button" className="calc-save-btn" onClick={handleCalc}>💾 Save to History</button>
      </div>
      <div className="calc-results">
        <ResultRow label="Risk" value={`$${risk.toFixed(2)} (${entry > 0 ? ((risk / entry) * 100).toFixed(1) : 0}%)`} />
        <ResultRow label="Reward" value={`$${reward.toFixed(2)} (${entry > 0 ? ((reward / entry) * 100).toFixed(1) : 0}%)`} />
        <ResultRow label="R:R Ratio" value={`1:${rrRatio.toFixed(1)}`} highlight />
        <ResultRow label="Breakeven Win Rate" value={`${breakevenWR.toFixed(1)}%`} highlight />
      </div>
    </div>
  );
}

// ── Page ──

export default function CalculatorsPage() {
  const { history, addEntry, clearHistory } = useCalculationHistory();
  const [vis, setVis] = useState(loadVisibility);
  const [showOptions, setShowOptions] = useState(false);

  const toggleCalc = (id) => {
    setVis((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveVisibility(next);
      return next;
    });
  };

  const visibleCount = Object.values(vis).filter(Boolean).length;

  return (
    <div className="calc-page">
      <header className="calc-header">
        <h1>Trading Calculators</h1>
        <p>Manual trading tools — position sizing, averaging down, P&L, and risk/reward.</p>
      </header>
      {vis['averaging-down'] && (
        <CalculatorCard title="Averaging Down Calculator">
          <AveragingDownCalc onCalculate={addEntry} />
        </CalculatorCard>
      )}
      {vis['position-size'] && (
        <CalculatorCard title="Position Size Calculator">
          <PositionSizeCalc onCalculate={addEntry} />
        </CalculatorCard>
      )}
      {vis['profit-loss'] && (
        <CalculatorCard title="Profit / Loss Calculator">
          <ProfitLossCalc onCalculate={addEntry} />
        </CalculatorCard>
      )}
      {vis['risk-reward'] && (
        <CalculatorCard title="Risk / Reward Calculator" defaultOpen={false}>
          <RiskRewardCalc onCalculate={addEntry} />
        </CalculatorCard>
      )}

      {/* ── Calculation History ── */}
      {history.length > 0 && (
        <section className="calc-history">
          <div className="calc-history-header">
            <h2>📋 Recent Calculations</h2>
            <button type="button" className="calc-clear-btn" onClick={clearHistory}>Clear All</button>
          </div>
          <div className="calc-history-list">
            {history.map((entry, i) => (
              <div key={i} className="calc-history-item">
                <div className="calc-history-meta">
                  <span className="calc-history-type">{entry.type}</span>
                  <span className="calc-history-time">{new Date(entry.timestamp).toLocaleString()}</span>
                </div>
                {entry.note && <p className="calc-history-note">📝 {entry.note}</p>}
                <div className="calc-history-results">
                  {Object.entries(entry.result).map(([k, v]) => (
                    <span key={k} className="calc-history-val">
                      <small>{k.replace(/([A-Z])/g, ' $1').trim()}</small>
                      <strong>{typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v}</strong>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Screen Options Disc ── */}
      <div className="calc-options-bar">
        <button
          type="button"
          className={`calc-options-btn ${showOptions ? 'calc-options-active' : ''}`}
          onClick={() => setShowOptions(!showOptions)}
          title="Screen Options"
          aria-label="Open screen options"
        >
          ⚙
        </button>
        {showOptions && (
          <div className="calc-options-dropdown">
            <h4>Show Calculators</h4>
            {CALCULATOR_IDS.map(({ id, label }) => (
              <label key={id} className="calc-options-toggle">
                <input
                  type="checkbox"
                  checked={vis[id] === true}
                  onChange={() => toggleCalc(id)}
                />
                <span>{label}</span>
              </label>
            ))}
            <p className="calc-options-count">{visibleCount} of {CALCULATOR_IDS.length} visible</p>
          </div>
        )}
      </div>
    </div>
  );
}
