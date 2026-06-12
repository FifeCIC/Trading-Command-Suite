import { useState } from 'react';

const LOT_SIZES = [0.01, 0.1, 0.5, 1.0];
const SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'XAUUSD'];

export default function OrderForm({ quote, onPlaceOrder }) {
  const [symbol, setSymbol] = useState('EURUSD');
  const [orderType, setOrderType] = useState('market');
  const [volume, setVolume] = useState(0.01);
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [placing, setPlacing] = useState(false);

  async function handlePlace() {
    setPlacing(true);
    try {
      await onPlaceOrder({
        symbol,
        type: 'buy', // will add sell selector
        volume,
        sl: sl ? Number(sl) : undefined,
        tp: tp ? Number(tp) : undefined,
      });
    } finally {
      setPlacing(false);
    }
  }

  const bid = quote?.bid ?? null;
  const ask = quote?.ask ?? null;

  return (
    <div className="mt5-order-form">
      <div className="mt5-quote-display">
        <div className="mt5-quote-bid"><span>Bid</span><strong>{bid != null ? bid.toFixed(5) : '—'}</strong></div>
        <div className="mt5-quote-ask"><span>Ask</span><strong>{ask != null ? ask.toFixed(5) : '—'}</strong></div>
      </div>

      <div className="mt5-form-group">
        <label>Symbol</label>
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="mt5-form-group">
        <label>Type</label>
        <select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
          <option value="market">Market</option>
          <option value="limit">Limit</option>
          <option value="stop">Stop</option>
        </select>
      </div>

      <div className="mt5-form-group">
        <label>Volume (lots)</label>
        <input type="number" value={volume} min={0.01} step={0.01} onChange={(e) => setVolume(Number(e.target.value))} />
        <div className="mt5-lot-btns">
          {LOT_SIZES.map((s) => (
            <button key={s} type="button" className={volume === s ? 'mt5-lot-active' : ''} onClick={() => setVolume(s)}>{s}</button>
          ))}
        </div>
      </div>

      <div className="mt5-form-row">
        <div className="mt5-form-group">
          <label>Stop Loss (pts)</label>
          <input type="number" value={sl} placeholder="Optional" onChange={(e) => setSl(e.target.value)} />
        </div>
        <div className="mt5-form-group">
          <label>Take Profit (pts)</label>
          <input type="number" value={tp} placeholder="Optional" onChange={(e) => setTp(e.target.value)} />
        </div>
      </div>

      <div className="mt5-order-btns">
        <button type="button" className="mt5-btn-buy" onClick={handlePlace} disabled={placing}>
          {placing ? 'Placing…' : `Buy ${volume} ${symbol}`}
        </button>
        <button type="button" className="mt5-btn-sell" onClick={handlePlace} disabled={placing}>
          {placing ? 'Placing…' : `Sell ${volume} ${symbol}`}
        </button>
      </div>
    </div>
  );
}
