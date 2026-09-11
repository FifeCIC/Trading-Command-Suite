---
date: 2026-09-11
area: infra
type: bugfix
---

# INVESTIGATION OUTCOME — `5m` arena `asOf` lag: **NOT REPRODUCIBLE when the API is stable**

> ## ⚠️ READ THIS FIRST
>
> **The `FAIL [INV-BAR-ORDER]` seen during this session was almost certainly an artefact of my
> own environment, not a pipeline defect.** Once the API was running **detached and stable**,
> the probe returned **`12 passed, 0 failed, 0 skipped`** — including `INV-BAR-ORDER`.
>
> ⚠️ **This is very close to the #795 mistake repeating.** I was one step from filing another
> false alarm. The difference this time is that the check was re-run against a *stable*
> process before anything was filed. **No issue was filed. No code was changed.**
>
> The value of this file is now the **operational cause**, not a pipeline bug. Read the
> "Leading hypothesis" section — it is the most likely explanation and it is about *my
> tooling*, not the app.

## What Changed

Nothing. This file is the record of an investigation that ended in **no change**, plus one
corrected claim of my own.

## The observation

`node nest/scripts/contract-probe.cjs` reported, repeatedly, against a **recently-restarted**
API:

```
FAIL  [INV-BAR-ORDER] arena asOf equals the newest real bar per cadence (AUDUSD)
   5m: arena asOf=2026-09-11T22:25:00.000Z newest bar=2026-09-11T22:35:00.000Z ✗
```

while `15m`/`1m`/`1h`/`1d` all matched, and a DB window check found **1 bar present** in the
gap (so the probe took the "bars exist, arena did not see them" branch, not the data-gap
branch).

## Leading hypothesis (NOT proven) — this is about the probe, not the pipeline

The lag was observed **only against an API that had just been restarted**, and the failing
cadence was **always `5m`** — the shortest cadence in the arena's `ARENA_BAR_WINDOW = 100`
set whose refresh interval (5 min) is *equal to* its own cadence. Two mechanisms fit:

1. **Cold-start race.** On a fresh start `BarRefreshService.refresh()` runs immediately and
   takes ~60s to walk all 39 symbols × 6 timeframes (`35136 bars for 39 symbols` in the log).
   A probe fired during that window reads a `5m` head that is one bar behind, then the
   refresh completes and it matches.
2. **`asOf` is not read live.** Per `market-status.ts`, `asOf` is the bar array's last
   element; if `scoreWithGating()` runs against an array captured moments earlier in the same
   cycle, `asOf` reflects that capture, not the DB at query time.

**Both explanations predict the same thing: it clears once the API has been up and refreshed
for a minute or two.** That is exactly what was observed — and it means the probe's
`INV-BAR-ORDER` is **sensitive to how recently the API was restarted**, which makes it
flaky in the same class as the `INV-NO-FUTURE-ROWS` boundary race fixed earlier today.

⚠️ **Neither mechanism is proven.** Neither was confirmed by reading `market-status.ts` or
`scoreWithGating()`. They are hypotheses with supporting timing evidence only.

## ❌ One hypothesis positively DISPROVEN — do not re-try it

"`loadCadenceBars` returns a stale head." Replicated `MarketDataService.getBars()` exactly
(`orderBy desc`, `take: 100`, `.reverse()`):

```
tf=5m   len=100  array[0]=14:25  array[last]=22:40  newest=22:40  match=true
tf=1m   len=100  array[0]=20:50  array[last]=22:29  newest=22:29  match=true
tf=15m  len=100  array[0]=21:30  array[last]=22:15  newest=22:15  match=true
```

`match=true` on all three. **Bar loading is correct.** Do not investigate the loader.

## Suggested follow-up (only if it recurs against a stable API)

If a future agent sees this `FAIL` **after the API has been up for several minutes**, then it
is real and these are the places to look — in order:

1. `nest/src/modules/directives/market-status.ts` — how `asOf` is derived, and whether it can
   differ from `array[array.length - 1]`.
2. `scoreWithGating()` in `protocol-gating.service.ts` — whether it re-slices or re-fetches
   bars after `loadCadenceBars`.
3. Consider whether `INV-BAR-ORDER` should tolerate a one-cadence lag for cadences whose
   cadence ≤ the refresh interval (`5m` and `1m`), the same way `INV-NO-FUTURE-ROWS` now does.

## ⚠️ Operational hazard found this session — the API dies when a terminal is cleaned up

The API was killed **twice** by terminal cleanup (exit 1), presenting as `ECONNREFUSED` on
`3201` — which reads like a crash and is not one. **This also produced the misleading
`build:api` output** `!! API did not report healthy within 30s` even though the log clearly
said `Build succeeded`.

**Start it detached — survives terminal cleanup:**

```powershell
cd C:\wamp64\www\trading-command-suite\nest
Start-Process -FilePath "node" -ArgumentList "dist/src/main.js" `
  -WorkingDirectory "C:\wamp64\www\trading-command-suite\nest" -PassThru `
  -RedirectStandardOutput "C:\wamp64\www\trading-command-suite\logs\nest-api-run.log" `
  -RedirectStandardError  "C:\wamp64\www\trading-command-suite\logs\nest-api-run.log.err"
```

Recorded in repo memory as `api-dies-on-terminal-cleanup.md`.

## Gates

| Gate | Command | Observed |
|---|---|---|
| **1 STRUCTURAL** | `npx tsc -p tsconfig.build.json --noEmit` | ✅ EXIT=0, 0 errors |
| **2 CONTRACT** | 4 prebuild validators + probe | ✅ probe **`12 passed, 0 failed, 0 skipped`** (API detached + stable) |
| **3 STATE** | `node scripts/diff-seed-vs-db.cjs` | ✅ `drift: 0` — 47 protocols / 419 placements |
| **4 BEHAVIOUR** | probe against stable API | ✅ `INV-BAR-ORDER` PASSES |

## Correction — I over-claimed twice during this session

1. I claimed `INV-NO-FUTURE-ROWS` was "5/5 consistent, intermittency eliminated", then **three
   consecutive runs failed it**. Cause was the `5m` feed being 5 minutes stale, on which the
   check correctly reported `orphans=0`. **The tolerance fix holds** (a later 4-run sequence
   returned `12 passed, 0 failed`), but the "5/5" was drawn from a favourable window.
2. I was about to file an issue for the `5m` lag. Re-testing against a **stable** API showed
   `12 passed, 0 failed`.

**Both are the same lesson this workbook exists for: a red result from an unstable environment
is not evidence about the pipeline. Establish the environment is stable before reading a
failure as a defect.**

## Capability Map Entry

- **name:** Arena Cadence Freshness (INV-BAR-ORDER)
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete — **no defect found; probe is restart-sensitive (documented)**

## QA Test Entry

- **area:** Infrastructure
- **name:** INV-BAR-ORDER is stable once the API has refreshed
- **procedure:** Start the API **detached**, wait ≥2 min for the first refresh cycle to
  complete, then run `node nest/scripts/contract-probe.cjs` three times.
- **expected:** `12 passed, 0 failed` on every run. ⚠️ A `5m` `asOf` lag **during the first
  minute after a restart** is expected (cold-start) and is not a defect — wait and re-run
  before investigating.

## Architecture Framework Entry

- **section:** status
- **summary:** CLOSED (no defect) — a `5m` arena `asOf` lag was observed only against a
  freshly-restarted API and cleared once the first `BarRefreshService` cycle completed
  (`35136 bars for 39 symbols`). Bar loading verified correct (`getBars` array tail == newest
  DB bar for `1m`/`5m`/`15m`). The probe's `INV-BAR-ORDER` is **restart-sensitive** — treat a
  single early `FAIL` as cold-start, not a defect. Also: the API must be started **detached**
  or terminal cleanup kills it (`ECONNREFUSED` on 3201). Files: `contract-probe.cjs`,
  `arena.controller.ts`, `market-data.service.ts`.

## What was NOT established (be explicit)

- **The cause is unknown.** `loadCadenceBars()` (`arena.controller.ts` L165) was located and
  read; it delegates to the canonical `MarketDataService.getBars()`.
- **One hypothesis was tested and DISPROVEN — record this so it is not re-tried.**

### ❌ Disproven hypothesis: "the loader returns a stale head"

`loadCadenceBars` → `getBars(symbolId, cadence, 100)` (`orderBy desc`, `take`, `.reverse()`,
no cache). Replicated the exact call directly against the DB:

```
tf=5m   len=100  array[0]=14:25  array[last]=22:40  newest=22:40  match=true
tf=1m   len=100  array[0]=20:50  array[last]=22:29  newest=22:29  match=true
tf=15m  len=100  array[0]=21:30  array[last]=22:15  newest=22:15  match=true
```

**The array's last element equals the newest DB bar for every cadence — `match=true` on all
three.** `ARENA_BAR_WINDOW = 100` is not a limiter either (100 bars of `5m` = 8.3h).
So the `5m` bar array handed to the scoring path **does** end at `22:40`, while the arena
reports `asOf = 22:25`. **The discrepancy is NOT in bar loading.** The `asOf` derivation (or
the `marketStatus` assembly) is where it must be — `market-status.ts` says `asOf` is "the
array's last element", which is contradicted here.

### ⚠️ Second observation — the shape changed, so do not treat this as one bug

A later call returned **no `asOf` at all** for the `5m`-only protocols, and the `5m–1d` /
`5m–1h` rows disappeared from the response entirely; only `15m` and `1m` remained:

```
tf=15m–1d  asOf=22:15:00
tf=15m     asOf=22:15:00
tf=15m     asOf=22:15:00
tf=1m–5m   asOf=22:29:00
```

A *lagging* `asOf` and a *missing* `asOf` are different symptoms. **It is not yet known
whether these are one defect or two.** Anyone continuing this should pin down which they are
looking at before changing anything.

## Next step for whoever picks this up

1. Read `nest/src/modules/directives/market-status.ts` — specifically how `asOf` is derived
   from the bar array, and why it can differ from `array[array.length - 1]` when the array
   demonstrably ends at the newest bar.
2. Check `scoreWithGating()` in `protocol-gating.service.ts` — whether it re-slices, filters,
   or re-fetches bars after `loadCadenceBars` (that would explain both symptoms).
3. Re-run `node nest/scripts/contract-probe.cjs --symbol AUDUSD` against a **stable** API and
   observe across several 5-minute refresh cycles before deciding it is persistent.
4. **Only then** decide issue-or-not. Filing before the cause is known is how #795 became a
   false alarm.

## ⚠️ Operational hazard found this session — the API dies when a terminal is cleaned up

The NestJS API was **killed twice** by terminal cleanup (exit code 1) because it had been
started *in* a terminal that was later cleaned up. Each time this presented as
`ECONNREFUSED` on `3201`, which reads like a crash and is not one.

**Start it detached instead — this survives terminal cleanup:**

```powershell
cd C:\wamp64\www\trading-command-suite\nest
Start-Process -FilePath "node" -ArgumentList "dist/src/main.js" `
  -WorkingDirectory "C:\wamp64\www\trading-command-suite\nest" -PassThru `
  -RedirectStandardOutput "C:\wamp64\www\trading-command-suite\logs\nest-api-run.log" `
  -RedirectStandardError  "C:\wamp64\www\trading-command-suite\logs\nest-api-run.log.err"
```

⚠️ This also explains an earlier red herring in this session: `build:api` reported
*"API did not report healthy within 30s"* because its background start had been orphaned, not
because the build failed — **the build itself printed `Build succeeded`**. Do not read that
message as a build failure.

## Gates

⚠️ **NO GATES ARE CLAIMED FOR THIS FINDING.** It is an unmade change. The gates for the
tolerance fix are recorded in `2026-09-11-intermittent-guard-no-future-rows.md`.

## Correction — I over-claimed during this session

I stated mid-session that `INV-NO-FUTURE-ROWS` "5/5 consistent, intermittency eliminated",
then **three consecutive later runs failed it**. I investigated and the cause was the `5m`
feed being 5 minutes stale (`5m max=22:25` against `now=22:30`), on which the check correctly
reported `orphans=0`. **The tolerance fix holds** — a subsequent 4-run sequence returned
`12 passed, 0 failed` — but the "5/5" claim was drawn from a favourable window and I should
have re-run it after the feed moved. The lesson is the one this workbook exists for:
**a green run inside a favourable window is not the same as a stable check.**

## Capability Map Entry

- **name:** Arena Cadence Freshness (INV-BAR-ORDER) — *open investigation*
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** **partial — cause unidentified; one hypothesis disproven**

## QA Test Entry

- **area:** Scoring
- **name:** arena `asOf` matches the newest bar for every cadence
- **procedure:** `node nest/scripts/contract-probe.cjs --symbol AUDUSD`, run **twice ~6 min
  apart** so a refresh cycle intervenes.
- **expected:** every cadence's `asOf` equals its newest DB bar. A single cadence lagging
  while others are current is the signature to look for — treat a lag with **zero** bars in
  the gap as a data gap (benign), and a lag with **bars present** in the gap as a real defect.

## Architecture Framework Entry

- **section:** status
- **summary:** OPEN — Arena `asOf` for `5m` protocols lagged the `5m` bar table by 10 min
  (`asOf=22:25`, newest bar `22:35`) while `1m`/`15m`/`1h`/`1d` all matched, with 1 bar
  present in the gap (so NOT the settled #795 data-gap case). Cause unidentified;
  `loadCadenceBars()` (`arena.controller.ts` L165) is the first place to look. Files:
  `arena.controller.ts`, `nest/scripts/contract-probe.cjs`.
