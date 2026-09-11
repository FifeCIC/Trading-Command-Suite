# PLAN — Making work move forward, and stop looping

**Created:** 2026-09-11
**Author:** GitHub Copilot (DeepSeek V4 Flash)
**Status:** Design settled. Phases 1–2 implemented. Phases 3–5 proposed.
**Owner question this answers:** *"how can we improve agent approach to tasks? … clearly
input/output unit testing in pipelines that can only move forward when each test gets a pass.
Am I waffling or far from the issue?"*

---

## 0. Was the instinct right?

**Yes — and precisely right.** The proposal describes a **completeness contract**: work advances
only when its acceptance criteria are *observed* to pass. The measured problem is not that agents
cannot do the work; it is that **"done" has no definition that binds**.

| Evidence | What it shows |
|---|---|
| #638 closed 2026-08-16 with *"flat constants removed"* ticked; `ENTRY_THRESHOLD = 40` still live at `protocol-gating.service.ts` L324 | A tick is a **claim**, never verified |
| #789/#790 re-found the same class **26 days later** | Unenforced decisions are re-opened |
| 30 orphan DB rows while the seed endpoint reported `entries: 419` (down from 434) | The diagnostic counted rows **upserted**, not rows that **exist** — it *read* like success |

**The gap is not skill or effort. It is that a change has no machine-checked definition of
"finished", and no memory that stops it being re-opened.**

---

## 1. The design, in one picture

```
   ┌─ BEFORE STARTING ───────────────────────────────────────────┐
   │  Is this area already settled?                              │
   │    detect-circular-work.cjs  +  SETTLED-DECISIONS.md        │
   │  → if CLOSED and OPEN issues both exist: STOP and cite      │
   └──────────────────────────┬──────────────────────────────────┘
                              ▼
   ┌─ DO THE WORK ───────────────────────────────────────────────┐
   │                                                             │
   └──────────────────────────┬──────────────────────────────────┘
                              ▼
   ┌─ GATE 1  STRUCTURAL ────────────────────────────────────────┐
   │  tsc --noEmit · eslint · build                              │
   └──────────────────────────┬──────────────────────────────────┘
                              ▼
   ┌─ GATE 2  CONTRACT ──────────────────────────────────────────┐
   │  prebuild: protocol-directions → gate-membership →          │
   │            pipeline-contracts → agent-docs                  │
   └──────────────────────────┬──────────────────────────────────┘
                              ▼
   ┌─ GATE 3  STATE  ◀── THE ONE THAT WAS MISSING ───────────────┐
   │  diff-seed-vs-db.cjs                                        │
   │  "does the running system agree with the config that        │
   │   describes it?"  (upsert-only seeder ⇒ drift is invisible) │
   └──────────────────────────┬──────────────────────────────────┘
                              ▼
   ┌─ GATE 4  BEHAVIOUR ─────────────────────────────────────────┐
   │  the new thing demonstrated working end-to-end              │
   └──────────────────────────┬──────────────────────────────────┘
                              ▼
   ┌─ REPORT ────────────────────────────────────────────────────┐
   │  gates run · observed output · NOT DONE (explicit) ·        │
   │  blocked-by (confirmed)                                     │
   │  → if this was an INSTANCE of a class, ADD A GUARD          │
   └─────────────────────────────────────────────────────────────┘
```

**Gates 1, 2 and 4 are self-evident. Gate 3 is the insight** — it is the only gate that catches the
failure mode this project actually suffers from, because **gates 1 and 2 pass while the live system
is unchanged.**

---

## 2. Why Gate 3 is the important one

`ProtocolDbService.seedProtocolsToDatabase()` is **upsert-only** — it creates and updates but never
deletes. Therefore:

- removing a directive from the seed does **not** remove its DB row
- moving one between groups does **not** move its DB row
- **re-seeding cannot converge them**

And the diagnostic **lies**: the seed endpoint returns `entries: N`, counting rows **upserted**, not
rows that **exist**. It reads exactly like a successful removal.

**Measured 2026-09-11:** `seed 419 placements / database 449 / ORPHAN 30`. The orphans were live
config. `rsi-overbought` was 28 of them — `directionBias: 'bearish'`, 140 points, sitting in 28
`LONG_ONLY` protocols where it is excluded from **both numerator and denominator**, so it never read
as a zero: it silently lowered the **reachable ceiling** by 3,920 points. **That was #792.**

**Any config edit that removes or moves something must include a state reconciliation in the same
change.** This is now in `change-completion.instructions.md`.

---

## 3. Why your two open items mattered (and what they teach)

They were not trivia — they were **Gate 3 output that needs a human**:

| Item | What it is | Why it was handed over |
|---|---|---|
| `060ed261-4a8c-46a4-aa9c-9de0ba7ddb8d` | a protocol row whose **slug is a UUID**, with **0 groups** | Deleting a protocol row is a *data* decision, not a drift fix |
| `signals-workbench` | a real protocol, in the DB, **absent from the seed** | Either it should be seeded (so a rebuild recreates it) or it is intentionally DB-only — unknown |

**The lesson is the response shape, not the items.** The correct output of a state check is
*"here is the inconsistency, here are the two possible intents, I cannot choose"* — which is a
**pass**, not a failure. That is now an explicit rule so the honest answer is never punished:

> **Honest-partial is a PASS. Silent-partial is the failure.**

That distinction matters, because a contract that punishes admitting a limitation just produces
over-claiming — which is the #638 failure it exists to prevent.

---

## 4. Phase 1 — DONE (structural integrity)

The Q2 finding: **agent rules themselves were causing bad decisions.**

| Defect | Evidence | Fixed by |
|---|---|---|
| **`applyTo` did not cover the files the rule governed** | `agent-handoff` said write to `.github/handoffs/` but its `applyTo` was `nest/src/**, src/pages/**…` — **no `docs/**`** | set to `"**"`; the rule now fires |
| **Two handoff directories** | `.github/handoffs/` (7) + `docs/handoff/` (13) | consolidated into `docs/handoff/`; legacy dir deleted |
| **Four cited handoffs unfindable** | only 1 of 4 recoverable from git; 3 never committed | recovered 1; the other 3 now marked **HANDOFF LOST** with a pointer to where the reasoning survives |
| **Handoffs were deleted after processing** | the old README said the Librarian *deletes* the handoff | **handoffs are never deleted** — the Librarian *summarises*; the handoff is the durable record of *why* |
| **Duplicated + misnumbered rule text** | `agent-issue-close-checklist` had the same block twice, and two steps both numbered `5` | de-duplicated and renumbered |
| **Two instruction files had NO frontmatter at all** | `accessibility-policy`, `ui-standards` | frontmatter + explicit `applyTo: "src/**"` added |

> **The unifying principle: an instruction that does not fire is indistinguishable from an
> instruction that does not exist.**

**Enforcement:** `scripts/validate-agent-docs.cjs`, now in `prebuild`. Fails on a duplicate handoff
directory, duplicate blocks, or misnumbered lists. Reports (never fails) on missing `applyTo` and
on truly-dangling citations — because a guard that fires on correct code gets switched off.

---

## 5. Phase 2 — DONE (memory that cannot be lost)

| Artefact | Purpose |
|---|---|
| `docs/SETTLED-DECISIONS.md` | **The register.** 10 settled decisions, each marked 🟢 enforced / 🟡 partial / 🔴 **UNGUARDED**. The 🔴 rows are the loop candidates |
| `scripts/detect-circular-work.cjs` | Flags re-opened areas across 7 topics |
| `scripts/diff-seed-vs-db.cjs` | Gate 3 — seed vs DB consistency |
| `scripts/validate-agent-docs.cjs` | Phase 1 structural integrity |
| `.github/instructions/change-completion.instructions.md` | The four gates + honest-partial rule |
| `.github/instructions/anti-circular-work.instructions.md` | The "is this settled?" rule |
| `docs/handoff/README.md` | Canonical location + **never delete** |

**Deliberate design choice:** `detect-circular-work` is **advisory only** (always exit 0). It reads
*history*, which is not a correctness property — a gate on history would fire on healthy code.
`diff-seed-vs-db` **can** be gated because drift is a real inconsistency.

---

## 6. Phase 3 — PROPOSED: make the loop impossible for the highest-risk rows

The register has 🔴 rows that are *known* to be re-proposed. Rather than rely on memory:

| Proposal | Detail | Effort |
|---|---|---|
| **P3.1 — Guard the reverted decision** | Row 9 (the `directionBias` capacity test) was **tried and reverted once**. Encode the reason as an assertion: a spec that fails if capacity is gated on `directionBias`, with the measurement in the failure message | small |
| **P3.2 — Freeze-before-recalibrate check** | Row 10 (#761): thresholds must not move while the denominator moves. Add a `SETTLED-DECISIONS.md` row referencing the *measurement* that must precede any threshold change | small |
| **P3.3 — Gate 3 in CI** | `diff-seed-vs-db` needs MySQL. Add it to the contract probe (which already has DB access) so drift is caught without a manual run | medium |

---

## 7. Phase 4 — PROPOSED: inputs and outputs as first-class tests

Your "input/output unit testing in pipelines" instinct, applied where it is missing:

The scoring pipeline has **unit** tests and **canaries** but few **end-to-end contract tests** — the
thing that would have caught `rsi-overbought` sitting in 28 protocols. Proposed: for each `INV-*`,
one test with a **known input and a known expected output**, not just "the helper exists".

Worked example: `INV-GATE-MEMBERSHIP` currently proves *no non-structural directive sits in a risk
gate*. The stronger form is *"given protocol X and directive Y, the composite is Z"* — a number that
changes if anything upstream moves.

**This is the highest-value remaining work**, because it converts the invariant list from
*"mechanism present"* into *"behaviour correct"*.

---

## 8. Phase 5 — DONE (the two "open decisions" did not exist)

**Investigated and resolved 2026-09-11. Neither item needed a decision — and the report that raised
them was a bug in my own tool.**

| Item | Truth |
|---|---|
| `060ed261-…` | A real protocol row ("Conviction Dip Accumulation", 2026-07-26), `active: 0`, present in the **seed too**, `0 groups` on **both** sides, nothing references it. An abandoned placeholder — not junk, not drift |
| `signals-workbench` | Present in the seed (L2450). `0 groups` on both sides **by design** — a *workbench* protocol populated by `SignalEnvelopeService.persistScores()`, not the gated pipeline. Explains its "no risk-gate group" warning: expected |

**The bug:** `diff-seed-vs-db.cjs` joined `entry → group → protocol` — an **INNER** join — so a
protocol with **zero entries** never appeared on the DB side and was reported as
`PROTOCOL-ONLY-IN-SEED` (*"a re-seed would create it"*), the opposite of the truth. Fixed by loading
the spine table independently. Also added a guard that refuses to conclude if the DB side is empty.

**Result: `drift: 0`** — `47 protocols, 419 placements` on both sides, with the two benign items on
an investigated allowlist that records *why* each is benign.

### The lesson this produced (now in the script)

⚠️ **Always load the spine table independently of its children.** All three of my precision bugs
that day (68 false positives; 419 phantom rows; this) had the same shape — **the tool invented a
problem that did not exist.** A diagnostic that cries wolf spends a human's attention on
non-problems *and teaches them to distrust it*.

⚠️ **And the worst outcome of the three: I escalated two invented decisions to the owner.** Had they
been answered, the decision would have been taken against a false premise. *"I cannot decide X"* is
only useful when X is real.

---

## 9. What to do next — my recommendation

**Priority order:**

1. **Phase 4** (largest) — one input/output test per invariant. The real answer to the testing
   instinct: it converts the invariant list from *"mechanism present"* into *"behaviour correct"*.
2. **#790** (small) — the 3 directives that declare no `category` but emit direction.
3. **Phase 3.2** (small) — a written predecessor-measurement requirement for any threshold change.

**What I would NOT do yet:** change any scoring threshold or band. Row 10 is 🔴 precisely because
the bands were invalidated by a denominator change, and #761 is still open. Recalibrating before the
denominator is frozen **is** the loop.

---

## 10. The honest limits of this plan

- **Guards only cover what someone thought to check.** `INV-GATE-MEMBERSHIP` exists because
  `session-open-effect` was found; something else is currently unguarded and undiscovered.
- **The register is only as good as its upkeep.** A decision settled and not recorded is not
  settled. The 🔴 markers are the visible debt.
- **`detect-circular-work` needs its topic list maintained.** A loop in an area nobody added is
  invisible to it.
- **I made two mistakes today that this plan is designed to catch** — an over-broad rule (68 false
  positives) and a broken join (419 phantom rows), both found by *running against the real tree*.
  The plan does not make agents correct; it makes incorrectness **visible and cheap to fix**.

**That is the realistic goal: not zero errors, but errors that surface at the gate instead of
three weeks later as a re-opened issue.**
