## What is wrong

`do_POST` in `scripts/mt5-bridge/mt5_bridge_v2.py` assigns a local named `refusal`:

```python
refusal = account_mismatch_refusal(state, detail)   # /reconnect
refusal = account_mismatch_refusal('ok', None)      # /switch/<num>
```

`refusal` is also a **module-level function** (L403) that `do_POST` **calls 9 times** to build the
`NOTICE_*` refusal bodies added by #826:

| Line | Call | Guard it belongs to |
|---|---|---|
| L1770 | `refusal(NOTICE_SIZE_CAP, ...)` | max position size |
| L1777 | `refusal(NOTICE_POSITION_CAP, ...)` | max open positions |
| L1796 | `refusal(NOTICE_NO_QUOTE, ...)` | no quote |
| L1804 | `refusal(NOTICE_NOT_TRADEABLE, ...)` | symbol not tradeable |
| L1809 | `refusal(NOTICE_VOLUME_MIN, ...)` | below broker minimum |
| L1813 | `refusal(NOTICE_VOLUME_MAX, ...)` | above broker maximum |
| L1819 | `refusal(NOTICE_SPREAD, ...)` | spread too wide |
| L1830 | `refusal(NOTICE_MARGIN, ...)` | insufficient margin |
| L1864 | `refusal(code, error, ...)` | **the order-rejected path** |

Python scopes a name to the **whole function** once it is assigned anywhere in it. So each of those
nine calls raised `UnboundLocalError` instead of returning a structured refusal.

## Measured 2026-10-06

Live log (`nest/logs/tcs-2026-10-06.log`), 10 occurrences:

```
ORDER REJECTED US500 BUY ×0.1 — cannot access local variable 'refusal' where it ...
ORDER REJECTED US30  BUY ×0.1 — cannot access local variable 'refusal' where it ...
```

Reproduced on demand — `POST :5001/order` with `volume: 6.0` (cap is 1.0 by env, 5.0 by default):

```
STATUS: 500
{"error": "cannot access local variable 'refusal' where it is not associated with a value"}
```

A size-cap refusal should be `400` with `{"code": "NOTICE_SIZE_CAP", "params": {...}}`.

## Proof of the scoping — not asserted, machine-read

`symtable` on the real file, before the fix:

```
functions whose body assigns `refusal`:
  unavailable_response         local=False assigned=False referenced=True
  order_send_checked           local=False assigned=False referenced=True
  do_POST                      local=True  assigned=True  referenced=True   <-- shadows + uses
```

## Regression origin, with dates

| Line | Landed | Commit |
|---|---|---|
| L1770 (`refusal(NOTICE_SIZE_CAP,...)`) | 2026-09-15 | `a042f6c` — #826, "bridge failures carry notice codes end to end" |
| L2151 (`refusal = account_mismatch_refusal(...)`) | **2026-10-02** | `8dc3dad` — **#1035** |

So the #1035 fix silently disabled the #826 notice-code system for the whole order path.

## ⚠️ It sat LATENT for four days

Hits per day: `10-02` **0** · `10-03` **0** · `10-04` **0** · `10-05` **0** · `10-06` **10**.

The regression was in the source from 10-02, but a Python bridge only loads its module at process
start — nothing restarted the bridges until today. **A source fix that has not been reloaded is not
a fix**, and nothing detects the gap.

## Impact — why this is more than a bad message

- The **order-rejected path (L1864)** returns `code`, `params` and the external broker code. With the
  call dead, a broker rejection reaches the API as a 500 carrying a Python internal, so
  `rejection_code()` / `rejection_params()` never run — the diagnostics #826 built are gone.
- The seven pre-flight guards **did not guard**: each aborted the order by raising rather than by
  refusing, so the outcome (no order) was accidentally safe but the reason was destroyed. Nothing
  distinguishes "spread too wide" from "the bridge is broken".
- Related: **#834** (pre-flight refusals leave no trace) — this is a large part of why.

## Fix

Rename the two locals to `bind_refusal`, with a comment at the code site naming the trap.
`scripts/mt5-bridge/mt5_bridge_v2.py`.

## Guard — class, not instance

`ShadowingTest` in `test_credential_binding.py`: for every function in the bridge, flag any name that
is **locally assigned** AND **referenced** where that name is a **module-level function**. Catches the
shape, whatever it is called.

⚠️ The existing `test_both_connect_routes_consult_the_refusal` asserted the exact string
`"refusal = account_mismatch_refusal(state, detail)"` — i.e. **the test was pinning the defect's
spelling.** Updated to the new name.

### Canary, both directions, against the real file

| Direction | Action | Observed |
|---|---|---|
| 1 | planted the shadowing assignment back | `FAIL: test_no_function_shadows_...` — `[('do_POST', 'refusal')] != []` · *"do_POST() shadows refusal()"* · exit 1 |
| 2 | restored | 19 tests, `OK`, exit 0 |
| — | restore integrity | SHA-256 identical to pre-canary: `37101C93…D32FD` |

The guard also carries its own two-direction canary (`test_the_checker_can_actually_fail`) on good/bad
snippets, so it is not dependent on the real file staying broken to prove it works.

## Gates

1. Structural — `py_compile` OK; `symtable` now reports `do_POST local=False`
2. Contract — `python scripts/mt5-bridge/test_credential_binding.py` → 19 tests OK, exit 0
3. State — bridge restarted so the running process holds the fixed module, then the same
   `POST :5001/order {volume: 6.0}` re-run (see closing comment)
4. Behaviour — before/after on one identical request
