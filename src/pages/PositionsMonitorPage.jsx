import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './positions-monitor.css';

function RiskBar({ pct, label }) {
  const color = pct > 20 ? '#ef4444' : pct > 10 ? '#f59e0b' : '#22c55e';
  return (
    <div className="pm-risk-bar">
      <div className="pm-risk-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      <span className="pm-risk-label">{label}: {pct.toFixed(1)}%</span>
    </div>
  );
}

function CFDPosition({ pos }) {
  return (
    <div className="pm-pos-card">
      <div className="pm-pos-header">
        <strong>{pos.symbol}</strong>
        <span className={`pm-pos-pnl ${pos.pnl >= 0 ? 'pm-profit' : 'pm-loss'}`}>
          {pos.pnl >= 0 ? '+' : ''}{pos.pnl?.toFixed(2)}
        </span>
      </div>
      <div className="pm-pos-details">
        <div><span>Direction</span><span className={pos.direction === 'BUY' ? 'pm-buy' : 'pm-sell'}>{pos.direction}</span></div>
        <div><span>Volume</span><span>{pos.volume}</span></div>
        <div><span>Leverage</span><span>{pos.leverage || '1:30'}x</span></div>
        <div><span>Margin</span><span>${pos.margin?.toFixed(2) || '—'}</span></div>
        <div><span>Days Held</span><span>{pos.daysHeld || 1}d</span></div>
        <div><span>Stop Loss</span><span>${pos.sl?.toFixed(2) || '—'}</span></div>
        <div><span>Take Profit</span><span>${pos.tp?.toFixed(2) || '—'}</span></div>
      </div>
      {pos.overnightFee > 0 && (
        <div className="pm-warning">⚠ Overnight fee accruing: ${pos.overnightFee.toFixed(2)}/day</div>
      )}
      {pos.daysHeld > 7 && (
        <div className="pm-warning">⚠ CFD held {pos.daysHeld} days — consider closing</div>
      )}
      <RiskBar pct={pos.riskPct || 5} label="Risk Exposure" />
    </div>
  );
}

function OptionPosition({ pos }) {
  const daysToExpiry = pos.daysToExpiry || 30;
  const urgencyColor = daysToExpiry < 3 ? '#ef4444' : daysToExpiry < 7 ? '#f59e0b' : '#64748b';
  return (
    <div className="pm-pos-card pm-option">
      <div className="pm-pos-header">
        <strong>{pos.symbol} {pos.strike} {pos.type?.toUpperCase()}</strong>
        <span className={`pm-pos-pnl ${pos.pnl >= 0 ? 'pm-profit' : 'pm-loss'}`}>
          {pos.pnl >= 0 ? '+' : ''}{pos.pnl?.toFixed(2)}
        </span>
      </div>
      <div className="pm-pos-details">
        <div><span>Expiry</span><span style={{ color: urgencyColor }}>{pos.expiry} ({daysToExpiry}d)</span></div>
        <div><span>Strike</span><span>${pos.strike}</span></div>
        <div><span>Current</span><span>${pos.currentPrice?.toFixed(2) || '—'}</span></div>
        <div><span>Intrinsic Value</span><span>${pos.intrinsicValue?.toFixed(2) || '—'}</span></div>
        <div><span>Time Value</span><span>${pos.timeValue?.toFixed(2) || '—'}</span></div>
        <div><span>Delta</span><span>{pos.delta?.toFixed(2) || '—'}</span></div>
        <div><span>Theta</span><span>{pos.theta?.toFixed(2) || '—'}</span></div>
        <div><span>Multiplier</span><span>×{pos.multiplier || 100}</span></div>
      </div>
      {daysToExpiry < 3 && <div className="pm-warning">⚠ Expiring in {daysToExpiry} days!</div>}
      <RiskBar pct={pos.riskPct || 3} label="Risk Exposure" />
    </div>
  );
}

export default function PositionsMonitorPage() {
  const [tab, setTab] = useState('cfd');
  const [source, setSource] = useState('mt5');

  // Real MT5 positions
  const mt5Query = useQuery({
    queryKey: ['mt5-positions'],
    queryFn: () => fetch('/api/providers/mt5/positions').then((r) => r.json()).catch(() => ({ positions: [] })),
    staleTime: 10000,
    refetchInterval: 30000,
  });

  const mt5Positions = mt5Query.data?.positions || [];
  const cfdPositions = source === 'mt5' ? mt5Positions.map((p) => ({
    symbol: p.symbol,
    direction: p.type === 'buy' ? 'BUY' : 'SELL',
    volume: String(p.volume),
    leverage: '—',
    margin: '—',
    pnl: p.profit || 0,
    daysHeld: p.openTime ? Math.floor((Date.now() - new Date(p.openTime).getTime()) / 86400000) : 0,
    sl: p.sl,
    tp: p.tp,
    overnightFee: p.swap || 0,
    riskPct: '—',
    ticket: p.ticket,
  })) : [];

  return (
    <div className="pm-page">
      <header className="pm-header">
        <h1>Positions Monitor</h1>
        <p>Trading212 CFD API not available (404). Using MT5 positions.</p>
      </header>

      <div className="pm-tabs">
        <button className={`pm-tab ${tab === 'cfd' ? 'pm-active' : ''}`} onClick={() => setTab('cfd')}>CFD Monitor</button>
        <button className={`pm-tab ${tab === 'options' ? 'pm-active' : ''}`} onClick={() => setTab('options')}>Options Monitor</button>
      </div>

      {tab === 'cfd' && (
        <div className="pm-positions">
          {mt5Query.isLoading && <div className="pm-empty">Loading MT5 positions...</div>}
          {cfdPositions.length === 0 && !mt5Query.isLoading && <div className="pm-empty">No open positions from MT5</div>}
          {cfdPositions.map((p, i) => <CFDPosition key={p.ticket || i} pos={p} />)}
        </div>
      )}

      {tab === 'options' && (
        <div className="pm-positions">
          <div className="pm-empty">Options monitoring not yet available. Requires broker API access.</div>
        </div>
      )}
    </div>
  );
}
