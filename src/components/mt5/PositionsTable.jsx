export default function PositionsTable({ positions = [], onClose }) {
  if (!positions.length) {
    return <p className="mt5-empty">No open positions</p>;
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
              <td>{formatPrice(p.price_open, p.symbol)}</td>
              <td>{formatPrice(p.price_current, p.symbol)}</td>
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

function formatPrice(price, symbol) {
  if (price == null) return '—';
  const isForex = /^[A-Z]{6}$/.test(symbol) || symbol?.includes('.') === false;
  return isForex ? price.toFixed(5) : price.toFixed(2);
}
