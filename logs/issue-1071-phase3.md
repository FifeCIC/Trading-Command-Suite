## Phase 3 — B renders D. The lab no longer owns its own IO.

**Goal from the plan:** *"`/development/pipeline-graph-lab` gains input/output lines per node — multiple where sources genuinely differ — reading D, so the view and the dataset can never disagree."*

Landed. `src/core/pipeline-map.js` (new) lazily imports `docs/PIPELINE-MAP.json` and derives, per node: **inputs** (resources read), **outputs** (resources written), **unreferenced** functions, and **divergent** maths groups.

### Measured, in the browser

**Trade Execution** — `4 declared file(s)`:

```
READS (IN)
  position          ← trade-history.controller.ts, portfolio.service.ts, duplicate-guard.service.ts
  trade             ← mt5-trading.service.ts, trade-history.controller.ts, duplicate-guard.service.ts
  trading_strategy  ← mt5-trading.service.ts, trade-history.controller.ts
  protocol          ← trade-history.controller.ts
WRITES (OUT)
  order   → mt5-trading.service.ts
  symbol  → portfolio.service.ts
12 function(s) in these files have no resolved consumer: isBlocked, round2, readAll, resolveProtocol …
3 maths group(s) in these files are written with different edges — the #1069 shape.
```

⚠️ **"Multiple where sources genuinely differ" is visible in the first line**: one resource, three contributing files, from the data rather than from a display rule.

### ⚠️ The finding, and it is the phase arguing for itself

**The Data Pipeline node declares three files and NONE of them writes a tracked resource.** Its `WRITES (OUT)` is empty. The pipeline obviously writes `marketbar` — through `import-jobs.service.ts`, **which the node never lists.**

That is the drift the plan predicted when it said *"B must consume D — a lab view with its own hand-maintained node list is the fifth surface"*. Phase 3 removed the drift from the **IO**; the **file list** is still hand-written and this is what it looks like. Recorded as the next landing, not fixed here.

### And a false claim the phase nearly shipped

The first version reported files with no dataset row as *"a path that no longer exists"*. It flagged `risk-gating-engine.service.ts` and `seasonality.service.ts` — **both exist.** The real reason was that neither touches one of the eleven tracked resources.

The cause was in the artefact: with no record of what had been scanned, a consumer could not tell **"stale path"** from **"real file, nothing tracked"**. So `phase2.files` now carries the scanned file list (546 paths, +32 KB on a 726 KB artefact) and the two are separate buckets and separate messages — `missing` warns, `untracked` notes. A false claim is more expensive than a bigger file.

### Verification

| Gate | Result |
|---|---|
| `generate-pipeline-map.cjs --self-test` | **23 / 23** (one new: the artefact lists the scanned files) |
| Vite premium build | **0** — map is its own chunk, `PIPELINE-MAP-*.js`, 696 KB / **77.5 KB gzip**, absent from the entry bundle |
| Free build | **no map chunk**; `validate-free-bundle --mode free` OK — 489 modules, 68 premium pages absent |
| `validate-css-tokens` | OK — 8,351 refs, **0 new tokens** |
| `validate-arch-surfaces` | OK |
| ESLint | `src/core/pipeline-map.js` **clean** (2 pre-existing errors in the lab page left alone) |
| Browser | three nodes checked, IO renders, **no console errors** |

### Why it is a separate chunk, stated because it is the whole reason for the dynamic import

A static import would have put 696 KB into the entry bundle for every page in the app. The lab page is `tier: premium`, so the free edition never even generates the chunk — asserted, not assumed.

### What Phase 4 now has

The comparison is complete enough to score: **Q1 yes (Phase 1), Q2 yes (Phase 1 + 129 candidates), Q3 yes (Phase 2)**. Still not measured: **how fast** each approach answers them, which the phase plan asks of Phase 4.
