import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './position-lifecycle.css';

/**
 * Position Lifecycle Monitor — Lab prototype
 * ===========================================
 * Visualizes the full position lifecycle the backend now records:
 *   open → brokerTicket linked → closed (real exit via deal history).
 * Three panels: reconciled Trades, broker Position rows, and recent
 * stop adjustments. Backed by GET /api/trading/position-lifecycle.
 */

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function SideBadge({ side }) {
  const s = (side || '').toLowerCase();
  if (!s) return null;
  return <span className={`pl-side pl-side-${s}`}>{s.toUpperCase()}</span>;
}

function OriginBadge({ origin }) {
  const o = origin || 'unknown';
  return <span className={`pl-origin pl-origin-${o}`}>{o}</span>;
}

export default function PositionLifecyclePage() {
  const query = useQuery({
    queryKey: ['position-lifecycle'],
    queryFn: () => apiGet('/api/trading/position-lifecycle').catch(() => null),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const data = query.data || {};
  const trades = data.trades || [];
  const positions = data.positions || [];
  const adjustments = data.adjustments || [];
  const sync = data.sync || {};

  const openTrades = trades.filter(t => t.status === 'open');
  const closedTrades = trades.filter(t => t.status === 'closed');

  return (
    <div className="pl-page">
      <header className="pl-header">
        <h2>Position Lifecycle Monitor</h2>
        <p className="pl-sub">Lab prototype — the traceability chain behind every position: open → broker ticket linked → closed with real exit.</p>
      </header>

      <div className="pl-stats">
        <div className="pl-stat"><span className="pl-stat-num">{openTrades.length}</span><span>Open trades</span></div>
        <div className="pl-stat"><span className="pl-stat-num">{closedTrades.length}</span><span>Closed (recent)</span></div>
        <div className="pl-stat"><span className="pl-stat-num">{positions.length}</span><span>Broker positions</span></div>
        <div className="pl-stat"><span className="pl-stat-num pl-stat-time">{fmtTime(sync.lastSyncedAt)}</span><span>Last position sync</span></div>
      </div>

      <section className="pl-section">
        <h3>Open Trades <span className="pl-hint">(trade table — brokerTicket, origin, source)</span></h3>
        {openTrades.length === 0 ? (
          <p className="pl-empty">No open trades recorded.</p>
        ) : (
          <table className="pl-table">
            <thead><tr><th>Symbol</th><th>Side</th><th>Ticket</th><th>Origin</th><th>Source</th><th>Qty</th><th>Entry</th><th>Opened</th></tr></thead>
            <tbody>
              {openTrades.map(t => (
                <tr key={t.id}>
                  <td className="pl-symbol">{t.symbol}</td>
                  <td><SideBadge side={t.side} /></td>
                  <td className="pl-mono">{t.brokerTicket ? `#${t.brokerTicket}` : '—'}</td>
                  <td><OriginBadge origin={t.origin} /></td>
                  <td className="pl-muted">{t.source || '—'}</td>
                  <td>{t.quantity ?? '—'}</td>
                  <td>{t.entryPrice ?? '—'}</td>
                  <td className="pl-muted">{fmtTime(t.openedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="pl-section">
        <h3>Broker Positions <span className="pl-hint">(position table — live synced snapshot)</span></h3>
        {positions.length === 0 ? (
          <p className="pl-empty">No positions synced yet. The automation loop syncs broker positions each tick.</p>
        ) : (
          <table className="pl-table">
            <thead><tr><th>Symbol</th><th>Side</th><th>Ticket</th><th>Provider</th><th>Qty</th><th>Avg</th><th>P&amp;L</th><th>Last quote</th></tr></thead>
            <tbody>
              {positions.map(p => (
                <tr key={p.id}>
                  <td className="pl-symbol">{p.symbol}</td>
                  <td><SideBadge side={p.side} /></td>
                  <td className="pl-mono">{p.brokerTicket ? `#${p.brokerTicket}` : '—'}</td>
                  <td className="pl-muted">{p.provider}</td>
                  <td>{p.quantity ?? '—'}</td>
                  <td>{p.avgPrice ?? '—'}</td>
                  <td className={(p.pnl ?? 0) >= 0 ? 'pl-green' : 'pl-red'}>{(p.pnl ?? 0).toFixed(2)}</td>
                  <td className="pl-muted">{fmtTime(p.lastQuotedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="pl-section">
        <h3>Recent Stop Adjustments <span className="pl-hint">(stop_adjustment audit)</span></h3>
        {adjustments.length === 0 ? (
          <p className="pl-empty">No stop adjustments recorded yet.</p>
        ) : (
          <ul className="pl-adjustments">
            {adjustments.map(a => (
              <li key={a.id}>
                <span className="pl-symbol">{a.symbol}</span>
                <span className="pl-mono">#{a.tradeTicket}</span>
                <span className="pl-muted">SL {a.oldSl ?? '—'} → {a.newSl ?? '—'}</span>
                <span className="pl-reason">{a.reason}</span>
                <span className="pl-muted">{fmtTime(a.adjustedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
