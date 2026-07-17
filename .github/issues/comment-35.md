## META.Stack Context Update (2026-07-17)

Related to issues #33 (Swap Calculator) and #34 (Weekend Gap Risk). Much of the infrastructure for this already exists.

### What Already Exists
- **Market Context Live Checklist** — already verifies swap charges, open positions, earnings against live data with pass/fail badges
- **Market Context multi-factor session strength** — sessions ranked with scoring/positions/timing/strength indicators
- **Automation Dashboard** (designed at /trading/automation) — has master pause/run-now/emergency-stop controls
- **Alert Center** — 8 alert types, severity levels, snooze/dismiss/acknowledge
- **Global Diversification System** — cross-broker exposure checks
- **Positions Monitor** — real risk calculation from price_open/price_current, Close Position button with audit trail
- **Decision log** (decision_log table) — every tick decision persisted to DB, suitable for audit trail of weekend actions

### Implementation Guidance
- The "Flatten" actions described here already exist in parts: Positions Monitor has Close Position, MT5 Bridge supports order closure
- The end-of-week checklist is best implemented as an **extension of the Market Context page** (which already does live checklist verification)
- The existing **Automation Timeline** system can handle "Snooze Until Monday" — the TimelineService already gates/boosts/reduces strategies based on events
- Weekend defense actions should be logged to the existing **decision_log** table for audit trail
- The Alert Center can handle pre-weekend notifications (alerts already have severity levels, snooze, dismiss)
- Consider this as enhancements to existing pages rather than a standalone "Weekend Defense" page
