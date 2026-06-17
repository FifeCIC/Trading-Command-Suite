import { useState, useCallback, useMemo } from 'react';
import DetachableWidget from '../components/DetachableWidget';
import './component-lab.css';

// ═══════════════════════════════════════════════════════════
// Demo data generators
// ═══════════════════════════════════════════════════════════

function fakePrice(base = 100) {
  return (base + (Math.random() - 0.48) * 3).toFixed(2);
}

function fakeChange() {
  const v = (Math.random() - 0.45) * 5;
  return { value: v.toFixed(2), positive: v >= 0 };
}

function fakeVolume() {
  return Math.floor(Math.random() * 9_000_000 + 500_000).toLocaleString();
}

const INITIAL_TICKERS = [
  { sym: 'AAPL', base: 198 },
  { sym: 'NVDA', base: 129 },
  { sym: 'TSLA', base: 228 },
  { sym: 'MSFT', base: 463 },
  { sym: 'AMD', base: 94 },
];

const SAMPLE_SIGNALS = [
  { id: 1, sym: 'NVDA', action: 'BUY', confidence: 87, reason: 'Momentum breakout above 130 resistance' },
  { id: 2, sym: 'TSLA', action: 'SELL', confidence: 72, reason: 'Bearish engulfing on daily' },
  { id: 3, sym: 'AAPL', action: 'HOLD', confidence: 55, reason: 'Consolidating in triangle pattern' },
  { id: 4, sym: 'AMD', action: 'BUY', confidence: 91, reason: 'AI chip demand surge' },
];

// ═══════════════════════════════════════════════════════════
// Market Ticker Widget
// ═══════════════════════════════════════════════════════════

function MarketTickerWidget() {
  const [tickers, setTickers] = useState(() =>
    INITIAL_TICKERS.map((t) => ({
      ...t,
      price: fakePrice(t.base),
      ...fakeChange(),
      volume: fakeVolume(),
    })),
  );
  const [paused, setPaused] = useState(false);

  const refresh = useCallback(() => {
    setTickers((prev) =>
      prev.map((t) => ({
        ...t,
        price: fakePrice(t.base),
        ...fakeChange(),
        volume: fakeVolume(),
      })),
    );
  }, []);

  // Auto-refresh every 2s unless paused
  useState(() => {
    if (paused) return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [paused, refresh]);

  return (
    <DetachableWidget
      title="Market Ticker"
      size="md"
      statusDot
      badge={`${tickers.length} symbols`}
      colorAccent="#0ea5a6"
      actions={
        <button
          type="button"
          className="dw-btn-icon"
          title={paused ? 'Resume' : 'Pause'}
          onClick={() => setPaused(!paused)}
        >
          {paused ? '▶' : '⏸'}
        </button>
      }
      footer={
        <span className="cl-muted">
          {paused ? 'Paused' : 'Live'} · {new Date().toLocaleTimeString()}
        </span>
      }
    >
      <table className="cl-ticker-table">
        <thead>
          <tr>
            <th>Sym</th>
            <th className="cl-right">Price</th>
            <th className="cl-right">Change</th>
            <th className="cl-right cl-hide-sm">Vol</th>
          </tr>
        </thead>
        <tbody>
          {tickers.map((t) => (
            <tr key={t.sym}>
              <td className="cl-sym">{t.sym}</td>
              <td className="cl-right cl-mono">{t.price}</td>
              <td className={`cl-right cl-mono ${t.positive ? 'cl-up' : 'cl-down'}`}>
                {t.positive ? '+' : ''}{t.value}%
              </td>
              <td className="cl-right cl-mono cl-hide-sm cl-muted">{t.volume}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DetachableWidget>
  );
}

// ═══════════════════════════════════════════════════════════
// Signal Feed Widget
// ═══════════════════════════════════════════════════════════

function SignalFeedWidget() {
  const [signals] = useState(SAMPLE_SIGNALS);
  const [expanded, setExpanded] = useState(null);

  return (
    <DetachableWidget
      title="Signal Feed"
      size="md"
      statusDot
      badge={String(signals.length)}
      colorAccent="#f59e0b"
    >
      <div className="cl-signal-list">
        {signals.map((s) => (
          <div
            key={s.id}
            className={`cl-signal-row ${expanded === s.id ? 'cl-expanded' : ''}`}
            onClick={() => setExpanded(expanded === s.id ? null : s.id)}
          >
            <div className="cl-signal-header">
              <span className="cl-sym">{s.sym}</span>
              <span className={`cl-action cl-action-${s.action.toLowerCase()}`}>
                {s.action}
              </span>
              <span className="cl-confidence">{s.confidence}%</span>
            </div>
            {expanded === s.id && (
              <p className="cl-signal-reason">{s.reason}</p>
            )}
          </div>
        ))}
      </div>
    </DetachableWidget>
  );
}

// ═══════════════════════════════════════════════════════════
// Risk Gauge Widget
// ═══════════════════════════════════════════════════════════

function RiskGaugeWidget() {
  const metrics = useMemo(
    () => ({
      var: (Math.random() * 3 + 0.8).toFixed(1),
      exposure: (Math.random() * 60 + 15).toFixed(0),
      sharpe: (Math.random() * 2 + 0.4).toFixed(2),
      drawdown: (Math.random() * 12 + 2).toFixed(1),
    }),
    [],
  );

  const riskLevel = Number(metrics.exposure) > 50 ? 'high' : Number(metrics.exposure) > 30 ? 'mid' : 'low';

  return (
    <DetachableWidget
      title="Risk Gauge"
      size="sm"
      colorAccent={riskLevel === 'high' ? '#ef4444' : riskLevel === 'mid' ? '#f59e0b' : '#22c55e'}
      subtitle={`Exposure: ${metrics.exposure}%`}
    >
      <div className="cl-risk-grid">
        <div className="cl-risk-item">
          <span className="cl-risk-label">VaR (95%)</span>
          <span className="cl-mono">{metrics.var}%</span>
        </div>
        <div className="cl-risk-item">
          <span className="cl-risk-label">Exposure</span>
          <span className={`cl-mono ${riskLevel === 'high' ? 'cl-down' : ''}`}>
            {metrics.exposure}%
          </span>
        </div>
        <div className="cl-risk-item">
          <span className="cl-risk-label">Sharpe</span>
          <span className="cl-mono">{metrics.sharpe}</span>
        </div>
        <div className="cl-risk-item">
          <span className="cl-risk-label">Max DD</span>
          <span className="cl-mono cl-down">−{metrics.drawdown}%</span>
        </div>
      </div>
      {/* Risk bar */}
      <div className="cl-risk-bar-track">
        <div
          className={`cl-risk-bar-fill cl-risk-${riskLevel}`}
          style={{ width: `${Math.min(Number(metrics.exposure), 100)}%` }}
        />
      </div>
    </DetachableWidget>
  );
}

// ═══════════════════════════════════════════════════════════
// Position Summary Widget
// ═══════════════════════════════════════════════════════════

function PositionSummaryWidget() {
  const positions = useMemo(
    () => [
      { sym: 'AAPL', qty: 50, entry: 195.2, current: 198.32, pnl: 156 },
      { sym: 'NVDA', qty: 30, entry: 124.5, current: 129.14, pnl: 139.2 },
      { sym: 'TSLA', qty: -20, entry: 232.0, current: 227.91, pnl: 81.8 },
    ],
    [],
  );

  const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);

  return (
    <DetachableWidget
      title="Positions"
      size="md"
      statusDot
      badge={`${positions.length} open`}
      colorAccent="#8b5cf6"
      footer={
        <span className={`cl-mono ${totalPnl >= 0 ? 'cl-up' : 'cl-down'}`}>
          Total P&L: {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(1)}
        </span>
      }
    >
      <table className="cl-ticker-table">
        <thead>
          <tr>
            <th>Sym</th>
            <th className="cl-right">Qty</th>
            <th className="cl-right">Entry</th>
            <th className="cl-right">Last</th>
            <th className="cl-right">P&L</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.sym}>
              <td className="cl-sym">{p.sym}</td>
              <td className={`cl-right cl-mono ${p.qty < 0 ? 'cl-down' : 'cl-up'}`}>
                {p.qty > 0 ? '+' : ''}{p.qty}
              </td>
              <td className="cl-right cl-mono">{p.entry}</td>
              <td className="cl-right cl-mono">{p.current}</td>
              <td className={`cl-right cl-mono ${p.pnl >= 0 ? 'cl-up' : 'cl-down'}`}>
                {p.pnl >= 0 ? '+' : ''}{p.pnl.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DetachableWidget>
  );
}

// ═══════════════════════════════════════════════════════════
// System Health Widget
// ═══════════════════════════════════════════════════════════

function SystemHealthWidget() {
  const [checks] = useState([
    { label: 'NestJS API', ok: true, latency: '12ms' },
    { label: 'MySQL', ok: true, latency: '3ms' },
    { label: 'MT5 Bridge', ok: true, latency: '45ms' },
    { label: 'Alpaca API', ok: false, latency: 'timeout' },
    { label: 'Redis Cache', ok: true, latency: '1ms' },
  ]);

  const allOk = checks.every((c) => c.ok);

  return (
    <DetachableWidget
      title="System Health"
      size="sm"
      statusDot={allOk}
      badge={allOk ? 'All OK' : '1 down'}
      colorAccent={allOk ? '#22c55e' : '#f59e0b'}
    >
      <div className="cl-health-list">
        {checks.map((c) => (
          <div key={c.label} className="cl-health-row">
            <span className={`cl-health-dot ${c.ok ? 'cl-health-ok' : 'cl-health-fail'}`} />
            <span className="cl-health-label">{c.label}</span>
            <span className={`cl-mono cl-muted ${!c.ok ? 'cl-down' : ''}`}>{c.latency}</span>
          </div>
        ))}
      </div>
    </DetachableWidget>
  );
}

// ═══════════════════════════════════════════════════════════
// Mini Chart Widget (decorative sparkline)
// ═══════════════════════════════════════════════════════════

function MiniChartWidget() {
  const points = useMemo(() => {
    const pts = [];
    let v = 50;
    for (let i = 0; i < 40; i++) {
      v += (Math.random() - 0.47) * 8;
      v = Math.max(5, Math.min(95, v));
      pts.push(v);
    }
    return pts;
  }, []);

  const polylinePoints = points.map((p, i) => `${(i / (points.length - 1)) * 100},${100 - p}`).join(' ');

  return (
    <DetachableWidget
      title="SPY Intraday"
      size="sm"
      subtitle="Minute candles"
      colorAccent="#0ea5a6"
      badge="R 20"
    >
      <svg viewBox="0 0 100 100" className="cl-sparkline" preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke="var(--accent, #0ea5a6)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={polylinePoints}
        />
        {/* Gradient fill */}
        <defs>
          <linearGradient id="clSparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent, #0ea5a6)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent, #0ea5a6)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          fill="url(#clSparkGrad)"
          points={`0,100 ${polylinePoints} 100,100`}
        />
      </svg>
    </DetachableWidget>
  );
}

// ═══════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════

export default function ComponentLabPage() {
  const [showCodes, setShowCodes] = useState(false);

  return (
    <div className="cl-page">
      <header className="cl-header">
        <h1>Component Lab</h1>
        <p className="cl-subtitle">
          Detachable, themable widgets built on <code>&lt;DetachableWidget /&gt;</code>.
          Each widget can be detached into a floating overlay for a custom dashboard layout.
        </p>
        <div className="cl-header-actions">
          <button type="button" className="cl-toggle-btn" onClick={() => setShowCodes(!showCodes)}>
            {showCodes ? 'Hide' : 'Show'} Usage Patterns
          </button>
        </div>
      </header>

      {/* ── Usage patterns ────────────────────────────────── */}
      {showCodes && (
        <section className="cl-section">
          <h2>Usage Patterns</h2>
          <div className="cl-patterns">
            <div className="cl-pattern">
              <strong>Inline Widget</strong>
              <pre className="cl-code">{`<DetachableWidget
  title="Market Ticker"
  size="md"
  statusDot          // green dot = live
  badge="5 symbols"  // pill badge
  colorAccent="#0ea5a6"
  footer={<span>Live updates</span>}
>
  {/* your content */}
</DetachableWidget>`}</pre>
            </div>
            <div className="cl-pattern">
              <strong>Widget Sizes</strong>
              <pre className="cl-code">{`size="sm"   // 280×200
size="md"   // 360×280 (default)
size="lg"   // 480×360
size="full" // 640×480`}</pre>
            </div>
            <div className="cl-pattern">
              <strong>Props Reference</strong>
              <pre className="cl-code">{`title        string          Widget title
subtitle     string          Optional subtitle
size         sm|md|lg|full   Preset dimensions
statusDot    boolean         Green/grey dot
badge        string          Pill badge text
colorAccent  string          Left border + accent
actions      ReactNode       Title bar action buttons
footer       ReactNode       Bottom bar content
draggable    boolean         Show drag grip
detachable   boolean         Show detach button
minimizable  boolean         Show minimize button
closable     boolean         Show close button
onDetach     function        Called on detach
onClose      function        Called on close
defaultMinimized boolean     Start minimized`}</pre>
            </div>
          </div>
        </section>
      )}

      {/* ── Widget Showcase ──────────────────────────────── */}
      <section className="cl-section">
        <h2>Widget Showcase</h2>
        <p className="cl-hint">
          Try the <strong>⤢ detach</strong> button on each widget to pop it out into a floating overlay.
          The floating window can be dragged and resized. Press <strong>Esc</strong> or click the backdrop to reattach.
        </p>

        <div className="dw-grid">
          <MarketTickerWidget />
          <SignalFeedWidget />
          <RiskGaugeWidget />
          <PositionSummaryWidget />
          <SystemHealthWidget />
          <MiniChartWidget />
        </div>
      </section>

      {/* ── Compact layout demo ──────────────────────────── */}
      <section className="cl-section">
        <h2>Compact / Dashboard Layout</h2>
        <p className="cl-hint">
          Use <code>dw-grid-dense</code> for a tighter dashboard grid with smaller widgets.
        </p>

        <div className="dw-grid dw-grid-dense">
          <RiskGaugeWidget />
          <SystemHealthWidget />
          <MiniChartWidget />
        </div>
      </section>
    </div>
  );
}
