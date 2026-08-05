## Source

`/automation/automation-overview`

## Problem

### 1. Health counter mismatch
The providers card says "2/10 healthy" but lists 6 providers (BINANCE, TRADING212, MT5, YAHOO, POLYGON...). It might mean "2 healthy brokers" specifically but the labeling is unclear.

### 2. Broker card naming
The card says "Broker: MT5" — it should just say "MT5" and be an MT5-focused card rather than a generic "Broker" card.

## Expected

### Health counter
- Fix the "X/Y healthy" count to accurately reflect what's being counted (all providers? just brokers?)
- Make the labeling clear

### MT5 card
- Rename "Broker: MT5" → "MT5"
- Make the card MT5-specific rather than generic broker

## ⚠️ Be careful
The chain cards on this page are nicely designed (split into 3 sections). Be conservative with changes.

## Elements

Providers card:
```html
<div class="ao-service-card">
  Providers  2/10 healthy  BINANCE, TRADING212, MT5, YAHOO, POLYGON...
</div>
```

Broker card:
```html
<div class="ao-service-card">
  Broker: MT5  Enabled · Trading  Score every 300s
</div>
```

Chain card (nice — preserve design):
```html
<div class="ao-chain-card">
  Gold Day-Trade M15  In Loop  TS: 9b2a1e22  XAUUSD · 15m  semi-auto  ├─...
</div>
```
