# Alpaca Free-Tier Limitations & Strategy Design

> Stop designing for data we don't have. Build for what's available.

---

## Alpaca Free Tier — What You Actually Get

### Paper Trading
- **Cost**: Free, unlimited
- **API access**: Full paper trading API
- **Data**: Same as live account data endpoints

### Market Data (Alpaca Data API v2)

| Data Type | Free Tier | Paid (SIP) |
|---|---|---|
| **Stocks — delayed** | ✅ 15-min delayed | Real-time |
| **Stocks — IEX** | ✅ Real-time (free) | Real-time |
| **Crypto** | ✅ Real-time | Real-time |
| **Historical bars** | ✅ Unlimited | Unlimited |
| **Options data** | ❌ Not available | Paid add-on |
| **News** | ❌ Not available | Paid add-on |

### Rate Limits
- **200 requests/minute** on free tier
- Higher on paid plans

### What Requires Paid Subscription
- Real-time SIP stock data (consolidated tape)
- Options chains and greeks
- News feeds
- Higher rate limits

---

## Realistic Free-Tier Strategy: "Conviction Accumulation"

### Design Principles
1. **Use delayed daily bars for stocks** — acceptable for swing/long-term positions
2. **Use real-time for crypto** if configured
3. **Limit to 3 symbols** active at once (respects rate limits)
4. **Score every 15 minutes** max, not every 30 seconds
5. **Disable tick-dependent directives** for stocks, enable for crypto

### Rate Limit Math
```
3 symbols × 60 checks/hour ÷ 4 (15-min intervals) = 180 req/hour
Well within 200 req/minute free tier limit
```

### Active Directives
| Directive | Stocks | Crypto | Reason |
|---|---|---|---|
| RSI Oversold | ✅ | ✅ | Works on daily bars |
| MACD Crossover | ✅ | ✅ | Works on daily bars |
| EMA Structure | ✅ | ✅ | Works on daily bars |
| ATR Dip | ✅ | ✅ | Works on daily bars |
| Volume Confirmation | ✅ | ✅ | Works on daily bars |
| ADX | ✅ | ✅ | Works on daily bars |
| Stochastic | ✅ | ✅ | Works on daily bars |
| Bollinger Bands | ✅ | ✅ | Works on daily bars |
| Price Above SMA | ✅ | ✅ | Works on daily bars |
| Support/Resistance | ✅ | ✅ | Works on daily bars |
| Volume Surge | ✅ | ✅ | Works on daily bars |
| VWAP | ⚠️ | ✅ | Stocks: delayed, less useful |
| VIX Regime | ⚠️ | ✅ | Needs VIX data feed |

### What We CAN'T Do Without Premium
1. ❌ **Real-time stock scoring** — need paid SIP data
2. ❌ **High-frequency strategies** — rate limits + delayed data
3. ❌ **Options strategies** — no options data
4. ❌ **1m/5m bar strategies** — would hit rate limits
5. ❌ **News sentiment** — not available

---

## Alpaca API Key Setup

### .env Configuration
```env
# Paper trading keys (free — sign up at alpaca.markets)
ALPACA_API_KEY=pk_your_paper_key
ALPACA_API_SECRET=your_paper_secret

# Data feed: 'iex' for free real-time, 'sip' for paid
ALPACA_DATA_FEED=iex

# Paper trading URL
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_URL=https://data.alpaca.markets
```

### Getting Keys
1. Sign up at [alpaca.markets](https://alpaca.markets)
2. Go to Paper Trading dashboard
3. Generate API keys
4. Add to `nest/.env`

---

## Recommended Default Strategy Configuration

```json
{
  "strategy": "free-tier-conviction-accumulation",
  "maxActiveSymbols": 3,
  "scoringIntervalMinutes": 15,
  "timeframes": ["1d"],
  "dataFeed": "iex",
  "directives": {
    "active": ["rsi-oversold", "macd-crossover", "ema-structure", "atr-dip", "volume-confirmation", "adx", "stochastic", "price-above-sma", "support-resistance-levels", "bollinger-bands", "volume-surge"],
    "disabledForStocks": ["vwap", "vix-regime"],
    "enabledForCrypto": ["vwap", "rsi-oversold", "macd-crossover", "adx", "volume-surge"]
  }
}
```
