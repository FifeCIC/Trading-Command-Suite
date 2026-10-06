## Pre-Close Verification

> ⚠️ This issue has no `- [ ]` acceptance boxes. Using the fallback checklist, plus the two things
> this issue actually needed: **the guard must be able to fail**, and **both drivers must still exist**
> (or "the collision stopped" would just mean a caller was deleted).

- [x] **Code is live** — single-flight guard present in `bar-refresh.service.ts:415` **and** in the built `dist` (`dist/src/modules/market-data/bar-refresh.service.js:162`), which is what the running API loads
- [x] **Both drivers still exist** — `automation-loop.service.ts:695` (per-tick) and `bar-refresh.service.ts:195` (the 5-minute interval). The fix is the guard, not a removed caller. **This is the step that makes the change attributable.**
- [x] **The guard can fail** — canaried below; without it the spec reports `Expected number of calls: 6`
- [x] **Tests pass** — `npm --prefix nest run test -- bar-refresh-single-flight` → **3 passed**
- [x] **Registered** — `docs/SETTLED-DECISIONS.md` row 65, with a `DECISION` marker at the code site naming its own `REVERSE BY` ("delete the guard; `refresh()` reverts to starting a cycle unconditionally")

### The canary — both directions, against the real file

This is the piece that was missing. The guard had never been observed to fail, which makes it a
decoration; and a green spec does not distinguish "the guard works" from "the guard never runs".

| Direction | Action | Observed |
|---|---|---|
| 1 | neutralised the guard: `if (this.refreshInFlight)` → `if (false && this.refreshInFlight)` | **`1 failed, 2 passed`** — `Expected number of calls: 6` — the second cycle ran and duplicated every fetch. That is the #1067 symptom, reproduced by the test |
| 2 | restored | **`3 passed, 3 total`** |
| — | restore integrity | SHA-256 identical (`6B1AE3CC…1902B`); `git diff --stat` on the file is **empty** |

The concurrency assertion is the right one: it holds the first cycle open and starts the second
*inside* it. Asserting "two sequential calls run two cycles" would pass against the broken code too.

### Gates

| # | Gate | Observed |
|---|---|---|
| 1 | Structural | `tsc` build clean; guard present in source and `dist` |
| 2 | Contract | `bar-refresh-single-flight.spec.ts` → 3 passed |
| 3 | State | the loaded build contains the guard — `dist/src/modules/market-data/bar-refresh.service.js:162` |
| 4 | Behaviour | **see the limitation below** |

## ⚠️ What I did NOT establish — said plainly

**The live collision was not reproduced and then fixed in front of me.** The 2026-10-02 evidence is
real (`61857` vs `60257` bars, one second apart, same pid), but a `console-api.log` window *before* the
fix was deployed already showed one summary per 5 minutes — so **the overlap is intermittent and a
quiet window is not evidence on its own.**

What is established instead, and is stronger for this particular defect: the guard makes a second
concurrent cycle **impossible** rather than unlikely, both callers are still wired, and the test that
pins it provably fails the moment the guard is removed.

The honest summary: *the mechanism is verified; the live symptom was not observed to stop, because it
was not observed to be happening in the sampled window.*

## Related

- **#1070** — bar retention declared at 60 days but not applied (separate defect, same subsystem)
- Row 65 of `docs/SETTLED-DECISIONS.md` carries the decision and its guard status
