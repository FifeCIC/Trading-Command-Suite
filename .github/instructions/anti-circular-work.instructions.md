---
description: "MANDATORY before changing any area listed in docs/SETTLED-DECISIONS.md. Also applies when creating a new issue in a previously-worked area. This repo has a measured problem of decisions being re-opened without anyone knowing — read this to avoid contributing to it."
applyTo: "nest/src/**, src/**, scripts/**, docs/**"
---

# Anti-Circular-Work — read before re-opening an area

> **Created 2026-09-11** at the project owner's request. He asked:
> *"I'm struggling to understand why there's so many issues despite AI looking over and working
> on these areas many times over. I'm hoping clear history in docs will help agents to alert me
> to any situation where we're re-inventing many times over."*

This instruction exists to answer that. The finding is uncomfortable and worth stating plainly:

**Most of the churn is not new bugs. It is old decisions being re-opened by agents who did not
know they were settled.**

---

## The evidence (measured 2026-09-11, from GitHub issue history)

| Area | Settled | Re-opened | Gap |
|---|---|---|---|
| **Gate vs score separation** | **#638**, closed 2026-08-16 — its checklist says *"flat constants removed"* | **#789 + #790**, 2026-09-11 | **26 days** |
| Signal denominator | **#758** — then fixed a **second** time (the first fix still read a runtime value) | **#761** still open | 1 day |
| Classification thresholds | #638 "removed" them | #761 asks to recalibrate them | 26 days |

**Why #638 did not stick:** it was closed on **intent**, not **enforcement**. Its checklist ticked
*"flat constants removed"*. `ENTRY_THRESHOLD = 40` is still live in `protocol-gating.service.ts`
(L324) today, with a code comment beside it recording that this exact constant caused an incident
on 2026-08-12.

> **A checklist box is a claim. A build-time guard is a fact.**
> Closing an issue with a guard prevents the next agent from re-opening it.
> Closing it with a tick does not.

---

## Rules for agents

### Rule 1 — Before changing a listed area, run the detector

```powershell
node scripts/detect-circular-work.cjs          # all watched areas
node scripts/detect-circular-work.cjs risk-gate # one area
```

If it shows both CLOSED and OPEN issues for the area, you are probably **re-opening** something,
not discovering something. Read the closed issue before writing code.

### Rule 2 — Classify your work before you start

| Case | Action |
|---|---|
| **(a) New instance of a known class** | Fix it **and add a guard** so instance N+1 fails the build. One issue, not N. |
| **(b) Re-opening a settled decision** | **STOP.** Cite the original (it is in `docs/SETTLED-DECISIONS.md`) and state what changed that invalidates it. |
| **(c) Docs contradict each other** | **STOP** and reconcile first. Record the reconciliation with a timestamp. Never implement against a contradiction. |

**The single most valuable thing you can do is case (a) → add a guard.**
#789 was 14 placements; #790 is 6 placements in the same class. The guard is why #790 is *one*
issue and not six.

### Rule 3 — A seed change is NOT a database change

`ProtocolDbService.seedProtocolsToDatabase()` is **upsert-only** — it never deletes. So:

- removing a directive from the seed does **not** remove its DB row
- moving it between groups does **not** move its DB row
- **re-seeding cannot converge them**

⚠️ The diagnostic **lies**: the seed endpoint returns `entries: N`, which counts rows **upserted**,
not rows that **exist**. It reads exactly like a successful removal.

**Always** after a seed edit:

```powershell
node scripts/diff-seed-vs-db.cjs
```

Measured drift before the fix: `seed 419 placements, database 449, ORPHAN 30`. The orphans were
live config; `rsi-overbought` accounted for 28 of them, silently lowering the reachable ceiling of
28 `LONG_ONLY` protocols by 140 points each (3,920 points = **#792**).

### Rule 4 — Write timestamps in doc comments

This project is at a delicate point. **Date every explanation of "why"** so a future agent can see
whether reasoning is current or superseded. Use the form:

```ts
// 2026-09-11 — <what you changed and WHY>. Replaced <old approach> because <reason>.
//   See #789. Do NOT revert without reading docs/SETTLED-DECISIONS.md row <n>.
```

An undated rationale is indistinguishable from a stale one, so it gets deleted.

### Rule 5 — Never delete a "suspicious" guard or constant without checking

Several comments in this codebase record that a fix was **tried and reverted for a measured
reason** — e.g. the `directionBias` capacity test (#761, reverted after 7 days of data showed it
excludes the directives doing most of the real work). A guard that looks redundant may be load
bearing. Check `docs/SETTLED-DECISIONS.md` first.

---

## Where the settled decisions live

| File | Purpose |
|---|---|
| **`docs/SETTLED-DECISIONS.md`** | **The register.** 10 settled decisions with guard status (🟢 enforced / 🟡 partial / 🔴 **UNGUARDED**). 🔴 rows are the ones that will be re-opened. |
| `.github/instructions/meta-stack-contracts.instructions.md` | Invariants that **are** enforced at build time |
| `docs/handoff/` | Per-change handoffs, dated |
| `node scripts/detect-circular-work.cjs` | Flags re-opened areas on demand |

---

## When creating a new issue

Before filing, check for an existing closed issue in the same area:

```powershell
gh issue list --state closed --search "<keywords>" --limit 20
node scripts/detect-circular-work.cjs <topic-key>
```

If a closed issue exists, reference it in the new one and state **why the earlier resolution did
not hold**. That single sentence is what turns a loop into a fix.
