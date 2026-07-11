## From UI/UX Review (2026-07-11)

### Current State
`http://localhost:5173/watchlists/active-symbols` has several issues.

### Required Changes
1. **Name column** currently shows the ticker symbol — it should show the **company name**
2. **New column:** Indicate if we have an open trade across ALL accounts
3. **New column:** P/L made on each symbol
4. **New column:** How many protocols each ticker is attached to
5. **View-specific options:** Ability to hide/display the new columns
6. **Row selection:** Click rows to select them, then click "Create Watchlist" to create a watchlist from selected rows

### Acceptance Criteria
- [ ] Name column shows company name, not ticker
- [ ] "Open Trade" column with account-wide indicator
- [ ] "P/L" column
- [ ] "Protocols" column (count of attached protocols)
- [ ] Screen Options toggles for new columns
- [ ] Multi-select rows → Create Watchlist workflow

### Related
- Reopened #217 (Theme & UX Standards)
