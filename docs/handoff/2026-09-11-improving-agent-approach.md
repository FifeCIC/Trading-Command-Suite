# Handoff — Improving agent approach: the four gates, and why rules were causing mistakes

**Date:** 2026-09-11
**Trigger:** two owner questions — (1) *"how can we improve agent approach to tasks? … input/output
unit testing in pipelines that can only move forward when each test gets a pass. Am I waffling or
far from the issue?"* and (2) *"is there documentation or agent rules leading to bad decisions?"*
**Answers:** (1) **Not waffling — precisely right.** (2) **Yes — three documentation defects, all now fixed.**
**Status:** Phases 1–2 implemented and verified; Phase 3.1 implemented and proven; Phases 3.2–5 proposed.

---

## Q2 first — YES, the rules were causing the mistakes

This is the more concrete finding, so it goes first.

| Defect | Evidence | Effect |
|---|---|---|
| **`applyTo` did not cover the files the rule governed** | `agent-handoff.instructions.md` says *"write a handoff to `.github/handoffs/`"* but its `applyTo` was `nest/src/**, src/pages/**, …` — **no `docs/**`** | The rule **never fired** while an agent edited documentation. Handoffs went to the wrong directory |
| **Two handoff directories** | `.github/handoffs/` (7 files) + `docs/handoff/` (13 files) | **FOUR handoffs cited by `AGENT-ATTENTION.md` became unfindable.** Only 1 of 4 was recoverable from git; 3 were never committed |
| **Handoffs were DELETED after processing** | the old `.github/handoffs/README.md` said the Librarian deletes each one | **This is what destroyed the record of *why*.** The reasoning was written down and still vanished |
| **Duplicated + misnumbered rule text** | `agent-issue-close-checklist` contained the same "BEFORE YOU START" block **twice**, and numbered two consecutive steps both `5` | Corruption in a MANDATORY file → agents skim and miss real constraints |
| **Two instruction files had NO frontmatter at all** | `accessibility-policy`, `ui-standards` | No `applyTo` → may not have loaded as instructions at all |

> **Unifying principle: an instruction that does not fire is indistinguishable from an instruction
> that does not exist.**

**These are resource problems, not reasoning problems.** I did not make a bad judgement about where
to write a handoff — I followed a rule whose `applyTo` silently excluded the directory I was working
in. That is why the same mistake happened repeatedly.

### Fixed

| Change | Detail |
|---|---|
| `agent-handoff` `applyTo` | → `"**"` (a handoff is written about work spanning any file type) |
| `agent-qa-testing` `applyTo` | → `"**"` |
| `accessibility-policy`, `ui-standards` | frontmatter + explicit `applyTo: "src/**"` **added** (they had none) |
| Handoff directory | consolidated → **`docs/handoff/`**; `.github/handoffs/` **deleted** |
| Handoffs are never deleted | corrected in the instruction, the README, and the process |
| Duplicate block + numbering | fixed |
| Lost handoffs | 1 recovered from git; 3 marked **HANDOFF LOST** with a pointer to where the reasoning survives |
| **`scripts/validate-agent-docs.cjs`** | **new build gate** — fails on a duplicate handoff dir, duplicated blocks, or misnumbered lists |

⚠️ **The validator's own false positives were removed.** Its first run flagged 9 items; 4 were
**correct citations in abbreviated form** (`directives/market-status.ts` for the real
`nest/src/modules/directives/market-status.ts`) plus a cross-workspace citation. A check that fires
on correct input gets switched off. Refined to report only when the basename exists **nowhere**:
**0 warnings, 0 failures.**

---

## Q1 — Not waffling. You described a completeness contract

Your proposal: *"input/output unit testing in pipelines that can only move forward when each test
gets a pass."* That is exactly the missing piece. The problem is not that agents cannot do the work
— it is that **"done" has no definition that binds**.

| Evidence | What it shows |
|---|---|
| **#638** closed 2026-08-16 with *"flat constants removed"* ticked; `ENTRY_THRESHOLD = 40` **still live** at `protocol-gating.service.ts` L324 | A tick is a **claim**, never verified |
| **#789 / #790** re-found the same class **26 days later** | Unenforced decisions are re-opened |
| 30 orphan DB rows while the seed endpoint reported `entries: 419` (down from 434) | The diagnostic counted rows **upserted**, not rows that **exist** — it *read* like success |

### The four gates

```
BEFORE  →  is this settled?  detect-circular-work.cjs + SETTLED-DECISIONS.md
   ▼
GATE 1  STRUCTURAL   tsc --noEmit · eslint · build
   ▼
GATE 2  CONTRACT     prebuild: protocol-directions → gate-membership →
                     pipeline-contracts → agent-docs
   ▼
GATE 3  STATE   ◀── THE ONE THAT WAS MISSING
        diff-seed-vs-db.cjs
        "does the running system agree with the config that describes it?"
   ▼
GATE 4  BEHAVIOUR    the new thing demonstrated end-to-end
   ▼
REPORT  gates run · observed output · NOT DONE (explicit) · blocked-by (confirmed)
        → if this was an INSTANCE of a class, ADD A GUARD
```

**Gate 3 is the insight.** Gates 1, 2 and 4 pass **while the live system is unchanged** — which is
precisely how 30 orphan rows sat in the database with every build green.

### ⚠️ Honest-partial is a PASS

The contract must not create pressure to over-claim, or it reproduces the #638 failure it exists to
prevent. Saying *"gates 1–3 pass; I cannot decide items X and Y"* is **fully compliant**.

**Reporting a limitation is never penalised. Concealing one is.**

---

## ⚠️ CORRECTION — the two "open items" I handed you were NOT open items

**I reported these wrongly, and the mistake was in my own tool.** Earlier I said the diff found
two things needing your decision. **Re-investigated 2026-09-11: neither needed a decision, and the
report itself was a bug.**

| What I claimed | The truth |
|---|---|
| `060ed261-…` — "a junk protocol row" | **A real protocol row** — "Conviction Dip Accumulation", created 2026-07-26, `active: 0`. **Present in the seed file too** (L2439). `0 groups` on **both** sides, nothing references it. An abandoned placeholder, not junk |
| `signals-workbench` — "real but not in the seed" | **It IS in the seed** (L2450). `0 groups` on both sides **by design** — it is a *workbench* protocol populated by `SignalEnvelopeService.persistScores()` (`score-history.service.ts` L54), not scored through the gated pipeline. This also explains the `ProtocolHealthService` "no risk-gate group" warning: **expected, not a fault** |

### The bug in `diff-seed-vs-db.cjs` (third precision bug that day)

Its DB query joined `protocol_directive_entry → protocol_directive_group → protocol`. That is an
**INNER** join, so a protocol with **zero entries** never appeared on the DB side — and was then
reported as `PROTOCOL-ONLY-IN-SEED` (*"a re-seed would create it"*), which is the **opposite of the
truth**: both rows already existed.

**Fix:** load the spine table independently (`SELECT slug FROM protocol` → `loadDbProtocols()`).
Also added a guard that **refuses to render a conclusion if the DB side came back empty** — because
every seed protocol would falsely read `MISSING`, i.e. hundreds of fake problems from one
connection failure.

**The pattern across all three bugs I made that day** (68 false positives; 419 phantom rows; this):
**the tool invented a problem that did not exist.** A diagnostic that cries wolf spends a human's
attention on non-problems *and teaches them to distrust the tool* — which is worse than no
diagnostic, because it looks like coverage. The rule is now recorded in the script:
**always load the spine table independently of its children.**

### Current state — `drift: 0`

```
seed      : 47 protocols, 419 placements
database  : 47 protocols, 419 placements
drift: 0 difference(s)
✅ seed and database agree exactly. 2 known-benign item(s) acknowledged:
    · 060ed261-… — abandoned placeholder created 2026-07-26 — active:0, nothing references it
    · signals-workbench — workbench protocol — populated by SignalEnvelopeService.persistScores()
```

Both are on an investigated **allowlist** in the script, each carrying the evidence that makes it
benign. ⚠️ An allowlist that swallows a real problem is worse than no check, so the entries record
*why* — and the note says to delete an entry if the protocol is ever removed, or it would then hide
a future protocol that genuinely has no configuration.

---

## What I implemented (Phase 3.1) — guarding a REVERTED decision

`docs/SETTLED-DECISIONS.md` row 9 was the highest-risk loop candidate: the `directionBias` capacity
test was **already tried and reverted once** (2026-09-10), and the reasoning lived only in a comment
inside a 900-line service that an agent editing for another reason will not read.

**New:** `nest/src/modules/scoring/directional-capacity-contract.spec.ts` — 5 tests with the
measurement table in the file header.

**⚠️ Proven to bite, not assumed:** I reintroduced the reverted bug at `protocol-gating.service.ts`
L749 (`if (!isGateGroup && (result as any).directionBias)`) and **2 of the 5 tests failed**. Source
restored; 5/5 pass. A guard never observed to fail is a hope.

**Row 9 is now 🟢 in the register** (was 🔴).

Row 10 remains 🔴 **and no guard is possible** — you cannot guard "do not recalibrate before the
denominator is frozen" while the denominator is still moving. #761 stays open.

---

## Verification (2026-09-11)

| Check | Result |
|---|---|
| `validate-agent-docs.cjs` | ✅ **0 warnings, 0 failures** (was 2 failures / 9 warnings) |
| `directional-capacity-contract.spec.ts` | ✅ **5/5 pass**; proven to fail (2/5) with the bug injected |
| `validate-directive-group-kind.cjs` | ✅ OK — 70 gate placements |
| `validate-pipeline-contracts.cjs` | ✅ 22 invariants, wiring + QA mirror satisfied |
| `diff-seed-vs-db.cjs` | 419 seed = 419 DB; 2 protocol-level items (your decision) |
| `build:api` full chain | ✅ **Build succeeded** — now **5 validators** gate every build |
| Handoff directory | `.github/handoffs/` **removed**; `docs/handoff/` holds 21 files |

---

## Files

**New:**
`scripts/validate-agent-docs.cjs` · `nest/src/modules/scoring/directional-capacity-contract.spec.ts` ·
`docs/PLAN-improve-agent-approach.md` · `docs/SETTLED-DECISIONS.md` ·
`docs/handoff/README.md` · `.github/instructions/change-completion.instructions.md` ·
`.github/instructions/anti-circular-work.instructions.md`

**Fixed:**
`agent-handoff` · `agent-qa-testing` · `agent-issue-close-checklist` · `accessibility-policy` ·
`ui-standards` · `AGENT-ATTENTION.md` · `nest/package.json` · `docs/handoff/2026-09-10-mt5-server-clock-skew.md` (recovered)

---

## Recommended next steps

| # | Step | Effort | Why |
|---|---|---|---|
| 1 | ~~Decide the 2 open items~~ | — | **Not needed — I was wrong.** Both are acknowledged; `drift: 0` |
| 2 | ~~Phase 3.3 — make Gate 3 automatic~~ | — | **DONE** — `INV-SEED-DB-CONSISTENT` in `contract-probe.cjs`, proven to fail on drift |
| 3 | **Phase 4** — one input/output test per invariant | large | The real answer to your testing instinct. Converts invariants from *"mechanism present"* into *"behaviour correct"* |
| 4 | Decide the 3 unclassified directives (#790) | small | `sp500-regime`, `spy-qqq-relative-strength`, `vix-strategy` declare no `category` but emit direction |

**What I would NOT do:** change any scoring threshold or band. Row 10 is 🔴 because the bands were
invalidated by a denominator change — recalibrating before the denominator is frozen **is** the loop.

---

## Honest limits

- **Guards only cover what someone thought to check.** Something is unguarded and undiscovered now.
- **The register only works if kept up.** A decision settled and not recorded is not settled.
- **`detect-circular-work` needs its topic list maintained** — a loop in an unlisted area is invisible.
- **I made THREE mistakes today that this plan is designed to catch** — an over-broad rule (68 false
  positives), a broken join (419 phantom rows), and an inner-join blind spot that produced two
  invented "open decisions" I then handed to the owner. **All three were caught by running against
  the real tree, not by reasoning.** The plan does not make agents correct. It makes incorrectness
  visible at the gate instead of three weeks later as a re-opened issue.
- ⚠️ **The two "open items" I escalated did not exist.** If I had simply asked you to decide and you
  had, the decision would have been taken against a false premise. That is the most expensive kind of
  error, and it is why the honest-partial rule matters: *"I cannot decide X"* is only useful when X is
  real.
