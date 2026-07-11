## From UI/UX Review (2026-07-11)

### Current State
`http://localhost:5173/lab/mt5-trading` has two problems:

**a) When MT5 is offline:** Shows "MT5 Bridge offline — start mt5_bridge.py from Server Controls" but ALSO shows everything else (positions table, etc.). There's no point — the entire view should just show a clean status message centered on screen.

**b) Unnecessary polling:** The page appears to refresh approximately every 10 seconds as if checking for MT5 or refreshing positions. When MT5 is offline, this polling should NOT be happening.

### Required Changes
1. When MT5 is offline: hide all data panels, show only a centered status message with clear instructions
2. Disable all refresh/polling when MT5 bridge status is offline
3. Restore full view + resume polling when bridge comes back online

### Acceptance Criteria
- [ ] Offline state: centered status message only, no data panels
- [ ] No polling/refreshing while offline
- [ ] Clean transition when bridge comes online
- [ ] Clean transition when bridge goes offline

### Related
- Reopened #217 (Theme & UX Standards)
