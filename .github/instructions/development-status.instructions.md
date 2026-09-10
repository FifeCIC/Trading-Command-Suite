---
description: "Development status — read before planning ANY engineering work. The app is pre-release with no users, which changes what 'safe' means: no backwards compatibility, no migration shims, no before/after comparison work. Also holds the scope rule (check the plan first) and the list of verified invariants not to revert."
applyTo: "**"
---

# Development Status — Pre-Release, No Users

**Read this before deciding how careful to be.** It exists so agents stop spending time
on work that has no value yet, and stop reverting fixes that were deliberate.

---

## Status (2026-09-10)

| Fact | Value |
|---|---|
| **Users** | **None.** No external users, no beta cohort, no paying customers |
| **Distribution** | Not launched. Runs on the dev machine only |
| **Trading capital** | Demo accounts only (MetaQuotes-Demo #2, PepperstoneUK-Demo #3) |
| **Consequence** | **There is nothing to be backwards-compatible with** |

---

## What "no users" means for engineering decisions

### Do — the fast path is the correct path

- **Break behaviour freely when the new behaviour is more correct.** Change the response
  shape, the contract, the schema.
- **Update every caller in the same pass.** No dual paths.
- **Delete superseded code** rather than keeping it behind a flag.
- **Prove the change** with tests *and* a real data check (a test that passes for the
  wrong reason is worse than no test — see the bar-ordering handoff for a worked example).

### Don't — these cost time and buy nothing pre-launch

| Not needed | Why |
|---|---|
| Before/after comparison harnesses for score/behaviour changes | No user is comparing outputs; the fix is the reference |
| Backwards-compatibility shims, "preserve old behaviour" flags, deprecation windows, dual-read/dual-write | Nothing external consumes the old shape |
| Data migration scripts for anything re-importable from the provider | Re-import is cheaper than migrating |
| Preserving a known-buggy output "in case something depends on it" | Nothing outside this repo depends on it — check the callers and fix them |

### Exception — still treat as production

Anything that can **move money or place/manage orders**: risk limits, order guards,
duplicate guard, stop guardian, position sizing, margin checks. Demo broker or not, those
paths keep full care, full verification, and no clever shortcuts.

---

## Scope rule — check the plan before you change something

Applies to anything beyond a small local fix (rule of thumb: more than one function, or
touching a data contract, a pipeline, or a scoring rule).

1. **Find the plan.** Look for a planned series first: epic issues/phases on GitHub, the
   design docs, the roadmap, the Architecture Framework page. Issue labels such as
   `phase-N`, `epic`, and `META.Stack` mark planned work.
2. **If it belongs to a plan, follow that plan's approach.** Do not invent a parallel
   mechanism that will later need reconciling.
3. **If it is outside any plan, say so before implementing.** Raise it (issue or
   discussion) with the trade-off — do not silently expand scope. A one-line note is
   enough; the point is that the decision is visible rather than discovered later.
4. **Prefer the existing canonical mechanism over a new one.** If a shared utility
   already does the job, use it (`shared-core.instructions.md` maps the main ones). A
   second implementation is the most expensive kind of technical debt because both copies
   will drift, and only one of them will get the next fix.

---

## ⚠️ Verified invariants — do not revert

> **The authoritative list lives in
> `.github/instructions/meta-stack-contracts.instructions.md`** (IDs `INV-*`, each with a
> build-time guard and a QA entry). It is machine-checked by
> `nest/scripts/validate-pipeline-contracts.cjs`, which runs in `prebuild`.

**One file owns the list. Everything else links to it.** That is deliberate: on 2026-09-10 the
same invariants were written into three files during a single session, which is three places to
drift. If you are adding an invariant, add it there (row + guard + QA entry) and link, do not
re-state it here.

**Why the list exists:** each entry was a real bug with hard evidence, and each has already been
"simplified" away once by someone who did not know it was load-bearing. The symptom in every case
was **plausible numbers with no error** — which is also why the list is enforced by a build gate
and not by this paragraph.

---

## Where the durable docs live

Long-term documentation is on Google Drive
(`G:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\`) and is
maintained from handoff files by the Librarian. **Do not duplicate** Drive docs into the
repo — repo docs are operational only (README, SETUP, handoffs, these instructions).
