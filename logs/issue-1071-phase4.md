## Phase 4 — the scores, and the decision

The plan asked for one thing before a verdict: **score each approach against the three questions, and record found / not found / found only after being told, plus the time to answer.** Here it is.

### The scoring

| | **B** — the hand-maintained graph | **C** — generated from source | **D** — the derived dataset |
|---|---|---|---|
| **Q1 — which writers can reach `marketbar`?** | 🔴 **NOT FOUND.** The *Data Pipeline* node declares `tables: ['MarketBar', …]` — a table list. It names **no writer**, so a reader still has to grep | 🟢 **FOUND — 8 writers**, including `bar-refresh.service.ts` (raw SQL) and `webhooks.controller.ts` | 🟢 same data, carried forward |
| **Q2 — which nodes have no consumer?** | 🔴 **NOT FOUND.** Its 14 connections are hand-drawn between 10 subsystems; nothing asks the question | 🟢 **FOUND** — `order`: 6 write sites, **0 readers** | 🟢 **FOUND, deeper** — **129** candidates (78 with no same-name call anywhere) |
| **Q3 — which values are produced in more than one place?** | 🔴 **NOT FOUND** | 🔴 **CANNOT ANSWER.** C is table-level; `profitPct` touches no table in any of its four sites | 🟢 **FOUND** — 43 exact groups, **17 divergent**, 1 idiom group of **5** sites |
| **Time to answer** | — | **6.8 s** per run | same run (C and D emit together) |

**C+D answers 3 of 3. B answers 0 of 3.**

### The honesty note that belongs with the scores

**The tool was calibrated against these three defects.** The raw-SQL path exists because #1068 taught us a Prisma scan misses it; the idiom tier exists because #1069's four sites are not textually equal. So Q1 and Q3's *demonstration* is partly circular, and saying otherwise would be the kind of confident claim this repo keeps paying for.

**What is NOT circular is what it found that nobody had named:**

- the **other seven** `marketbar` writers
- `order`'s **zero readers** — a table with six write sites and no consumer
- `exit-consensus.service.ts:374` (`peakProfitPct`), **a fifth #1069 site the manual audit did not list**
- the **42 other exact groups** and **16 other divergent groups**, which were never the target

### The decision

> **Stop at D.** No phase 5.

The plan's own stopping rule was *"if C+D answers two of the three questions and B adds nothing measurable, stop at D and render it minimally."* The measurement came in **stronger than the rule required** — three of three, not two — and Phase 3 already rendered it. Recorded as **register row 66**, with a `DECISION` marker at the generator, because a decision in one home is not recorded.

⚠️ **"B adds nothing" is about the three QUESTIONS, not about B.** The lab page is the only surface rendering **live** health — ticks, provider status, breaker state — and a static dataset cannot do that. What row 66 forbids is a *second hand-maintained node list*, not the live view. Deleting it would be the wrong reading.

### What is carried forward, measured rather than hoped

| Cost | Figure |
|---|---|
| The prebuild gate | **6.8 s** vs 0.2 s + 0.1 s for the two it sits beside (34×) |
| How often it stales | any change to what touches the eleven resources, or any new ratio anywhere |
| The maths scan | **ratios only** — `size * riskPct` is not reported |
| The node file lists | **still hand-written** — the *Data Pipeline* node declares three files, none of which writes a tracked resource, while the pipeline writes `marketbar` via `import-jobs.service.ts`, which the node never lists |

The last one is Phase 3 measuring the drift this plan predicted, on the very surface built to remove it. It is the only item I would still call open, and it is not a phase — it is one edit to a node list, or one more derivation.
