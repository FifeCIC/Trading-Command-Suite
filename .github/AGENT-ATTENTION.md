# Agent Attention Board

Items needing human attention. Agents: read this at session start. Append confirmed blockers below.

---

## 2026-07-22

### MT5 bridge order placement — diagnosed + code-fixed (2026-08-16)
- **Root cause of "POST /order returns null":** (1) the NestJS adapter swallowed the bridge's real error and returned a generic "Bridge unreachable"; (2) the bridge `/order` path never called `symbol_select()`, so `order_send` could fail with "No prices" even when the market was open; (3) the margin check compared full-lot `margin_initial` against `margin_free` without scaling by `volume`.
- **Fixed:** all three. Bridge now selects the symbol + scales margin by volume; the adapter now surfaces the bridge's error (e.g. "No prices", "Insufficient margin").
- **Current state:** risk limits verified live (volume 5.0 → rejected "exceeds max position size 1.0"). A real order still returns `{"error":"No prices"}` because the market is CLOSED (weekend). Re-verify a live round-trip after Sunday ~21:00 UTC open.
- **Affected issues:** #446 (Phase 5 E2E test), #470 (UI Verification), #471 (E2E Trade Test) — live order verification pending market open.
- **Agent:** DeepSeek (2026-08-16)

### Portfolio P&L mismatch: MT5 positions excluded — RESOLVED (2026-08-16)
- **What was wrong:** `PortfolioService.getPortfolio(source)` ignored the `source` param and always fetched Trading212 only.
- **Fix:** `getPortfolio()` is now source-aware. It resolves adapters via `AdapterFactory` (`source=all` → trading212 + mt5), fetches positions + accounts in parallel, merges and tags each position with `broker`, sums cash across accounts, and reports provider `"Trading212 + MT5"` for `all`.
- **Verified:** `source=all` → 13 positions (9 T212 + 4 MT5), provider `"Trading212 + MT5"`, P&L −61.09; `source=mt5` → 4 positions P&L −4.65; `source=trading212` → 9 positions P&L −56.48.
- **Affected issues:** #446 (Phase 4: portfolio P&L matching) — aggregation side done; end-to-end P&L sign/currency reconciliation still pending market open.

### directiveoutcome table: 2.59M rows, exceeds 3-day retention
- **What:** DB retention critical. 2.59M rows, oldest data older than 3-day target.
- **Verified:** `GET /api/system/health-summary` → "🔴 DB retention critical: directiveoutcome"
- **Affected:** Data retention cron should gradually prune. Monitor over next 24h.
- **Agent:** DeepSeek (2026-07-22)
