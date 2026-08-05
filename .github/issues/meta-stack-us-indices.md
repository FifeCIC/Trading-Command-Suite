## Market Area: US Indices

**Symbols:** SPY, QQQ (potentially IWM, DIA)

SPY and QQQ are the most liquid equity indices globally. They have:
- Strong macro correlations (rates, VIX, USD)
- Clear technical patterns that match existing directives (RSI, MACD, EMA structure)
- Session-based behavior (US open volatility, afternoon drift)
- Well-defined support/resistance levels

### Needed
- **Protocol:** `us-indices-v1` — SPY + QQQ focused, macro overlay (VIX, rates), session timing
- **Scoring Strategy:** Gates on macro context + technical alignment
- **Trading Strategy:** MT5 ETF execution (SVIX/UVIX or direct SPY/QQQ if available)
