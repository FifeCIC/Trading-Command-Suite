# Watchlist Pies — Percentage-Allocated Trading Baskets

**Status:** Design phase — needs discussion before implementation
**Created:** 2026-06-24

## Concept

Turn one or more watchlists into a "pie" — a percentage-allocated basket of symbols with:

1. **Percentage allocation** — each symbol gets a % of the total investment
2. **Scoring protocol** — assigned to the pie (not individual watchlists)
3. **Trading strategy** — how the pie trades as a unit
4. **Custom rules** — profit distribution based on allocation percentages

## How It Differs From Watchlists

| Feature | Watchlist | Pie |
|---------|-----------|-----|
| Purpose | Monitoring | Trading |
| Allocation | None | Percentage per symbol |
| Protocol | Many-to-many with watchlists | One per pie |
| Strategy | None | Trading strategy attached |
| Execution | Manual only | Automated per strategy rules |

## Design Questions to Resolve

1. **Pie storage** — new `Pie` Prisma model or extend existing `Watchlist`?
2. **Allocation rules** — minimum %, rebalancing frequency, drift tolerance
3. **Execution** — does the pie trade as market orders, limit orders, or protocol-gated?
4. **Profit distribution** — proportional to allocation, equal, or custom formula?
5. **UI** — new page or extend UserWatchlistsPage?

## Architecture Impact

- New `Pie` or `PieAllocation` model in Prisma
- New `/api/pies` endpoints
- New React page(s)
- Protocol → Watchlist relationship becomes Protocol → Pie
- Watchlists become data sources for pies

## References

- `UserWatchlistsPage.jsx` — protocol dropdown removed (2026-06-24)
- `PROTOCOL_REGISTRY` in `directive-groups.ts` — protocols exist
- Trading212 Pies API — may provide reference implementation
