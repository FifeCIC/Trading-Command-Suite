# 📋 Review Queue — the ONE list every agent adds to

**Purpose:** the things the owner must look at or decide. **How to answer:** the row id and a word. 🎯

**Rules for agents** (full text: `.github/instructions/agent-environment.instructions.md`)

| ✅ A row | 🛑 not a row |
|---|---|
| A **technical fork** with no clear winner, **where a new input belongs**, a **policy number**, or **permission to spend effort** | "Do you like this?" · layout/colour/wording of an existing surface (the owner reviews it and replies) · anything with a clear logical advantage (decide it, record it in DONE) |

**Limits:** ONE concern per row · question ≤ 40 words · ≤ 3 numbers · if it doesn't fit it's an
**explainer** (table / Lab / Old-New variant / mockup), not a row.

---

## OPEN

*(Nothing open.)* The four rows from earlier today were all answered — see below — and the work is
in flight. New rows appear when there is **something to look at or a genuine fork**, not before.

---

## DONE — with the owner's verdict (2026-09-23)

| id | verdict / what happened |
|---|---|
| **R1** | No change requested. *"I don't want to be asked such specific UI questions."* Surfaces are for reviewing, not for asking about. |
| **R2** | **Build it, two places.** Setters on the bot page (where they belong in the algorithm) + a **settings-only** Truth view under the existing button on `/trading/trading-bots`, as a URL parameter. → **#985** |
| **R3** | **5%** baseline (≥10 bots per account) + a **%/amount toggle**. → **#985** (stored unit stays currency, decision row 28) |
| **R4** | Settled by building it — #819 Phase 1 shipped. |
| **R5** | **Import bars + a NAMED, NOTED period** you reuse ("the 300% surge of Greenland Mining…"). → **#986** |
| **R6** | **Rename approved** — agent's call, under #980. |
| **R7** | **APPROVED** — sprint #930 stands (comment posted). |
| **R8** | Tabled into R12. Two lasting rules: complex UI gets a **variant or mockup**, and **ask first**. |
| **R9** | Split and closed — see R13. The counter-question was answered, not asked back: **SPY (ETF) and US500 (CFD) are different instruments**, so a bot on one is not a consumer for the other; a consumer must match **symbol *and* protocol**. |
| **R10** | **Decided 🟢 Option A** — an optional `portfolio` input on a directive; absent ⇒ *unmeasurable*, never a vote. |
| **R11** | The *shape* question was **withdrawn** (the owner reviews the replay and decides). The two technical forks became R14 and R15. |
| **R12** | ✅ **YES — build the variant**, *with a notice on it saying it is a variant to be decided on*. |
| **R13** | 🛑 **NOT a policy/A-B question — a development decision.** Owner: *"We can't duplicate protocols or strategies because I decide something needs changed."* The gate is a plain change. ⚠️ The owner asked for the counter-argument, so it was given: the **only** benefits of scoring a closed market are planning and diagnostics, never trading. Recorded in `maths-change-requires-ab.instructions.md`. |
| **R14** | ✅ **YES** — show SL/TP levels. *"make it interesting and fun, but also close to what people are used to on other chart software"*, and **compare the packaged charting libraries** so the owner can judge the technology *and* how easy each is for an agent to work with. ⚠️ Only `lightweight-charts` is installed; adding more must be **lazy-loaded** or the bundle-budget guard fails. |
| **R15** | ✅ **NOW** — per-tick decision stream for backtest runs. |

## 📚 Archived

- `archive/REVIEW-QUEUE-2026-09-23-batch1.md` — R1–R11 as first written. Kept because the batch's
  **size** is the measurement that produced the current limits.
- `archive/REVIEW-QUEUE-2026-09-23-batch2.md` — the 4-row rebuild the owner answered above.
