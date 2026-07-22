# Agent Attention Board

Items needing human attention. Agents: read this at session start. Append confirmed blockers below.

---

## 2026-07-22

### MT5 bridge: read works, order placement broken
- **What:** `POST /order` to bridge (port 5000) returns null. Positions (GET /positions) work fine.
- **Verified:** `curl http://localhost:5000/` → responds. `curl http://localhost:5000/positions` → returns 5 positions with tickets. `POST /order` via NestJS → bridgePost returns null.
- **Affected issues:** #446 (Phase 5 E2E test), #470 (UI Verification), #471 (E2E Trade Test)
- **Agent:** DeepSeek (2026-07-22)

### Portfolio P&L mismatch: MT5 positions excluded
- **What:** `/api/portfolio?source=all` returns only Trading212 positions (9, P&L -$94.91). MT5 positions (5, P&L -$24.88) are visible via bridge but not included in portfolio aggregation.
- **Verified:** Compared `GET /api/portfolio?source=all` vs `GET http://localhost:5000/positions`. Different position counts and P&L.
- **Affected issues:** #446 (Phase 4: portfolio P&L matching)

### directiveoutcome table: 2.59M rows, exceeds 3-day retention
- **What:** DB retention critical. 2.59M rows, oldest data older than 3-day target.
- **Verified:** `GET /api/system/health-summary` → "🔴 DB retention critical: directiveoutcome"
- **Affected:** Data retention cron should gradually prune. Monitor over next 24h.
- **Agent:** DeepSeek (2026-07-22)
