## Phase 5 — the invisible class is now closed: **12 → 9**

I took the speed-scanner path first precisely because the ratchet **cannot see it** (`scanError` is a
string handed to three pages, so no `.message` extraction to count). Fixing the thing the metric
misses matters more than lowering the metric.

### Fix the SOURCE when a failure has many renderers

`useSpeedCockpit` returns `scanError`, rendered by **three** pages:

```
BtcSpeedTradingPage    Scanner offline — {scanError}
GoldSpeedTradingPage   ⚠ {scanError}
SpeedTradingPage       Scanner offline — {scanError}
```

The pages cannot see what produced the string, so converting them individually would have been three
guesses. One change at the hook fixes all three:

```
[TCS-SYS-007] Action failed: The request to connect to the speed scanner failed.
```

Same treatment for `useFxRate` (**no consumers found** — migrated anyway so whoever wires it up gets a
code) and `OrderTestingPage`'s per-endpoint error field.

### ⚠️ `npm run build` does not catch an undefined identifier — lint does

My first version of the Order Testing change used `ep?.id` inside a function where the variable is
`key`. **Vite built it without complaint.** It would have thrown `ReferenceError: ep is not defined`
the first time an endpoint test failed — in the one page whose entire purpose is running failure tests.

`eslint` (`no-undef`) caught it. I only ran lint because it is part of my routine for changed files —
that is the concrete argument for the four-gate contract: **a green build is a structural gate, not a
correctness gate.** Fixed to `key`.

### Verification

| Check | Result |
|---|---|
| gate | ✅ `UI: 9 raw error render(s) left in 4 file(s)`, 34 codes |
| `npm run build` | ✅ exit **0** — re-verified directly, because a pipeline had made it read `−1` |
| eslint | ✅ `no-undef` clean after the fix |
| `npm run test:notices` | ✅ 10/10 |

### Left (9 in 4 files)

| Count | File | Status |
|---|---|---|
| 5 | `Mt5TradingPage` | ⚠️ raw `fetch`, not the API client — needs its own pass (trade path) |
| 2 | `theme/registry.js` | Noted — error boundary, no user-facing message |
| 1 | `ProtocolsPageB` | Noted — the API's validation-issue **data** (Phase 4, API-side) |
| 1 | `SignalsOverviewPage` | Part of a fallback chain; another agent has the file open |

Every remaining render is now the shape the counter measures — the string-passed-as-a-child class is
empty in these pages, though a new one would still be invisible. **Success/confirmation prose remains
untouched (20 files), so both Phase 5 boxes stay unticked.**
