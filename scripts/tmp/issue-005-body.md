## From UI/UX Review (2026-07-11)

### Current State
`http://localhost:5173/watchlists/user-watchlists` has misleading name and missing navigation.

### Required Changes
1. **Rename:** "User Watchlists" → "Watchlists" (it manages ALL watchlists, not just user-owned)
2. **Navigation:** Clicking a watchlist, then a ticker, should navigate to `http://localhost:5173/research/symbol/{symbol}` — NOT the architecture-framework view

### Acceptance Criteria
- [ ] Page renamed from "User Watchlists" to "Watchlists"
- [ ] Nav tree entry updated
- [ ] Clicking ticker in watchlist → `/research/symbol/{symbol}`
- [ ] `/research/symbol/` route exists or is created

### Related
- Reopened #217 (Theme & UX Standards)
