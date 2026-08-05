## Market Area: Ethereum (ETH)

**Symbols:** ETHUSD

Ethereum is the #2 cryptocurrency by market cap. BTC already has protocols (btc-speed-v1, btc-scalp-v1). ETH has:
- Distinct from BTC — more tech/DeFi driven, less "digital gold" narrative
- Higher beta to crypto market moves
- Strong correlation with BTC but with independent moves during DeFi events
- Gas fee / network activity fundamentals

### Needed
- **Protocol:** `eth-speed-v1` — ETH-specific, correlation-check with BTC, DeFi sentiment overlay
- **Scoring Strategy:** Gates on ETH/BTC ratio + network activity
- **Trading Strategy:** MT5 CFD execution (if available) or T212

### Note
Could be derived from btc-speed-v1 with ETH-specific parameter adjustments, or built standalone.
