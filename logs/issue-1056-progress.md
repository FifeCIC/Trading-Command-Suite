## The capability is now durable — the issue stays OPEN for the FRA40 answer

**Not closing this.** The issue asks which of the two FRA40 was — *evaluated and declined* or
*skipped* — and that still cannot be answered: **no FRA40 position has been open since the logging
went live.** What changed is that the answer no longer depends on someone watching at the right
moment.

### What landed

`guardedPositions[].outcome` (`1145a33`) made the reason visible **in the moment**. But the array is
rebuilt every tick and lives in memory, so **the reason died with the tick** — and FRA40 trades for a
few hours at a time. That was the remaining half of this issue's own ask: *"readable after the fact"*.

`logDeclines()` now writes to the canonical log when a position **enters** a decline, when the
**reason changes**, and when the decline **ends**.

⚠️ **Bounded by state change, not by ticks** — the part that matters. Roughly 9 positions at ~1 tick/min
logged unconditionally is thousands of lines a day, and this repo has already paid for that
(a 5.8 MB day against a 173–572 KB normal). `adjusted` ↔ `at-target` oscillation writes **nothing**:
neither is a decline, and actions are already durable in `stop_adjustment`.

### Observed live, 2026-10-06

```
19:26:53 [trading] [StopGuardianService] DECLINED AUDJPY broker=2 ticket=152731284796 side=BUY outcome=below-threshold consensus=0 sl=109.396 rec=109.396
19:27:24 [trading] [StopGuardianService] DECLINED US30   broker=3 ticket=93517113    side=BUY outcome=below-threshold consensus=0 sl=51388.7 rec=51388.7
19:27:54 [trading] [StopGuardianService] DECLINED US500  broker=3 ticket=93515793    side=BUY outcome=below-threshold consensus=0 sl=7596.5  rec=7596.5
```

**One line per transition, not per tick** ✓ — the three timestamps are 30s apart and each position
appears once.

### Canary, both directions, against the real file

| Direction | Action | Observed |
|---|---|---|
| 1 | neutralised the bounded-by-state rule (`if (nowDeclined && true)`) | `a repeated decline writes nothing more` **FAILS** — `Expected number of calls: 1, Received: 3` |
| 2 | removed the prune loop | **2 tests FAIL** — `Expected: 0, Received: 1`, the map is never cleared |
| — | restored | **9 passed**, and `stop-guardian` suite **49 passed**; SHA-256 identical (`21F0273…E553CA`) |

### How the FRA40 question is now answered — no investigation required

```powershell
Select-String -Path nest\logs\tcs-*.log -Pattern "DECLINED.*FRA40"
```

If the next FRA40 position is declined, the line names the reason. **If FRA40 never appears at all**,
that is the other answer — *skipped before a decision was reached* — and its absence is now
meaningful because every position that IS evaluated and declined writes a line.

### ⚠️ One thing this surfaced, and I am not claiming it as the cause

Measured 19:28 — **8 of 10 guarded positions sat at `consensus=0`** while `AMZN` and `US500` sat at
`55` and cleared the gate:

```
US30:0 AVGO:0 AMZN:55 US500:55 GBPCAD:0 EURCAD:0 NZDJPY:0 AUDJPY:0 EURJPY:0 USDCAD:0
```

`below-threshold` means the 4-directive consensus is under 55, which is a **legitimate** outcome.
Whether `0` for most symbols is normal or a signal is **not established**, and I am not calling it a
defect. What is true is that it is now measurable over time, which it was not before this change.

⚠️ The `#890` guard is NOT firing — `UNRESOLVED` appears nowhere in the log — so this is **not** the
unregistered-directive class.

### Also in this landing (unrelated, and it was blocking the build)

`INV-NO-NEW-DUPLICATION` failed `build:api` at **27 → 39** on `ProtocolTrailPage` /
`SinglesMonitorPage`: two agents had independently fixed the same owner request ("the page is
reachable only by URL — add a symbol search") by pasting a **byte-identical 12-line wrapper** into
each. Both files' own comments said *"Reused, not rebuilt"* — and then rebuilt the wrapper. Extracted
to `src/components/SymbolPickerField.jsx`; the pair is now **29**, and the allowance reason was
corrected to say so rather than left reading *"Not done"*.
