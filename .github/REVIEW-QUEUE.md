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

| id | the decision, in one breath | where | question |
|---|---|---|---|
| **R20** | Make **post-entry exit management per-bot data** — a bot chooses which exit directives apply and with what settings. Today ONE global `StopGuardianService` serves every bot, hardcoded, which is why it appeared nowhere on the bot page | **#990** · #936 · `GUARDIAN_RULES`: 11 `global` + 1 `per-bot` (the per-bot one is `NOT IMPLEMENTED`) | Per-bot data, or keep one global mechanism because 50 configurable bots drift? ⚠️ A **maths change** — ships as an A/B copy, never in place. |

**R17 was answered "Keep"** on 2026-09-24 — see DONE.

New rows appear when there is **something to look at or a genuine fork**, not before.

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
| **R14** | ✅ **DONE 2026-09-23.** SL/TP are now captured, persisted and served: `backtesttrade.stopLoss` / `takeProfit` (nullable — old runs say "not recorded", never 0), drawn on the replay timeline as dashed guide lines and shown as columns on the row. Verified live: a fresh run stored entry `1.60352` beside SL `1.58734` / TP `1.6194`, and the payload's caveat now states levels ARE recorded for that run. Remaining from the same answer: the **charting-library comparison** (only `lightweight-charts` is installed; the extras must be lazy-loaded or the bundle guard fails) — still open as its own piece of work. |
| **R15** | ✅ **NOW** — per-tick decision stream for backtest runs. |
| **R16** | 🎯 **Lab/Development split — decided without asking (owner was away).** The instruction's two halves disagreed: the rule named *backtest/snapshot/replay*, but the sentence defining the area said *"where we test theories, and data"*. Applied the **intent** — the test used is **"what does the market do, and what would have happened?" = Lab** / **"does this part of the app work?" = Development**. So Lab kept **11** (backtest, snapshots, snapshot-replay, charts-lab, timeline, position-lifecycle, speed-trading, gold-speed, ab-testing, allocator, portfolio-lab) and Development absorbed the other **21**, grouped under 4 section headers. **Backtest Engine also moved in from Education** (never fitted there). ⚠️ **The borderline ones are one-line flips** — say the word and any moves. ⚠️ Found on the way: the Lab Directory page was **already broken** (3 of its 8 cards pointed at areas renamed months ago), and `npm run check:bundle` **fails on every run** (3.4MB over a 280KB budget), so it is not a working gate. |
| **R19** | ✅ **PRIMARY-AGENT MANDATE CODIFIED (2026-09-24).** Your direction — override authority, decisions written down, Development as an experiment sandbox — is now **rules with canaried guards**, not prose. **Read the decisions at `/development/theory-registry`**: 5 real theories, each with its falsification test, its evidence **strength** (`measured here` / `code read` / `cited` — so a citation can never pass as a measurement), and the decision taken. ⚠️ Two honest limits: both guards are **on demand, not in a build gate** (🟡), and the registry holds 5 of the held theories — #944's three named ones are still to be seeded. ⚠️ The new guard found **2 pre-existing register defects on its first run** (two rows numbered 26; a guard marker destroyed into U+FFFD) **plus one I had written myself**. |
| **R18** | ✅ **Sprint #924 COMPLETE (2026-09-24).** Its six owned items were already closed; the only open one was **#919**, closed this session. In doing so: the scoring field **`weightStrategy` was found INERT** — it selects nothing, so #919's requested rename would have been cosmetic. Declared inert instead, guarded by a canaried test; group weights are now labelled `· not applied` on 5 surfaces (verified live on both Protocols page variants). ⚠️ Also found: `qa-checklist.js` ~L1394 asserts *"group-weighted vs maxscore-weighted produce different composites"* — **false** (Librarian-owned). ⚠️ And the A/B test *"XAU M15 group vs maxscore weighting"* could never have reported: **both arms score identically** — a second cause beyond #929. → **R17** |
| **R17** | ✅ **KEEP (2026-09-24)** — you answered *"Keep"*. The rename is **rejected**: `'group-weighted'` keeps its historical name and `weightStrategy` stays **declared inert**. Recorded as register **row 32**, and ratified in the `DECISION` marker in `protocol-gating.service.ts` so it reads as a confirmed position rather than a unilateral call. ⚠️ The cost figure was corrected **before** the ruling — 44 references / 17 files + 28 stored rows, not "1 code line". |

| **R21** | ✅ **NEW REGISTER (2026-09-24)** — you chose a dedicated register over a second section in this queue. **Built:** `src/data/design-observations.js` → `/development/design-observations`, in Development → Decisions beside the Theory Registry. ⚠️ The field that makes it a register rather than a gripe log is **`reconsiderIf`** — the condition that should re-open the design — **required on every row**, the way a theory requires a falsification test. Seeded with **4** observations from this session. Reasoning in **#990**; the R20 fork is still open above. |

## 📚 Archived

- `archive/REVIEW-QUEUE-2026-09-23-batch1.md` — R1–R11 as first written. Kept because the batch's
  **size** is the measurement that produced the current limits.
- `archive/REVIEW-QUEUE-2026-09-23-batch2.md` — the 4-row rebuild the owner answered above.
