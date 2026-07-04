import { useState, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './positions-monitor.css';

function RiskBar({ pct, label }) {
  const color = pct > 20 ? '#ef4444' : pct > 10 ? '#f59e0b' : '#22c55e';
  const displayPct = Math.min(Math.max(pct || 0, 0), 100);
  return (
    <div className="pm-risk-bar">
      <motion.div className="pm-risk-fill" initial={{ width: 0 }} animate={{ width: `${displayPct}%` }} transition={{ duration: 0.5, ease: 'easeOut' }} style={{ background: color }} />
      <span className="pm-risk-label">{label}: {displayPct.toFixed(1)}%</span>
      {/* 20% threshold marker */}
      <div className="pm-risk-threshold" style={{ left: '20%' }} title="Risk threshold: 20%" />
    </div>
  );
}

function CFDPosition({ pos, index, onClose, isClosing }) {
  const riskPct = pos.riskPct || (
    pos.currentPrice && pos.avgCost
      ? Math.abs(((pos.currentPrice - pos.avgCost) / pos.avgCost) * 100)
      : pos.allocation ? pos.allocation
      : 0
  );

  const isProfit = pos.pnl >= 0;

  return (
    <motion.div
      className={`pm-pos-card ${isProfit ? 'pm-win' : 'pm-lose'}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.4) }}
    >
      <div className="pm-pos-header">
        <div className="pm-pos-title">
          <strong>{pos.symbol}</strong>
          <span className="pm-pos-source">{pos.source}</span>
        </div>
        <div className="pm-pos-pnl-group">
          <span className={`pm-pos-pnl ${isProfit ? 'pm-profit' : 'pm-loss'}`}>
            {isProfit ? '+' : ''}{pos.pnl?.toFixed(2)}
          </span>
          {pos.pnlPct != null && (
            <span className={`pm-pos-pnl-pct ${isProfit ? 'pm-profit' : 'pm-loss'}`}>
              ({isProfit ? '+' : ''}{pos.pnlPct.toFixed(1)}%)
            </span>
          )}
        </div>
      </div>

      {/* Entry → Current price line */}
      {pos.avgCost != null && pos.currentPrice != null && (
        <div className="pm-price-line">
          <span className="pm-price-entry">Entry ${Number(pos.avgCost).toFixed(2)}</span>
          <span className="pm-price-arrow">→</span>
          <span className={`pm-price-current ${isProfit ? 'pm-profit' : 'pm-loss'}`}>${Number(pos.currentPrice).toFixed(2)}</span>
        </div>
      )}

      <div className="pm-pos-details">
        <div><span>Direction</span><span className={pos.direction === 'BUY' ? 'pm-buy' : 'pm-sell'}>{pos.direction}</span></div>
        <div><span>Volume</span><span>{pos.volume}</span></div>
        <div><span>Leverage</span><span>{pos.leverage || '—'}</span></div>
        <div><span>Margin</span><span>${Number(pos.margin)?.toFixed(2) || '—'}</span></div>
        <div><span>Days Held</span><span>{pos.daysHeld}d</span></div>
        {pos.allocation != null && (
          <div><span>Allocation</span><span>{pos.allocation.toFixed(1)}%</span></div>
        )}
        <div><span>Stop Loss</span><span>{pos.sl != null ? `$${Number(pos.sl).toFixed(2)}` : '—'}</span></div>
        <div><span>Take Profit</span><span>{pos.tp != null ? `$${Number(pos.tp).toFixed(2)}` : '—'}</span></div>
      </div>
      {pos.overnightFee > 0 && (
        <div className="pm-warning">⚠ Overnight fee accruing: ${pos.overnightFee.toFixed(2)}/day</div>
      )}
      {pos.daysHeld > 7 && (
        <div className="pm-warning">⚠ CFD held {pos.daysHeld} days — consider closing</div>
      )}
      <RiskBar pct={riskPct} label="Risk Exposure" />

      {/* Action row */}
      <div className="pm-actions">
        {pos.source === 'MT5' && (
          <button
            className="pm-close-btn"
            onClick={() => onClose(pos.ticket, pos.symbol)}
            disabled={isClosing}
          >
            {isClosing ? '⌛ Closing...' : '✕ Close Position'}
          </button>
        )}
        <a className="pm-nav-link" href={`/research/investigation?symbol=${pos.symbol}`} target="_blank" rel="noopener">🔍 Research</a>
        <a className="pm-nav-link" href={`/analysis/analyse-symbol?symbol=${pos.symbol}`} target="_blank" rel="noopener">📊 Analyse</a>
      </div>
    </motion.div>
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

function SummaryBanner({ positions }) {
  const totalPnl = positions.reduce((s, p) => s + (p.pnl || 0), 0);
  const winners = positions.filter(p => p.pnl > 0).length;
  const losers = positions.filter(p => p.pnl < 0).length;
  const best = positions.reduce((a, b) => (b.pnl || 0) > (a.pnl || 0) ? b : a, positions[0]);
  const worst = positions.reduce((a, b) => (b.pnl || 0) < (a.pnl || 0) ? b : a, positions[0]);

  if (positions.length === 0) return null;

  return (
    <motion.div
      className="pm-summary"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="pm-summary-stat">
        <span className="pm-summary-label">Total P&amp;L</span>
        <span className={`pm-summary-value ${totalPnl >= 0 ? 'pm-profit' : 'pm-loss'}`}>
          {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
        </span>
      </div>
      <div className="pm-summary-stat">
        <span className="pm-summary-label">Positions</span>
        <span className="pm-summary-value">{positions.length}</span>
      </div>
      <div className="pm-summary-stat">
        <span className="pm-summary-label">Winners</span>
        <span className="pm-summary-value pm-profit">{winners}</span>
      </div>
      <div className="pm-summary-stat">
        <span className="pm-summary-label">Losers</span>
        <span className="pm-summary-value pm-loss">{losers}</span>
      </div>
      {best && (
        <div className="pm-summary-stat">
          <span className="pm-summary-label">Best</span>
          <span className="pm-summary-value pm-profit">{best.symbol} +{best.pnl?.toFixed(2)}</span>
        </div>
      )}
      {worst && (
        <div className="pm-summary-stat">
          <span className="pm-summary-label">Worst</span>
          <span className="pm-summary-value pm-loss">{worst.symbol} {worst.pnl?.toFixed(2)}</span>
        </div>
      )}
    </motion.div>
  );
}

const SORT_OPTIONS = [
  { key: 'pnl-desc', label: 'P&L ↓', fn: (a, b) => (b.pnl || 0) - (a.pnl || 0) },
  { key: 'pnl-asc', label: 'P&L ↑', fn: (a, b) => (a.pnl || 0) - (b.pnl || 0) },
  { key: 'risk-desc', label: 'Risk ↓', fn: (a, b) => (b.riskPct || 0) - (a.riskPct || 0) },
  { key: 'days-desc', label: 'Age ↓', fn: (a, b) => (b.daysHeld || 0) - (a.daysHeld || 0) },
  { key: 'symbol-asc', label: 'A–Z', fn: (a, b) => (a.symbol || '').localeCompare(b.symbol || '') },
];

export default function PositionsMonitorPage() {
  const [tab, setTab] = useState('cfd');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortKey, setSortKey] = useState('pnl-desc');
  const [closingTicket, setClosingTicket] = useState(null);
  const qc = useQueryClient();

  // MT5 positions
  const mt5Query = useQuery({
    queryKey: ['mt5-positions'],
    queryFn: () => apiGet('/api/trading/mt5/positions').catch(() => ({ positions: [] })),
    staleTime: 10000,
    refetchInterval: 30000,
  });

  // Trading212 portfolio
  const t212Query = useQuery({
    queryKey: ['t212-portfolio-positions'],
    queryFn: () => apiGet('/api/portfolio?source=trading212').catch(() => ({ positions: [] })),
    staleTime: 15000,
    refetchInterval: 60000,
  });

  // Close mutation
  const closeMutation = useMutation({
    mutationFn: ({ ticket }) => fetch(`/api/trading/mt5/close/${ticket}`, { method: 'DELETE' }).then(r => r.json()),
    onMutate: ({ ticket }) => setClosingTicket(ticket),
    onSettled: () => setClosingTicket(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mt5-positions'] });
      qc.invalidateQueries({ queryKey: ['trade-history'] });
    },
  });

  const handleClose = useCallback((ticket, symbol) => {
    if (window.confirm(`Close ${symbol} position #${ticket}?`)) {
      closeMutation.mutate({ ticket });
    }
  }, [closeMutation]);

  // Map MT5 positions — fixed camelCase field names
  const mt5Positions = useMemo(() => (mt5Query.data?.positions || []).map((p) => {
    const entryPrice = p.priceOpen;
    const curPrice = p.priceCurrent;
    const pnlAbs = p.profit || 0;
    const pnlPctVal = entryPrice && curPrice
      ? (p.type === 'sell' ? -1 : 1) * ((curPrice - entryPrice) / entryPrice) * 100
      : 0;
    const heldDays = p.openTime
      ? Math.max(1, Math.floor((Date.now() - new Date(p.openTime).getTime()) / 86400000))
      : 0;

    return {
      symbol: p.symbol,
      direction: p.type === 'buy' || p.type === 0 ? 'BUY' : 'SELL',
      volume: String(p.volume),
      leverage: '—',
      margin: entryPrice && p.volume ? (entryPrice * p.volume).toFixed(2) : '—',
      pnl: pnlAbs,
      pnlPct: pnlPctVal,
      daysHeld: heldDays,
      sl: p.sl,
      tp: p.tp,
      overnightFee: p.swap || 0,
      riskPct: entryPrice && curPrice ? Math.abs(((curPrice - entryPrice) / entryPrice) * 100) : 0,
      ticket: p.ticket,
      source: 'MT5',
      currentPrice: curPrice,
      avgCost: entryPrice,
      allocation: null,
    };
  }), [mt5Query.data]);

  // Map Trading212 positions
  const t212Positions = useMemo(() => (t212Query.data?.positions || []).map((p) => ({
    symbol: p.ticker || p.symbol,
    direction: 'BUY',
    volume: String(p.shares || p.quantity || '—'),
    leverage: '—',
    margin: p.avgCost && (p.shares || p.quantity) ? (p.avgCost * (p.shares || p.quantity)).toFixed(2) : '—',
    pnl: p.pnl || 0,
    pnlPct: p.pnlPct != null ? p.pnlPct : 0,
    daysHeld: p.initialFillDate ? Math.max(1, Math.floor((Date.now() - new Date(p.initialFillDate).getTime()) / 86400000)) : 0,
    sl: '—',
    tp: '—',
    overnightFee: 0,
    riskPct: Math.abs(p.pnlPct || 0),
    allocation: p.allocation ? p.allocation * 100 : null,
    ticket: p.ticker || p.symbol,
    source: 'Trading212',
    currentPrice: p.currentPrice,
    avgCost: p.avgCost,
  })), [t212Query.data]);

  const allPositions = useMemo(() => [...mt5Positions, ...t212Positions], [mt5Positions, t212Positions]);

  const sortFn = SORT_OPTIONS.find(s => s.key === sortKey)?.fn || SORT_OPTIONS[0].fn;

  const filteredPositions = useMemo(() => {
    let list = sourceFilter === 'all'
      ? allPositions
      : allPositions.filter((p) => p.source.toLowerCase() === sourceFilter.toLowerCase());
    return [...list].sort(sortFn);
  }, [allPositions, sourceFilter, sortFn]);

  const lastUpdated = mt5Query.dataUpdatedAt || t212Query.dataUpdatedAt
    ? new Date(Math.max(mt5Query.dataUpdatedAt || 0, t212Query.dataUpdatedAt || 0)).toLocaleTimeString()
    : null;

  return (
    <div className="pm-page">
      <header className="pm-header">
        <h1>Positions Monitor</h1>
        <p>Combined view of all open positions across brokers.</p>
      </header>

      {/* Portfolio Summary Banner */}
      <SummaryBanner positions={allPositions} />

      <div className="pm-tabs">
        <button className={`pm-tab ${tab === 'cfd' ? 'pm-active' : ''}`} onClick={() => setTab('cfd')}>Positions</button>
        <button className={`pm-tab ${tab === 'options' ? 'pm-active' : ''}`} onClick={() => setTab('options')}>Options</button>

        {/* Sort controls */}
        <div className="pm-sort-controls">
          <span>Sort:</span>
          {SORT_OPTIONS.map((s) => (
            <button
              key={s.key}
              className={`pm-source-chip ${sortKey === s.key ? 'pm-active' : ''}`}
              onClick={() => setSortKey(s.key)}
            >{s.label}</button>
          ))}
        </div>

        {/* Data freshness */}
        {lastUpdated && (
          <span className="pm-freshness" title={`MT5: ${mt5Query.isFetching ? 'refreshing' : 'stale'} · T212: ${t212Query.isFetching ? 'refreshing' : 'stale'}`}>
            Updated {lastUpdated}
          </span>
        )}

        <div className="pm-source-filter">
          <span>Source:</span>
          {['all', 'MT5', 'Trading212'].map((s) => (
            <button key={s} className={`pm-source-chip ${sourceFilter === s ? 'pm-active' : ''}`} onClick={() => setSourceFilter(s)}>{s}</button>
          ))}
        </div>
      </div>

      {tab === 'cfd' && (
        <div className="pm-positions">
          {(mt5Query.isLoading || t212Query.isLoading) && <div className="pm-empty">Loading positions...</div>}
          {filteredPositions.length === 0 && !mt5Query.isLoading && !t212Query.isLoading && <div className="pm-empty">No open positions. Connect MT5 or Trading212 to see your holdings.</div>}
          {filteredPositions.map((p, i) => (
            <CFDPosition
              key={p.ticket || i}
              pos={p}
              index={i}
              onClose={handleClose}
              isClosing={closingTicket === p.ticket}
            />
          ))}
        </div>
      )}

      {tab === 'options' && (
        <div className="pm-positions">
          <div className="pm-empty">
            <p>Options monitoring not yet available.</p>
            <p className="pm-empty-sub">Connect an options-capable broker (e.g., Interactive Brokers) to enable this tab.</p>
          </div>
        </div>
      )}
    </div>
  );
}
