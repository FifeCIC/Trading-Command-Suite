# Trading Constraints — Minimum Trade Sizes & Fee Structures

**Status:** active
**Category:** C — reference / contract
**Created:** 2026-06-14
**Last updated:** 2026-06-14
**Owner:** TCS team


## Trading212 - ⚠️ development DISCONTINUED 2026-08-27 (#696)
> Kept as a **view-only portfolio source**: no order placement, no bot access. The minimums and fee
> notes below still apply to the read-only import path.

- **CFD Minimums**: Vary by instrument. EURUSD: 0.01 lots (~€1,000 notional). Stocks: 1 share minimum.
- **Fractional Shares**: Not supported. Whole shares only.
- **Fees**: No commission on CFD trades. Spread built into bid/ask. Overnight swap fees apply.
- **Demo Account**: Supported — free testing with virtual funds.
- **API**: `https://live.trading212.com/api/v0` — requires API key (Trading212 settings → API).

## MT5 (MetaTrader 5)
- **Forex**: 0.01 lots minimum (micro lot). $1 ≈ 0.001 lots on most pairs at 1:100 leverage.
- **Stocks**: 1 share minimum. Some brokers allow fractional.
- **Crypto**: Depends on broker — typically 0.01 lots.
- **Fees**: Spread-based (no separate commission on most standard accounts). Swap fees for overnight.
- **Bridge**: Python bridge on localhost:5000 — requires MT5 desktop running.

## Alpaca
- **Stocks**: 1 share minimum (no fractional on paper account).
- **Crypto**: Fractional coins supported (e.g., 0.001 BTC).
- **Fees**: Commission-free for stocks. Crypto: 0.15%-0.25% spread.
- **Paper Trading**: Full simulation — good for testing.

## Realistic $1 Trading
- **Viable instruments**: Crypto (fractional BTC/ETH), micro forex lots (with high leverage), demo accounts.
- **NOT viable**: Most stock CFDs (1 share min), real forex without leverage.
- **"No fee"**: Only realistic via spread-only brokers (Trading212, MT5 standard accounts) or demo.
- **Demo mode**: The safest path for rapid $1-style trading practice.

## Recommendation
- Use **Trading212 demo** or **MT5 demo account** for $1-style rapid trading.
- Implement the Quick Trade UI with real-time scoring + demo execution.
- When user connects live broker, minimum sizes are enforced.
