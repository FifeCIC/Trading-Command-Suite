# Q284 — First Live Trade: Trading212 Order Execution Readiness

**Type:** Feature + Milestone
**Area:** Trading212 / Portfolio / Orders
**Date:** 2026-06-16
**Depends on:** Q281 (Order Execution Testing), multi-account Trading212 adapter

## Context

A stock is ready to sell in the Trading212 Investment account, but the user has deliberately held off — they want the first live trade to be executed **through this app**. This is a milestone moment: the app transitions from analysis/observation to actual order execution with real money.

Currently, the order execution pipeline is **non-existent**:
- The `Trading212Adapter` has `getPositions()` and `getAccountCash()` but no `placeOrder()`, `cancelOrder()`, or `getOrders()` methods
- The `Trading212PortfolioController` only has `validate` and `import` endpoints — no order endpoints
- The `PortfolioPage` frontend shows mock data and has no sell/buy buttons
- There is no order confirmation flow, no safety guard, no pre-trade checklist

## The Goal

Execute a **sell order** for a specific stock in the Trading212 Investment account, through the app, with full visibility and safety checks — and have it be the **first live trade this app ever executes**.

## Pre-Flight Safety Requirements

Before ANY order can be placed, these gates must pass:

### Gate 1: API Health
- [ ] Trading212 API is reachable (health check passes)
- [ ] Account credentials are valid (account/cash returns data)
- [ ] Account has the position being sold (verify via portfolio)
- [ ] Rate limit buffer: haven't hit limits in the last 30 seconds

### Gate 2: Position Verification
- [ ] Position exists in the portfolio
- [ ] Quantity to sell ≤ position quantity
- [ ] Current price is available (not stale > 60 seconds)
- [ ] Position P&L is displayed clearly before confirming

### Gate 3: Order Preview
- [ ] Show exact order: "Sell X shares of [TICKER] at market — estimated proceeds: £Y"
- [ ] Show FX impact if multi-currency: "GBP equivalent: £Z at current USD/GBP rate"
- [ ] Show remaining position after sale: "You will hold X remaining shares worth £Y"
- [ ] Show account cash after sale: "Account free cash will increase from £A to £B"

### Gate 4: Confirmation Dialog
- [ ] Two-step confirmation (not a single click):
  1. Review order details → click "Review Order"
  2. Final confirmation with clear warning → click "Confirm Sell"
- [ ] Warning text: "⚠️ This will place a REAL sell order on your live Trading212 account. This action cannot be undone."
- [ ] Require typing the ticker symbol as final confirmation (prevents misclicks)
- [ ] 5-second countdown before the Confirm button becomes clickable (cooling-off period)

### Gate 5: Post-Execution
- [ ] Show order confirmation with Trading212 order ID
- [ ] Poll order status until filled/cancelled/rejected
- [ ] Refresh portfolio to show updated positions
- [ ] Log to `ApiActivityLog` with full request/response
- [ ] Send notification (Windows toast + Discord) on fill

## Implementation

### Backend: Order Execution Methods

Add to `Trading212Adapter`:

```typescript
// ── Order Execution ─────────────────────────────────────

async placeMarketOrder(params: {
  ticker: string;
  quantity: number;
  side: 'buy' | 'sell';
}): Promise<T212OrderResult> {
  if (!this.hasCredentials) {
    return { success: false, error: 'No Trading212 credentials configured' };
  }
  try {
    const res = await fetch(`${this.baseUrl}/equity/orders/market`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: this.toT212Ticker(params.ticker),
        quantity: params.quantity,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return {
        success: false,
        error: data.message || data.code || `HTTP ${res.status}`,
        errorCode: data.code,
        rawResponse: data,
      };
    }
    return {
      success: true,
      orderId: data.id || data.orderId,
      filledQuantity: data.filledQuantity || params.quantity,
      filledPrice: data.fillPrice || data.price,
      status: data.status || 'filled',
      rawResponse: data,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

async placeLimitOrder(params: {
  ticker: string;
  quantity: number;
  side: 'buy' | 'sell';
  limitPrice: number;
}): Promise<T212OrderResult> { /* same pattern, POST /equity/orders/limit */ }

async cancelOrder(orderId: string): Promise<T212OrderResult> { /* DELETE /equity/orders/{id} */ }

async getOrder(orderId: string): Promise<T212OrderResult> { /* GET /equity/orders/{id} */ }

async getOpenOrders(): Promise<T212OrderResult[]> { /* GET /equity/orders */ }
```

### Backend: Order Controller

New endpoints in `Trading212PortfolioController`:

```typescript
@Post('orders/sell')
async sellPosition(@Body() body: {
  ticker: string;
  quantity: number;
  accountType?: 'investment' | 'isa';  // defaults to 'investment'
}) {
  // 1. Validate account connectivity
  // 2. Verify position exists and quantity is available
  // 3. Get current price for proceeds estimate
  // 4. Place market sell order
  // 5. Log to ApiActivityLog
  // 6. Return order result
}

@Post('orders/buy')
async buyPosition(@Body() body: { ticker: string; quantity: number; accountType?: string }) { ... }

@Get('orders')
async listOrders(@Query('accountType') accountType?: string) { ... }

@Get('orders/:id')
async getOrderStatus(@Param('id') id: string) { ... }

@Post('orders/:id/cancel')
async cancelOrder(@Param('id') id: string) { ... }
```

### Frontend: Portfolio Sell Flow

On the Portfolio page (`PortfolioPage.jsx`), add a **"Sell" button** on each position row:

```
┌──────────────────────────────────────────────────────────────┐
│  AAPL — Apple Inc.                                            │
│  50 shares · Avg £175.50 · Current £198.32                    │
│  Value: £9,916 · P&L: +£1,141 (+13.0%)                       │
│  [Sell...]  [View Details]                                    │
└──────────────────────────────────────────────────────────────┘
```

Clicking "Sell..." opens the **Order Modal**:

```
┌──────────────────────────────────────────────────────────────┐
│  Sell AAPL (Apple Inc.)                          [✕ Cancel]  │
│                                                               │
│  Step 1: Order Details                                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Account:    Trading212 Investment (LIVE)                 │ │
│  │ Position:   50 shares                                   │ │
│  │ Current:    £198.32 per share                           │ │
│  │ P&L:        +£1,141.00 (+13.0%)                         │ │
│  │                                                          │ │
│  │ Shares to sell:  [________]  [Max: 50]  [Sell All]     │ │
│  │ Order type:      (•) Market  ( ) Limit                  │ │
│  │                                                          │ │
│  │ Estimated proceeds: £X,XXX.XX                            │ │
│  │ FX impact:          +£XX.XX (GBP is currently WEAK —    │ │
│  │                     favourable time to sell)             │ │
│  │                                                          │ │
│  │ After sale:  X shares remaining worth £X,XXX            │ │
│  │              Account cash: £XX,XXX → £XX,XXX            │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│                              [Review Order →]                 │
└──────────────────────────────────────────────────────────────┘
```

After clicking "Review Order", Step 2 appears:

```
┌──────────────────────────────────────────────────────────────┐
│  ⚠️ CONFIRM LIVE ORDER                                       │
│                                                               │
│  This will place a REAL sell order on your live Trading212   │
│  Investment account. This action cannot be undone.            │
│                                                               │
│  Order summary:                                               │
│  • SELL 25 shares of AAPL at market price                    │
│  • Estimated proceeds: £4,958.00                              │
│  • Account: Trading212 Investment (LIVE)                      │
│                                                               │
│  Type the ticker to confirm: [________]                       │
│                                                               │
│  [Confirm Sell] ← disabled until ticker typed + 5s cooldown  │
│  countdown: 5...                                              │
└──────────────────────────────────────────────────────────────┘
```

After execution:

```
┌──────────────────────────────────────────────────────────────┐
│  ✅ Order Placed                                              │
│                                                               │
│  Order ID:    #ORD-12345678                                  │
│  Status:      Filled                                         │
│  Filled at:   £198.45 per share                              │
│  Proceeds:    £4,961.25                                       │
│                                                               │
│  Portfolio updated. You now hold 25 shares of AAPL.          │
│                                                               │
│  [View Portfolio]  [Close]                                    │
└──────────────────────────────────────────────────────────────┘
```

### ISA Account Support

The sell flow must support both Trading212 accounts:
- **Investment**: multi-currency, shows FX impact
- **Stocks ISA**: GBP only, shows ISA allowance impact ("ISA allowance used: £X of £20,000")

Switchable via a dropdown at the top of the order modal:
```
Account: [Trading212 Investment ▼] [Trading212 Stocks ISA]
```

### Safety Checklist (Pre-Trade)

Before the FIRST live trade is placed, verify:

1. [ ] **Q281 tests passed**: All 11 endpoints tested, error handling verified
2. [ ] **Portfolio import working**: Positions match what Trading212 app shows
3. [ ] **Account balance verified**: Cash + invested = total from Trading212
4. [ ] **Small test first**: Consider placing a minimal buy order (1 share of a penny stock) before the actual sell, to verify the full pipeline end-to-end
5. [ ] **Confirmation flow tested**: Walk through the full modal without submitting (cancel at final step) to verify UX
6. [ ] **Rollback plan**: If the sell order fails or does something unexpected, the user knows how to use the Trading212 app directly as backup

### Post-Trade Actions

After the first successful live trade:

1. **Celebrate** — this is a milestone 🎉
2. **Log everything**: Store the full order lifecycle in `ApiActivityLog`
3. **Update documentation**: Record what worked, what was surprising
4. **Review the flow**: Did the confirmation feel right? Too many steps? Too few?
5. **Enable for ISA**: Once Investment account is proven, enable order execution for Stocks ISA

## Files to Create/Modify

### Modified Files
- `nest/src/modules/providers/adapters/trading212.adapter.ts` — add `placeMarketOrder`, `placeLimitOrder`, `cancelOrder`, `getOrder`, `getOpenOrders`
- `nest/src/modules/portfolio/trading212-portfolio.controller.ts` — add order endpoints
- `nest/src/modules/portfolio/trading212-import.service.ts` — add order placement logic
- `src/pages/PortfolioPage.jsx` — add Sell button, Order Modal, confirmation flow
- `src/pages/PortfolioPage.css` — modal styles

### New Files
- `src/components/OrderModal.jsx` — reusable order placement modal (sell + buy)
- `src/components/OrderModal.css` — modal styles
- `src/core/api/orders.js` — order API client functions

## Discussion Points

1. **Market vs. Limit orders?** Market is simpler for the first trade but has slippage risk on illiquid stocks. For a sell of a liquid stock like AAPL/NVDA, market is fine. Add limit order support as Phase 2.
2. **Partial fills?** The Trading212 API may partially fill a market order. The UI should handle this — show filled quantity vs. requested.
3. **After-hours trading?** Trading212 may reject orders outside market hours. The UI should detect this and warn: "Market is closed. Order will be queued for next open."
4. **The specific stock**: The user has a specific stock in mind. The sell flow should be tested with a DRY RUN first (walk through the UI, stop before confirming) on that exact stock to ensure everything looks right.

---
## ⚠️ AGENT INSTRUCTION — NO DEMO DATA
When implementing this prompt:
- Do NOT create hardcoded demo/mock/seed data as the final output
- Do NOT use setInterval with random values to simulate real data
- Always fetch from real API endpoints
- If an API endpoint does not exist yet, CREATE A FOLLOW-UP PROMPT asking for the endpoint to be built
- If the database has no data, CREATE A FOLLOW-UP PROMPT to seed real data
- If a provider returns no data (e.g. Trading212 API returns empty positions), handle the empty state gracefully and note it in the UI
- Every page should work with ZERO data gracefully (empty states, not fake content)