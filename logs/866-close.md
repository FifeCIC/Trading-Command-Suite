## Pre-close checklist — #866

**Root cause (confirmed):** the bridge was a plain single-threaded `HTTPServer` — ONE blocked handler took the accept loop with it, permanently. Measured 2026-09-17: broker 3 wedged inside POST /order AFTER its `order_placed` journal write; socket bound, CPU frozen, `/health` dead, nothing recovered it — and the order it had actually placed was reported to the app as **failed**. Two more defects were found and fixed during the canary (below), both of which made the first fix incomplete.

### The five accepted criteria — evidence per item

| # | Criterion | Observed evidence |
|---|---|---|
| 1 | One hung request cannot wedge the bridge permanently | Canary (port 5002, test hook): POST `/__test_hang?seconds=120` → while hung, `GET /health` answered `200 {"connectionState":"busy","busySeconds":4.97}` → wedge monitor fired `WEDGE: request /__test_hang?seconds=120 in thread 17632 has run 23s (limit 15s) — dumping stacks and exit` → process exit 75. **~23s from hang to bounded death, vs. forever before.** |
| 2 | A `/health` failure is auto-recovered | Supervisor: `bridge died: code 75 (WEDGE EXIT), ran 30s — restarting in 5s (restart 1/6 in window)` → fresh bridge healthy. **LIVE canary:** killed the 5001 bridge process mid-stack (pid 4080, 22:31:24) → `restarting in 5s` → new pid listening and `connected:true` within 12s. |
| 3 | A timeout is surfaced as UNKNOWN, never as a plain failure | Backend: `signal-actions.service.ts` now forwards `status` (it dropped it — the adapter's `'UNKNOWN'` never reached the client); `speed-scan.controller.ts` no longer collapses `UNKNOWN → FAILED`. Frontend: registry code **TCS-TRADE-022** ("Order outcome UNKNOWN — it may have been placed", action: *check positions BEFORE retrying*), rendered by `tradeFailureNotice()` for both `'UNKNOWN'` and `'unknown'`; Speed Scanner shows an amber `ss-trade-unknown` row. 2 new pinned tests + canary (mutated branch: 2 failed; restored: 19/19). |
| 4 | The breaker trips on sustained network/refused failures | `mt5.adapter.ts`: the `refused/dns/network` exemption is removed — every failure counts; reset-on-success remains the transience handler. New spec `counts connect-refused failures toward the trip threshold (#866)`: 8/8 in the isolation suite; canary (increment disabled): 1 failed; restored: hash-match. Live log during the test run: `circuit breaker TRIPPED for broker 2 (10 errors): refused: connect ECONNREFUSED 127.0.0.1:5000`. Full providers suite: 20 suites / **155 passed**. |
| 5 | Canary: kill mid-request → recovery + no false "not placed" | Canary 1 (5002, hook) + Canary 2 (live kill of 5001). The false-"not placed" path is now the TCS-TRADE-022 notice on every surface that renders the manual/speed trade result. |

### ⚠️ Two additional defects FOUND BY THE CANARY (both fixed in this change)

1. **`/health` was invisible to the wedge monitor.** Only non-health paths registered in `_INFLIGHT`, so a bridge with no terminal attached — `ensure_mt5()` / `mt5.terminal_info()` block natively — hung INSIDE `/health` with the monitor blind to it: socket bound, no CPU, dead forever. That is the original wedge reached through the one route every caller uses. `/health` now registers in the same in-flight registry and is bounded by the same exit (75).
2. **`self.path` does not exist before the request line is parsed.** The first version of the override read `self.path` at entry → `AttributeError` on the FIRST request of every connection → every request accepted, then closed with zero bytes. Caught live on 5002 (empty replies that read exactly like a wedge). `parse_request()` now classifies the request once, and the base handle body is inlined so the request line is parsed exactly once (calling `super().handle_one_request()` would parse twice and eat a POST body).

### Files changed

- `scripts/mt5-bridge/mt5_bridge_v2.py` — ThreadingHTTPServer + ONE `_MT5_HTTP_LOCK` around non-health requests; `/health` 2s lock fast-path returning honest `busy`; `_INFLIGHT` registry + `http_wedge_monitor` (exit 75) — health included; `parse_request()` classification; `/__test_hang` canary hook (gated behind `MT5_BRIDGE_TEST_HOOKS=1`); `faulthandler` stack dump on wedge.
- `scripts/mt5-bridge/bridge_supervisor.py` — NEW. Owns one bridge: relaunch with 5s backoff, 6-in-120s crash-loop guard, clean-exit-if-long-run, `supervisor-<port>.stop` sentinel checked before every (re)launch and on child exit.
- `scripts/tcs-launch.ps1` — starts supervisors (not bridges); clears stale sentinels; zombie-kill matches both scripts; port-ownership check accepts the supervisor's CHILD as ours (was a false positive after the supervisor landed).
- `scripts/tcs-stop.ps1` — writes the stop sentinels BEFORE any kill; defines `$ROOT`.
- `nest/src/modules/providers/adapters/mt5.adapter.ts` — no transient exemption; every failure counts (MAX_ERRORS unchanged at 10).
- `nest/src/modules/providers/adapters/mt5-adapter-breaker-isolation.spec.ts` — the #866 pinning test.
- `nest/src/modules/signals/signal-actions.service.ts` — forward `status`.
- `nest/src/modules/scoring/speed-scan.controller.ts` — preserve `UNKNOWN` + forward `code`.
- `src/pages/SpeedScannerPage.jsx` + `src/pages/speed-scanner.css` — unknown-outcome row (`ss-trade-unknown`).
- `src/core/notices/registry.js` + `trade-result.js` + `notices.test.js` — TCS-TRADE-022 + branch + canary-proven tests; `docs/NOTICE-CODES.md` regenerated.

### Two surfaces deliberately NOT changed

- **Trading 212 orders** (`OrderModal` → `/api/portfolio/trading212/*`) — no producer of an unknown-status outcome exists on that path; no speculative change made.
- **Bot/automation order path** — it consumes the same adapter and inherits the breaker fix; its own rendering of UNKNOWN was out of this issue's scope.

*Deviations: none from the accepted criteria; two fixes were additions the canary forced (above), not scope changes.*
