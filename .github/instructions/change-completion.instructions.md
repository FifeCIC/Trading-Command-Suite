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
