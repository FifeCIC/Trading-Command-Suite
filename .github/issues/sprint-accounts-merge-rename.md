## Source

`/trading/accounts-dashboard` and `/trading212/*`

## Problem

Accounts Dashboard and Trading212 area are separate. They should be unified under "Accounts."

## Expected

### Merge
Merge Accounts Dashboard content into the Trading212 area. Delete the standalone Accounts Dashboard page.

### Rename
Rename "Trading212" → **Accounts** throughout the app (nav, routes, breadcrumbs).

### Tabbed account cycling
Each view within Accounts should allow cycling through:

**Portfolio tabs** (like current Accounts Dashboard):
- Tabs for each portfolio/source

**Broker tabs** (like current Accounts Dashboard):
- Tabs for each broker that has CFD trading available
- CFD is not finished yet, but add placeholder details to the view file for future wiring

### Deleted
Remove standalone `/trading/accounts-dashboard` page, route, and nav entry.
