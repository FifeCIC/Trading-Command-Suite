import { useState, useEffect, useCallback } from 'react';
import { placeSellOrder, placeBuyOrder } from '../core/api/orders';
import './OrderModal.css';

/**
 * OrderModal — Two-step order confirmation modal with safety gates.
 *
 * Props:
 *  - position    : { symbol, shares, avgCost, currentPrice, pnl, pnlPct, value }
 *  - accountCash : number (free cash, for buy flow)
 *  - mode        : 'sell' | 'buy'
 *  - onClose     : () => void
 *  - onComplete  : (result) => void
 *  - adapterMode : 'demo' | 'live' | 'none'
 */
export default function OrderModal({ position, accountCash, mode = 'sell', onClose, onComplete, adapterMode = 'demo' }) {
  const [step, setStep] = useState(1);
  const [quantity, setQuantity] = useState(mode === 'sell' ? position.shares || position.quantity : 1);
  const [orderType, setOrderType] = useState('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [cooldown, setCooldown] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [accountType, setAccountType] = useState('investment');

  const isDemo = adapterMode === 'demo';
  const isLive = adapterMode === 'live';

  const ticker = position.symbol || position.ticker || '';
  const shares = position.shares || position.quantity || 0;
  const currentPrice = position.currentPrice || 0;
  const avgCost = position.avgCost || 0;
  const pnl = position.pnl || 0;
  const pnlPct = position.pnlPct || 0;
  const estimatedProceeds = quantity * currentPrice;
  const remainingShares = Math.max(0, shares - quantity);

  // Cooldown timer for step 2
  useEffect(() => {
    if (step !== 2 || cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [step, cooldown]);

  const canConfirm = step === 2 && cooldown <= 0 && confirmText.toUpperCase() === ticker.toUpperCase() && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setError(null);

    try {
      const orderParams = {
        ticker,
        quantity: Number(quantity),
        accountType,
      };
      if (orderType === 'limit') {
        orderParams.limitPrice = Number(limitPrice);
      }

      const fn = mode === 'sell' ? placeSellOrder : placeBuyOrder;
      const res = await fn(orderParams);

      setResult(res);
      if (res.success) {
        setStep(3);
        onComplete?.(res);
      } else {
        setError(res.error || 'Order failed');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }, [canConfirm, ticker, quantity, accountType, orderType, limitPrice, mode, onComplete]);

  return (
    <div className="om-overlay" onClick={onClose}>
      <div className="om-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="om-header">
          <h2>
            {mode === 'sell' ? 'Sell' : 'Buy'} {ticker}
          </h2>
          <button className="om-close" onClick={onClose}>✕</button>
        </div>

        {/* Step 1: Order Details */}
        {step === 1 && (
          <div className="om-body">
            <div className="om-account-badge">
              {isDemo && '🧪 DEMO / Paper Trading'}
              {isLive && '🔴 LIVE — Real Money'}
              {!isDemo && !isLive && '⚠️ No API key configured'}
              <span className="om-mode-tag">{adapterMode.toUpperCase()}</span>
            </div>

            <div className="om-info-grid">
              <div className="om-info-item">
                <span>Account</span>
                <strong>Trading212 {accountType === 'isa' ? 'Stocks ISA' : 'Investment'}</strong>
              </div>
              <div className="om-info-item">
                <span>Position</span>
                <strong>{shares} shares</strong>
              </div>
              <div className="om-info-item">
                <span>Current Price</span>
                <strong>£{currentPrice.toFixed(2)}</strong>
              </div>
              <div className="om-info-item">
                <span>Avg Cost</span>
                <strong>£{avgCost.toFixed(2)}</strong>
              </div>
              <div className="om-info-item">
                <span>P&amp;L</span>
                <strong className={pnl >= 0 ? 'om-green' : 'om-red'}>
                  {pnl >= 0 ? '+' : ''}£{Math.abs(pnl).toFixed(2)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                </strong>
              </div>
            </div>

            {accountType === 'isa' && (
              <div className="om-isa-notice">
                ISA allowance: trades within an ISA are tax-free. You can contribute up to £20,000 per tax year.
              </div>
            )}

            <div className="om-field">
              <label>Shares to {mode}</label>
              <div className="om-qty-row">
                <input
                  type="number"
                  step="any"
                  min={0.0001}
                  max={mode === 'sell' ? shares : 999999}
                  value={quantity}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (mode === 'sell') setQuantity(Math.max(0.0001, Math.min(v, shares)));
                    else setQuantity(Math.max(0.0001, v));
                  }}
                />
                {mode === 'sell' && (
                  <button
                    className="om-link-btn"
                    disabled={quantity === shares}
                    onClick={() => setQuantity(shares)}
                  >
                    Sell All ({shares})
                  </button>
                )}
              </div>
            </div>

            <div className="om-field">
              <label>Order Type</label>
              <div className="om-radio-group">
                <label className={`om-radio ${orderType === 'market' ? 'om-radio-active' : ''}`}>
                  <input type="radio" name="orderType" value="market" checked={orderType === 'market'} onChange={() => setOrderType('market')} />
                  Market
                </label>
                <label className={`om-radio ${orderType === 'limit' ? 'om-radio-active' : ''}`}>
                  <input type="radio" name="orderType" value="limit" checked={orderType === 'limit'} onChange={() => setOrderType('limit')} />
                  Limit
                </label>
              </div>
            </div>

            {orderType === 'limit' && (
              <div className="om-field">
                <label>Limit Price (£)</label>
                <input type="number" step="0.01" min="0.01" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder={currentPrice.toFixed(2)} />
              </div>
            )}

            <div className="om-field">
              <label>Account</label>
              <select value={accountType} onChange={(e) => setAccountType(e.target.value)}>
                <option value="investment">Trading212 Investment</option>
                <option value="isa">Trading212 Stocks ISA</option>
              </select>
            </div>

            <div className="om-estimate">
              <div className="om-est-row">
                <span>Estimated proceeds</span>
                <strong>£{estimatedProceeds.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </div>
              {mode === 'sell' && (
                <div className="om-est-row">
                  <span>After sale</span>
                  <span>{remainingShares} shares remaining worth ~£{(remainingShares * currentPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              )}
            </div>

            <button className="om-btn om-btn-primary" onClick={() => setStep(2)}>
              Review Order →
            </button>
          </div>
        )}

        {/* Step 2: Confirmation */}
        {step === 2 && (
          <div className="om-body">
            <div className={`om-warning ${isLive ? 'om-warning-live' : 'om-warning-demo'}`}>
              {isLive ? (
                <>
                  <strong>⚠️ LIVE ORDER</strong>
                  <p>This will place a REAL {mode} order on your live Trading212 {accountType === 'isa' ? 'Stocks ISA' : 'Investment'} account. This action cannot be undone.</p>
                </>
              ) : (
                <>
                  <strong>🧪 PAPER TRADE</strong>
                  <p>This is a DEMO order. No real money will be used. Use this to verify the flow works correctly.</p>
                </>
              )}
            </div>

            <div className="om-order-summary">
              <h3>Order Summary</h3>
              <div className="om-summary-row">
                <span>Action</span>
                <strong>{mode === 'sell' ? 'SELL' : 'BUY'} {quantity} shares of {ticker}</strong>
              </div>
              <div className="om-summary-row">
                <span>Type</span>
                <strong>{orderType === 'market' ? 'Market Order' : `Limit @ £${Number(limitPrice).toFixed(2)}`}</strong>
              </div>
              <div className="om-summary-row">
                <span>Estimated {mode === 'sell' ? 'Proceeds' : 'Cost'}</span>
                <strong>£{estimatedProceeds.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </div>
              <div className="om-summary-row">
                <span>Account</span>
                <strong>Trading212 {accountType === 'isa' ? 'Stocks ISA' : 'Investment'} ({adapterMode.toUpperCase()})</strong>
              </div>
            </div>

            <div className="om-field">
              <label>Type the ticker <strong>{ticker}</strong> to confirm:</label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={ticker}
                autoFocus
              />
            </div>

            {cooldown > 0 && (
              <div className="om-cooldown">
                Confirm button enabled in <strong>{cooldown}</strong>...
              </div>
            )}

            {error && <div className="om-error">{error}</div>}

            <div className="om-actions">
              <button className="om-btn om-btn-secondary" onClick={() => { setStep(1); setCooldown(5); setConfirmText(''); setError(null); }}>
                ← Back
              </button>
              <button
                className="om-btn om-btn-danger"
                disabled={!canConfirm}
                onClick={handleSubmit}
              >
                {submitting ? 'Placing Order...' : `Confirm ${mode === 'sell' ? 'Sell' : 'Buy'}`}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Result */}
        {step === 3 && result && (
          <div className="om-body">
            <div className={`om-result ${result.success ? 'om-result-ok' : 'om-result-fail'}`}>
              <div className="om-result-icon">{result.success ? '✅' : '❌'}</div>
              <h3>{result.success ? 'Order Placed' : 'Order Failed'}</h3>
              {result.success ? (
                <div className="om-result-details">
                  <div><span>Order ID</span><strong>{result.orderId || '—'}</strong></div>
                  <div><span>Status</span><strong>{result.status || 'filled'}</strong></div>
                  {result.filledPrice && <div><span>Filled at</span><strong>£{Number(result.filledPrice).toFixed(2)}</strong></div>}
                  {result.filledQuantity && <div><span>Filled Qty</span><strong>{result.filledQuantity}</strong></div>}
                </div>
              ) : (
                <p className="om-error-msg">{result.error || 'Unknown error'}</p>
              )}
            </div>
            <button className="om-btn om-btn-primary" onClick={onClose}>
              {result.success ? 'View Portfolio' : 'Close'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
