## From UI/UX Review (2026-07-11)

### Current State
`http://localhost:5173/watchlists/create-watchlist` is a standalone page. This is unnecessary.

### Required Changes
1. **Delete** the `/watchlists/create-watchlist` page and route
2. Add an **empty entry** in the left column of `/watchlists/user-watchlists` (now just `/watchlists`) labeled "Create New Watchlist"
3. Clicking it displays the creation form in the content area where watchlist content currently appears

### Acceptance Criteria
- [ ] `CreateWatchlistPage` route removed from App.jsx
- [ ] Nav tree entry removed
- [ ] "Create New Watchlist" placeholder entry in watchlists sidebar
- [ ] Clicking placeholder shows inline creation form in content area
- [ ] Creating a watchlist adds it to the list and selects it

### Related
- Reopened #217 (Theme & UX Standards)
