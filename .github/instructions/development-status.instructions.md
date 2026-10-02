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

## 🎛️ Operating Mode — read this before deciding how much to report

> **Added 2026-09-23 at the owner's request.** *"I am in full development mode with no expectations
> of success or profit during this period… agentic AI does not feel the need to be cautious about
> current trading or report interruptions which is just more for me to read. In a mode where I'm
> asking agentic AI to examine live activity then I would understand a fuller report."*

There are **two modes**. Development is the default. If it is ever unclear which you are in, ask in
one line rather than guessing.

### Mode 1 — DEVELOPMENT (the default)

The app is a machine under construction, not a service. Trading is **always demo**, always
pre-release, and **current trading results are not evidence of anything**.

| Do | Don't |
|---|---|
| Change behaviour freely — restart, rebuild, converge, re-seed, drop and recreate | Treat a disturbed run as an incident |
| Report a **defect you found** — one line, with the command that shows it | Narrate liveness ("the API flapped", "the bridge was down") unless asked |
| File the issue and add the test, then say so in one line | Preface findings with caution about "the live app" |
| Assume the owner reads diffs and evidence | Report what you *might* have broken before measuring whether you did |

**Dev activity disturbing the running app is expected, not news.** Restarting the API mid-tick,
re-seeding over a live row, running a migration — none of these need a warning paragraph.

### ⚠️ DOWNTIME — paper is silent, REAL MONEY is reported

> **Owner direction, 2026-09-30:** *"I'm not bothered about down-time due to development. We are
> developing on a live operating version for the sake of identifying problems immediately after any
> changes we make… Only when there is a real money account involved will I want to know about
> downtime."*

The app runs on a **live operating demo on purpose** — changes go straight in so defects surface
immediately instead of after a staging cycle. So:

| Account | Report the downtime? |
|---|---|
| **Paper / demo** (MetaQuotes-Demo, PepperstoneUK-Demo) | **No** — not a sentence, not a caveat |
| **REAL MONEY** | **Yes** — a halted real account is a money event, not development churn |

**Take an agent's own breakage at face value.** Bringing the bridges down by running a canary, or
stopping the API to build, needs **no apology paragraph** — restore it and move on. What is still
wanted, always: **the defect you found** (one line, with the command that shows it), and **a hazard
you created whose state you have NOT confirmed** — that one must be said once, plainly, because
silence about an *unresolved* risk is a different thing from silence about expected churn.

⚠️ The line moves the moment a real account is configured. Check which account a bridge is bound to
rather than assuming paper — see **#1035** (a bridge can bind to an account it was not configured for).

### Mode 2 — EXAMINATION (only when invoked)

When the owner asks you to **look at observed live activity** — *"why did these positions close?"*,
*"is there a mechanism that closed them?"*, *"what happened overnight?"* — a **fuller report is
wanted**: what the data shows, what it does not, the commands with their output, and an explicit
statement of what you could not determine.

**The trigger is the question, not the fact that you happened to read live data while working.**

### What does NOT change in either mode

**A defect is still a defect.** The four gates in `change-completion.instructions.md` still apply to
the work. Honest-partial reporting still applies. This rule calibrates **volume and
caution-language for dev-induced disturbance** — it is not permission to conceal a real fault, and
"we're in dev mode" never licenses skipping a check on anything that can move money.

**Findings are always wanted — compactly.** One line each:

```
Found: <what> — <command that shows it> — <issue # if filed>.
```

### 🛑 WHICH findings become ISSUES — measured 2026-10-02

> Owner, 2026-10-02: *"For the last two weeks it's looked like we'll never again get back under 200
> github issues, we almost reached 300."* And: *"is there a risk that it is inventing layers of
> complexity that add little value?"*

The owner's instinct was right and the cause is **inflow, not a stale backlog**:

| Measure | Value |
|---|---|
| Open issues | **264** |
| Untouched **30+ days** | **5** — there is no dead tail to close |
| Touched in the last **7 days** | **68** — this is a live queue, not a graveyard |
| Opened / closed, last 30 days | **348 / 249** → **+99/month** |

⚠️ **A triage pass that "closed the stale tail" would have saved ~2% and would have destroyed
signal.** The backlog is not rot; it is throughput. So the lever is the **rate at which findings
become issues**, and that is the only thing this rule changes.

**An issue is warranted ONLY when BOTH are true:**

1. **The finding has a measured cost or a named observable** — a number, a count, an endpoint that
   behaves wrongly, a screenshot, a reproduced command. *"This could be fragile"* is not a finding,
   it is an opinion.
2. **It affects a money path or blocks one** — scoring, gating, sizing, execution, position
   management, exits, or data a trade depends on.

**Everything else is a NOTE, not an issue.** Put it where the reader will meet it and stop:

| Kind of finding | Where it goes |
|---|---|
| A trap in a tool or validator | the tool's own docblock + the one instruction file that names it |
| A stale claim in an instruction | fix the instruction — that IS the record |
| A code smell with no measured cost | a docblock at the site |
| A "we should probably…" idea | nothing. It is not yet a finding |

⚠️ **This is a DELETION rule, and it is deliberately the only new rule here.** The failure mode the
owner named — *"inventing layers of complexity"* — is what happens when every finding spawns a
tracking artefact. Governance grew faster than the code: **75 of 175 tools (43%) are orphans that
nothing references**, which is the same defect in tooling form.

⚠️ **Do not respond to a full queue by filing a triage issue, a backlog dashboard, or a
prioritisation process.** Those are three more layers. The fix is to file fewer things.

**A finding you can only describe as a risk is a note. A finding you can put a number on is an
issue.**


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
