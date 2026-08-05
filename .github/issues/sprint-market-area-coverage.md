## Source

Referenced in Strategy Ladders rebuild discussion (#557).

## Background

The Strategy Ladders view showed 8 market areas with wrong watchlist data. The user wants proper coverage for each area: protocol + scoring strategy + trading strategy.

## 8 Market Areas

1. **US Indices** — SPY, QQQ (and related)
2. **Forex Majors** — EURUSD, GBPUSD, USDJPY, etc.
3. **Forex Crosses** — EURGBP, EURCHF, etc.
4. **Commodities** — XAUUSD, XAGUSD, Oil
5. **Cryptocurrencies** — BTC, ETH
6. **European Equities** — EU stocks
7. **Asian Session** — Asia-Pacific pairs
8. **Emerging Markets** — USD/EM pairs

## Task

1. Audit existing protocol + scoring strategy + trading strategy coverage for each area
2. Create sub-issues for any uncovered area
3. Each sub-issue should cover: protocol creation, scoring strategy, and trading strategy for that area

Some areas may already be partially covered by existing protocols and strategies — don't duplicate.

## Related

- #557: Strategy Ladders Rebuild (parent discussion)
- Existing protocol issues: jpy-carry, cad-crosses, forex-european, metals, emerging-markets
