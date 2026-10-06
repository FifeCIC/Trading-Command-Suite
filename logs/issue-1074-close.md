## Pre-Close Verification

> ⚠️ This issue has no `- [ ]` acceptance boxes (it was filed from a measurement, not a plan). Using
> the fallback checklist plus the gates its own body states — and stating the limitation below rather
> than leaving a hidden gap.

- [x] **Defect reproduced before the fix** — `POST :5001/order {"symbol":"EURUSD","type":"buy","volume":6.0}`
      → `500 {"error": "cannot access local variable 'refusal' where it is not associated with a value"}`
- [x] **Fix verified on the same request, same bridge** — `400 {"success": false, "error": "Volume 6.0 exceeds max position size 1.0", "code": "TCS-TRADE-016", "params": {"volume": 6.0, "maximum": 1.0}}`
- [x] **Services restarted** — `GET :5001/health` → `connected: true`, `reconnect.attempts: 0` (a fresh process, so the fixed module is loaded)
- [x] **Build / syntax passes** — `python -m py_compile` OK
- [x] **Guard added, and observed to fail** — `ShadowingTest`, canaried below
- [x] **Tests pass** — 19 tests, `OK`, exit 0

### The four gates

| # | Gate | Observed |
|---|---|---|
| 1 | Structural | `py_compile` OK; `symtable` before → `do_POST local=True assigned=True`, after → `local=False` |
| 2 | Contract | `python scripts/mt5-bridge/test_credential_binding.py` → **19 tests OK, exit 0** |
| 3 | State | bridge restarted and re-verified: `connected: true`, `account: 62148195`, `reconnect.attempts: 0` |
| 4 | Behaviour | the before/after pair above — **one identical request**, one variable changed |

### ⚠️ The restart is not a footnote — it is the finding

Before the bridge was restarted, the **same** request still returned the 500, because a Python bridge
only loads its module at process start. The source was fixed at the time of the canary and the running
system was still broken. That is why this regression sat from **2026-10-02 to 2026-10-06** with zero
log hits, and it is the reason gate 3 exists as a separate gate from gate 1.

### Guard canaried, both directions, against the REAL file

| Direction | Action | Observed |
|---|---|---|
| 1 | planted `refusal = account_mismatch_refusal(state, detail)` back | `FAIL: test_no_function_shadows_a_module_level_function_it_calls` · `[('do_POST', 'refusal')] != []` · *"do_POST() shadows refusal()"* · exit 1 |
| 2 | restored from backup | **19 tests, OK, exit 0** |
| — | restore integrity | SHA-256 identical to pre-canary: `37101C93B005CEA1A80D7C7A051FA3470E0F78023B5FAA756752F7C53A8D32FD` |

The guard is a **class** guard — it flags any function that locally assigns a name which is also a
module-level function it calls — so it covers the other eight call sites and any future one, not just
`refusal`. `test_the_checker_can_actually_fail` proves the checker itself on a good/bad snippet pair,
so it does not depend on the real file being broken to demonstrate it works.

⚠️ **`test_both_connect_routes_consult_the_refusal` was itself part of the problem.** It asserted the
exact string `"refusal = account_mismatch_refusal(state, detail)"` — i.e. it pinned the defect's
spelling and would have resisted the fix. Updated to `bind_refusal` with a note saying why.

### Why all nine call sites are restored, not just the one tested

`symtable` reports `do_POST` as `local=False assigned=False referenced=True` after the rename, so the
name resolves to the module-level function throughout the function body. The live test demonstrates the
mechanism on the size-cap guard (L1770); the other eight are the same expression in the same scope.

## Not done — stated, not buried

- **The post-send rejection path (L1864) was not exercised live.** It needs a real broker rejection;
  I did not manufacture one. What is verified is that the name resolves correctly, which is the exact
  failure mode — the call previously raised before it could run.
- **The guard covers `mt5_bridge_v2.py` only.** `scripts/mt5-bridge/archived/mt5_bridge.py` and
  `mt5_bridge.py.bak` are not scanned (both are archived copies, not executed).
- **The 6 `ORDER REJECTED` entries logged today are historical.** No new one can be attributed to this
  path until an order is refused again — so absence of new errors is not evidence on its own; the
  before/after pair above is.

## Related

- Introduced by `8dc3dad` (#1035, 2026-10-02)
- Disabled the notice-code system from `a042f6c` (#826, 2026-09-15)
- **#834** (pre-flight refusals leave no trace) — this defect is a large part of why they left no trace
