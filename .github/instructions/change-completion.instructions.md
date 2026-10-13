---
description: "MANDATORY — the completeness contract for any change. Enforces 'a finished change is complete' as a machine-checked gate, so partial work cannot be reported as done. Read before starting work on an issue that has acceptance criteria."
applyTo: "**"
---

# Change Completion Contract — work must move FORWARD

> **Created 2026-09-11.** Written after the project owner asked:
> *"how can we improve agent approach to tasks? My first thought is that issues need to be
> broken down a little more. Clearly input/output unit testing in pipelines that can only move
> forward when each test gets a pass. Am I waffling or far from the issue?"*
>
> **You were not waffling.** You described a **completeness contract**: work advances only when
> its acceptance criteria pass, and "pass" means *observed*, not *asserted*.

---

## The problem this solves (measured)

| Evidence | What it shows |
|---|---|
| **#638** closed 2026-08-16 with a box ticked *"flat constants removed"*; `ENTRY_THRESHOLD = 40` is still live at `protocol-gating.service.ts` L324 | A checklist box is a **claim**. It was not verified, so nothing enforced it |
| **#789 / #790** re-found the same class **26 days later** | Unenforced decisions get re-opened |
| 30 orphan DB rows existed while the seed endpoint reported `entries: 419` (down from 434) | The diagnostic counted rows **upserted**, not rows that **exist** — it *read* like success |

**A change is not done when the diff looks right. It is done when the acceptance criteria have
been OBSERVED to pass.**

---

## The four gates (each must be OBSERVED, not asserted)

Every change works through these. A gate that cannot be run must be reported as `UNVERIFIED` —
never silently skipped.

| # | Gate | Observed how | Fails when |
|---|---|---|---|
| **1** | **Structural** | `tsc --noEmit`, `eslint`, build | Any error |
| **2** | **Contract** | the `prebuild` validators | Any `INV-*` violation |
| **3** | **State** | seed-vs-DB / config-vs-runtime consistency check | Data and config disagree |
| **4** | **Behaviour** | the new thing demonstrated working end-to-end | Not demonstrated |

### ⚠️ Gate 3 is the one that has been missing — and it is the expensive one

Gates 1 and 2 are code checks; they pass while the **live system is unchanged**. That is exactly
how 30 orphan rows sat in the database while every build was green.

**Gate 3 asks: does the running system agree with the config that describes it?**

```powershell
node scripts/diff-seed-vs-db.cjs     # exit 1 = drift; MUST be run after any seed/config edit
```

#### ⚠️ Gate 3 has TWO questions, and only the first one was being asked (2026-09-16)

The wording above — *"does the running system **agree** with the config"* — is about **data**: does
the database match the file that describes it. `diff-seed-vs-db.cjs` answers that.

There is a second question the wording does not force:

> **Does the running system still WORK with the config I just changed?**

**The mechanical rule, which is cheap and is not a heuristic:**

> After changing ANY value in a shared config file, **enumerate its consumers and call each one.**
> A config value is validated by the thing that reads it, not by the file that declares it.

For `retention.config.ts` that means: run the prune, open the health panel, call
`db:config-refs`. For a threshold: score a protocol. For a cadence: fetch a bar. The enumeration is
the work — a value with four consumers has four ways to be wrong, and only one of them is visible
in the file you edited.

**The generalised shape, stated once:**

> **A config that PARSES is not a config that WORKS.**

Same shape as the rule already learned for seeders in
`database-seed-discipline.instructions.md` — *"A seeder that RUNS is not a seeder that RESTORES."*
Both say a declaration is not validated by being well-formed, only by being checked against the
thing it names.

---

#### 🛑 CORRECTION (2026-09-16, same day) — the worked example below was MISATTRIBUTED

This section originally presented a confident causal story. It was wrong, and the way it was wrong
is a better lesson than the story was. The original claim, and what measurement later showed:

| Claimed | Actual |
|---|---|
| A retention config change left `directiveoutcome` on an unindexed column | true — but see below |
| `MIN(createdAt)` became a **32-second full scan of a 1,497 MB table** | ❌ **this table is 1.10 MB / 6,979 rows.** A 32s scan of it is physically impossible. The row/size figures came from a different table and were never re-checked |
| The missing index **caused** `/api/system/health-dashboard` to return 504 | ❌ **unsupported.** `apiactivitylog` records exactly **one** 504, at 09:01:47 (30,015 ms). By 09:06:33 the same endpoint returned **200 in 348 ms** — *before the index was added*. With the index deliberately dropped again later, the endpoint returned **88 ms** |
| Adding the index fixed it (0.36 s) | ❌ it **coincided** with recovery. The API was also restarted at the same time, and the restart is at least as plausible a cause |

**What actually happened:** two changes were made together (add index + restart API), recovery was
observed, and the credit was given to the change that had a story attached to it. Nobody verified
which one mattered. The 504 was a single transient event.

**What remains true and useful:**

- The 504 was real (one occurrence, 30,015 ms, hitting the gateway timeout). It was not
  reproducible afterwards and **its cause is still unknown**.
- `health-dashboard` aggregates ~120 per-table queries. It is genuinely the most expensive
  diagnostic endpoint, and nothing probed it or asserted a latency budget. That gap was real.
- A column used as a **range predicate** should lead an index. That is sound on its own merits —
  it just was not the cause of this outage, and the performance benefit on this table was never
  measured.
- The six "present in an index but not the leading column" findings were real, and their impact
  was **not** measured. Do not cite them as a speed-up.

**The lesson, which is the actual carry:**

> **Do not attribute a fix you did not isolate.** When two things change and the symptom goes away,
> you have a correlation, not a cause. Say "recovery coincided with X and Y; not isolated" — or
> isolate it. An unverified cause written into an instruction file is worse than no explanation,
> because the next reader trusts it and stops looking.

This is the same defect as the one this file already documents — #638's ticked checkbox for a check
that was never run. A *causal claim* is also a claim, and it needs the same treatment: name the
observation that supports it.

---

## 🛑 Do not call two numbers a DISAGREEMENT until you have stated the basis of each

**Measured 2026-10-13 — three times in one session, by the agent that had already read the
"re-check your numbers" rule.** In all three the numbers were right. The **comparison** was wrong.

| Claim | What was actually compared |
|---|---|
| Portfolio "6.1× overstated" (**#811**) | the All-Platforms aggregate vs MT5-only equity |
| "Two score stores disagree 3.4×" (**#1114**) | `MAX(score.value)` over 2 weeks vs `MAX(score_snapshot.composite)` all-time |
| "Every protocol peaks today" | `MAX(DATE(x))` — the **last** day — under a column headed *"ceiling_occurred_on"* |

**The existing rule ("re-check numbers you did not measure yourself") cannot catch any of those**,
because the numbers *were* measured. So the guard has to bite at a different moment:

> **Before writing "X and Y disagree", "X is 6× Y", or "X peaks on <date>", name the SOURCE and the
> WINDOW of each side in the sentence itself.** If the two sides do not share a basis, it is not a
> comparison — it is two unrelated measurements printed next to each other.

Checks that would each have caught all three:

1. **Same window, or say so.** An all-time `MAX` against a windowed `MAX` is not a disagreement.
2. **Same population** — same table, same filter, same join cardinality. A per-protocol aggregate
   against a per-symbol one is not a disagreement. (Found again *inside* #1115's fix: thirteen
   `forex-session-v1` bots all reported one `achievedPct` because the join ignored the symbol.)
3. **A derived column must not hide the data it came from.** `MAX(DATE(t))` is *"last seen"*, not
   *"when the peak happened"* — it was labelled and read as the latter. Print the raw value beside
   the derived one, or name the column after the transform rather than the intent.
4. **A scale change is not a disagreement.** Where history spans a rescale, a `MAX` across it returns
   an obsolete number. Look for one before comparing — see **#1116**.

⚠️ **The `db-schema.cjs` warning ("read the TYPE, not just the name") fired three times in this
session and prevented none of it.** A warning printed by a tool does not reach the moment the
sentence is written. The guard has to be a precondition on the claim, not a note beside the command.


**Guards that were added, and what each is actually worth:**

| Guard | Runs | Value |
|---|---|---|
| `validate-retention-columns.cjs` | `prebuild` (static) | retention column must be intrinsic, declared once, and **lead** an index in `schema.prisma` |
| `db:config-refs` | on demand (live) | the same column exists in the **real** database, leads a **real** index, and the predicate answers in budget — the gap the static check cannot see, because `schema.prisma` is documentation here (no migrations, `db push` banned) |
| `INV-ENDPOINT-BUDGET` | `contract-probe.cjs` (live) | an aggregate endpoint that stops responding in reasonable time. **Cause-agnostic** — it would have flagged this at 09:01 without needing to know why |

⚠️ The budget check is the only one of the three that would have caught the actual event, and it is
the one whose value does not depend on the attribution being right. That is the argument for
preferring **symptom** guards over **cause** guards when the cause is not understood.


An **upsert-only** seeder cannot delete. So a removal or move in a config file is silently a
no-op in the database, and re-seeding cannot converge them. **Any config edit that removes or
moves something requires an explicit state reconciliation as part of the same change.**

---

## The rule: do not report a partial change as complete

### Splitting work is correct — but only if the split is DECLARED

The owner's instinct ("issues need breaking down more") is right, with one critical condition:

> **A partial change is reported honestly as partial, naming what remains and why.**

The failure mode is not splitting. It is **splitting silently** — doing 3 of 5 things, then
writing a summary that reads as though all 5 are done.

### Required shape of a completion report

| Field | Meaning | Forbidden |
|---|---|---|
| **Gates run** | Which of the 4 gates were actually executed | Claiming a gate passed without running it |
| **Observed result** | The literal command + output | "should work", "looks correct" |
| **Not done** | Explicitly: what remains, why it stopped | Omitting it, or burying it in prose |
| **Blocked by** | A **confirmed** blocker with the exact command + response | "probably down", "based on old logs" |

### The forbidden forms

```
❌ "- [x] → #XXX"          moved, not done — this is a lie (already banned by the close checklist)
❌ "the fix is complete"    with a gate never run
❌ "verified"               without naming the command that verified it
❌ omitting "not done"      from a summary of partial work
```

---

## Honest-partial is a PASS, not a failure

This contract must not create pressure to over-claim. An agent that says:

> *"Gates 1, 2, 4 pass. Gate 3 shows 2 remaining protocol-level items I cannot decide
> (`signals-workbench` seeding intent). Work is otherwise complete and the system is
> consistent."*

...is **fully compliant**. That is a better outcome than a false "all done".

**Reporting a limitation is never penalised here. Concealing one is.**

---

## Before starting: is this work already settled?

```powershell
node scripts/detect-circular-work.cjs          # all watched areas
node scripts/detect-circular-work.cjs <topic>  # one area
```

If it shows **both CLOSED and OPEN issues** for the area, you are probably *re-opening* something,
not discovering it. Check `docs/SETTLED-DECISIONS.md` — the register of settled decisions with
guard status (🟢 enforced / 🟡 partial / 🔴 **UNGUARDED**).

**If you are re-opening a settled decision, say so before writing code**, and state what changed
that invalidates the original reasoning. Re-deciding *by accident* is the single most expensive
thing that happens in this repo.

---

## When you close an issue

Two files apply, in order:

1. **`.github/instructions/agent-issue-close-checklist.instructions.md`** — the pre-close
   checklist, posted as a comment before closing.
2. **This file** — the four gates, observed.

**And the most valuable thing you can do:** if you fixed an *instance* of a known class, **add a
guard** so instance N+1 fails the build. `#789` was 14 placements; `#790` is 6 in the same class.
The guard is why that was **one** issue and not six.

---

## Where things live (canonical paths — do not invent new ones)

⚠️ **This section exists because agents have repeatedly written files to the wrong directory,
and the reasoning then became unfindable.**

| Artefact | Canonical path | Written by |
|---|---|---|
| **Handoff** | **`…\Trading-Command-Suite-Documentation\handoff\YYYY-MM-DD-{slug}.md`** (central store — NOT the app package) | any agent, before `task_complete` |
| Settled decisions | `docs/SETTLED-DECISIONS.md` | humans + agents |
| Invariants (`INV-*`) | `.github/instructions/meta-stack-contracts.instructions.md` | the ONE owner |
| Operational memory / blockers | `.github/AGENT-ATTENTION.md` | any agent, append-only |
| Guard scripts | `nest/scripts/validate-*.cjs` | any agent |
| Repo-wide audit scripts | `scripts/*.cjs` | any agent |

**⚠️ Historical note (2026-09-11 → 2026-09-13):** handoffs were split across `.github/handoffs/`
and `docs/handoff/`, and **4 handoffs cited in `AGENT-ATTENTION.md` are now lost entirely**. On
2026-09-13 the whole handoff set moved **out of the app package** to the central docs store
(`…\Trading-Command-Suite-Documentation\handoff\`). One canonical location — do not create another.
