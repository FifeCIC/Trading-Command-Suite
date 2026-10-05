## ✅ PHASE 1 COMPLETE (2026-10-05) — option C works, and it found two silent zeros on the way

**Verdict: C is viable and it answers the questions it was built for.** The falsifier set on this issue — *"if the generated graph cannot answer question 1 or 2, C is weaker than hoped"* — **is not met.**

### Q1 — "which writers can reach `marketbar`?" → **8**

`backtest-period` · `import-jobs` · **`bar-refresh`** · `replay` · `scoring` · **`tick-recorder`** · `trading-strategy` · **`webhooks.controller`**

Finding **one** of those by hand for #1068 took many steps, and I would still have had to rule out the other seven. **Independent confirmation from a different source:** the map says `symbol_route`'s only writer is `mt5.controller.ts` — which `database-seed-discipline.instructions.md` records from a completely separate investigation.

⚠️ **And the answer would have been WRONG with the obvious approach.** A Prisma-only scan finds 26 files touching `marketbar` and **misses `bar-refresh.service.ts` entirely** — the fabricator is a raw `INSERT INTO marketbar`. The self-test canaries exactly this: with the raw-SQL path disabled, the #1068 writer **disappears**.

### Q2 — "which nodes have no consumer?" → **`order`: 6 writers, ZERO readers**

Verified rather than assumed: no relation read (`include`/`select`), no raw SQL read. The comment at `automation-loop.service.ts:2402` says *"This table audits ORDER ATTEMPTS"* — so this is a **buried ability**: an audit written and never read.

Recorded as a **note on the generated map**, not a new issue — per the owner's own filing rule (*measured cost **and** a money path*). An unread audit has a number but blocks nothing.

---

## ⚠️ The two silent zeros — this is the real Phase 1 finding

The generator reported **2 readers of `marketbar` against a hand-counted ground truth of 26**, with **no error**. Two independent causes:

| # | Cause | Why it was invisible |
|---|---|---|
| 1 | The model map keyed on the schema's **PascalCase** name; call sites use the **camelCase** client | every lookup missed and fell through a `continue` — no error, no rows |
| 2 | **61 of 117 models declare `@@map`** and the rest do not. `model MarketBar` has **no mapping at all** | it resolves only because **MySQL on Windows is case-insensitive** — a property of this machine, not of the schema |

**A silent zero, inside the tool written to find silent zeros.** Both are now normalised to lowercase, and the self-test asserts a **non-zero floor** — the assertion whose absence let it ship. Every other check in that self-test passed while the Prisma path returned nothing at all: *"finds nothing"* and *"found nothing to find"* are indistinguishable without a floor.

**For the record:** a hand-written map would have carried both errors forever and nothing would have caught them.

---

## What was built

| Artefact | State |
|---|---|
| `scripts/generate-pipeline-map.cjs` | generator · `--write` · `--check` · `--self-test` (**6/6**, with a canary proving the raw-SQL path is load-bearing) |
| `docs/PIPELINE-MAP.md` + `.json` | generated, checked in |
| `prebuild` | `--check` wired beside `docs-facts` and `tools-index`; canaried **stale → exit 1** naming the fix, **restore → green** |

Comments are stripped with the canonical `comment-stripper` — the #1061 lesson applied, so prose *describing* SQL is not a node.

**Scope is deliberately ONE pipeline** (11 resources across ingest → store → score → gate → execute). A map covering everything answers nothing, and all three test questions are about this path.

---

## ⚠️ One risk to weigh in Phase 4

This gate **stales far more often than `docs-facts` or `tools-index`** — those fire only when a count or a filename changes, whereas this fires whenever any file starts or stops touching one of 11 tables. During active work that could become a build-blocker for everyone, which is the failure #1061 was.

**Not changed now** — Phase 1 should land as planned and be observed. But if it becomes noisy, the right shape is a report-only check (like `validate-output-style-sync --report`) rather than a hard gate. **Flagged so Phase 4 decides it on observed frequency, not on a guess.**

## Next (Phase 2, only if wanted)

Make the emitted dataset first-class: nodes carrying **inputs, outputs and a `consumers: []` list**, so "no consumer" is a query. Its falsifier is set on the issue — it must answer **#1069** (a value produced in more than one place) or it does not replace the duplication review.
