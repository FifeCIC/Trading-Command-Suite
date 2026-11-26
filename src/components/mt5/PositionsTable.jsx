import EmptyState from '../EmptyState';

export default function PositionsTable({ positions = [], onClose }) {
  if (!positions.length) {
    return <EmptyState icon="📊" title="No open positions" />;
  }

  return (
    <table className="mt5-table">
      <thead>
        <tr>
          <th>Symbol</th><th>Type</th><th>Volume</th>
          <th>Open</th><th>Current</th><th>P&amp;L</th>
          <th>%</th><th></th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p, i) => {
          const pnl = p.profit ?? 0;
          const pnlPct = p.price_open > 0 ? ((p.price_current - p.price_open) / p.price_open * 100 * (p.type === 1 ? -1 : 1)).toFixed(2) : '—';
          return (
            <tr key={p.ticket || i} className={pnl >= 0 ? 'mt5-row-profit' : 'mt5-row-loss'}>
              <td><strong>{p.symbol}</strong></td>
              <td className={p.type === 0 ? 'mt5-green' : 'mt5-red'}>{p.type === 0 ? 'BUY' : 'SELL'}</td>
              <td>{p.volume?.toFixed(2)}</td>
              <td>{formatBrokerPrice(p.price_open, p.symbol)}</td>
              <td>{formatBrokerPrice(p.price_current, p.symbol)}</td>
              <td className={pnl >= 0 ? 'mt5-green' : 'mt5-red'}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</td>
              <td className={pnl >= 0 ? 'mt5-green' : 'mt5-red'}>{(pnlPct >= 0 ? '+' : '')}{pnlPct}%</td>
              <td><button type="button" className="mt5-close-btn" onClick={() => onClose(p.ticket)} title="Close position">✕</button></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * formatBrokerPrice() — a price at the precision the INSTRUMENT quotes at: 5dp for a 6-letter
 * forex pair, 2dp otherwise.
 *
 * — NOT `formatPrice()` from `core/format-utils`, which keys off the MAGNITUDE (4dp under 1). This
 * one keys off the SYMBOL, because a broker quotes EURUSD at 1.08—no, 5dp is what makes the
 * tick visible. Two different questions; keeping the same name is how they would get conflated.
 */
function formatBrokerPrice(price, symbol) {
  if (price == null) return '—';
  const isForex = /^[A-Z]{6}$/.test(symbol) || symbol?.includes('.') === false;
  return isForex ? price.toFixed(5) : price.toFixed(2);
}
