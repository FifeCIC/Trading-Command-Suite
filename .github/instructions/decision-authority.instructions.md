---
description: "Who decides, and how a decision is recorded so it can be FOUND and REVERSED. Read before overriding another agent's work, before recording a ruling, or before building an experiment in the Development area."
applyTo: "**"
---

# Decision Authority — the arbiter, and the three homes of a decision

> **Owner direction, 2026-09-24:** *"this is the primary chat and the agent with Max setting on
> thinking power… You can over-ride other agents work is what I'm trying to say. I also want you to
> make decisions. With those decisions written into issues and doc comments. We can easily find them
> and change them if they aren't working out so well."*

The point of this file is **reversibility**. The owner sits outside the loop and interjects by
reading. A decision nobody can find is a decision nobody can reverse — and an unrecorded override is
the most expensive kind, because it destroys the reasoning that produced the original.

---

## 1. Who decides

| Actor | Authority |
|---|---|
| **Primary agent** | **Arbiter.** May override any other agent's decision, and may decide anything the owner has not explicitly reserved. |
| **Other agents** | Decide within their own scope. **On conflict with the primary, the primary wins** — see `.github/agents/primary.agent.md`. |
| **Owner** | May reverse **any** decision, at any time. Every rule below exists so that reversal is one line, not an investigation. |

⚠️ **An override is not a deletion.** When the primary overrides another agent, it MUST record what
it replaced. The other agent's reasoning was probably *locally* correct; the primary usually has more
context. Losing that distinction is how the same ground gets re-covered.

⚠️ **Agents are not special-cased by model.** `tcs-dev`/`primary` are *roles*. Do not hardcode a
model name inside an agent definition — any model may fill a role.

---

## 2. ⚠️ Three homes — a decision is not recorded until it is in ALL THREE

| # | Home | Why it is one of the three |
|---|---|---|
| **1** | **A doc comment at the code site** — the `DECISION` marker below | The next person to edit that file will not open a register or an issue. The rule has to be *at the code*. |
| **2** | **A row in `docs/SETTLED-DECISIONS.md`** | The single register the owner and every agent reads. One row, with its **guard status**. |
| **3** | **The issue** (body, or a closing comment) | The searchable narrative — the *why*, the alternatives rejected, the measurements. |

**A decision present in only one of the three is not recorded.** #919 is the worked example: the
work landed in `38147f1` citing `(#919)`, homes 1 and 3 were fine, **home 2 was never written and the
issue was left open for three days** — long enough to block a sprint.

### The marker

Place it **at the decision site** — the code the decision constrains, not the top of the file:

```js
// ── DECISION (2026-09-24, primary) ──
// WHAT:      weightStrategy is declared INERT rather than renamed.
// WHY:       It is never branched on; the denominator is hardcoded. A rename would polish a
//            control that does nothing, which is the defect the issue itself names.
// INSTEAD OF: Renaming 'group-weighted' (what #919 asked for).      <- required when overriding
// REVERSE BY: Accepting 'configured-capacity' as an alias and updating the 28 stored rows.
// REGISTER:  docs/SETTLED-DECISIONS.md row 30
// GUARD:     nest/src/modules/scoring/weight-strategy-inert.spec.ts
```

`WHAT` and `WHY` are always required. `INSTEAD OF` is required **when overriding** — an override
without it is an erasure. `REVERSE BY` is required always: **if you cannot say how to undo it, you
have not finished deciding.** `REGISTER` and `GUARD` name where to look next.

Verified by `node scripts/validate-decisions.cjs`.

---

## 3. Guard status must be honest

Every register row carries **exactly one**:

| Mark | Means |
|---|---|
| 🟢 | **Enforced** — a build gate or a canaried test fails if the decision is violated |
| 🟡 | **Partial** — guarded in one direction, enforced at runtime only, or guarded for some callers |
| 🔴 | **UNGUARDED** — nothing will notice if this is reverted. **Say so.** |

🔴 is not a moral failure; it is information. What is forbidden is claiming 🟢 for a rule that only
exists as prose — *"a rule that does not load is indistinguishable from one that does not exist."*

⚠️ **A guard that fires for unrelated reasons gets allowlisted, and an allowlisted guard is worse
than none.** Narrow beats broad. Prefer a **symptom** guard (a page stopped rendering, an endpoint
stopped answering) over a **cause** guard when the cause is not understood.

---

## 4. The Development area is the EXPERIMENT SANDBOX

> **Owner, 2026-09-24:** *"I've started thinking about the Development area as a bit of sandbox for
> agentic AI to present ideas but I'm also wondering if it would help for agent AI to implement and
> test different approaches there in order to make decisions. Could cost a lot of extra tokens but
> in the long run it could lead to a better more profitable app."*

**Decision: yes — and the experiment must end in a DECISION, not a prototype.** Extra tokens are
authorised when they buy a settled question. They are not authorised for a demo nobody measures.

| Area | Answers | What belongs there |
|---|---|---|
| **Lab** | *"what does the market do, and what would have happened?"* | theory + data + replay |
| **Development** | *"does this part of the app work?"* | tooling, prototypes, **and experiments** |
| **An experiment** | *"which of two approaches is better, and how would I know?"* | a competing implementation, a measurement, a verdict |

### The rules of an experiment

1. **Write the falsifiable statement BEFORE building.** #944 defines the fields — statement,
   predicted direction, measure **+ unit**, window, status, evidence. *A theory without a
   falsification test is not a theory, it is a preference.*
2. **Register it** in `src/data/theories.js`. Readable at `/development/theory-registry`.
3. **Grade the evidence** (`evidence.basis`):
   - `measurement` — we counted it here; `n` is the sample size.
   - `code-read` — a fact about the source; there is no sample.
   - `cited` — carried from an issue or another agent. **A citation is a CLAIM, not an observation.**
   ⚠️ This grade exists because the repo's most repeated defect is a number carried from elsewhere
   and reported as if it had been measured. Never let a `cited` entry look like a `measurement`.
4. **A `refuted` theory is a SUCCESS**, not a failure. It is the cheapest thing in the register.
   Styling or language that punishes it will stop the next agent from reporting one.
5. **⚠️ Prefer two COPIED configurations over an in-place edit** when the thing is live maths
   (`.github/instructions/maths-change-requires-ab.instructions.md`). The sandbox makes a copy cheap.

### Enforcement

```powershell
node scripts/validate-theories.cjs --report     # the registry
node scripts/validate-theories.cjs --self-test  # prove every rule can fail
node scripts/validate-decisions.cjs             # the register + the DECISION markers
node scripts/validate-decisions.cjs --self-test
```

⚠️ Both are **on demand, not in `prebuild`** — stated rather than implied, because the register is
data and `prebuild` runs validators it can evaluate without the frontend bundle. Running them is
part of closing a decision, alongside the `.github/instructions/agent-issue-close-checklist`.

---

## 5. What this file does NOT change

- The **scope rule** (`development-status.instructions.md`) — if work belongs to a plan, follow the
  plan. Authority is not licence to invent a parallel mechanism.
- The **maths rule** — overriding an agent does **not** authorise an in-place maths edit. Copy first.
- The **close checklist** — every closed issue still gets its pre-close checklist.
- **Honest-partial reporting.** Authority does not make a partial change complete. Say what you did
  **not** do.
