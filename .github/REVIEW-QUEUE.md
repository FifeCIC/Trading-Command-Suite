# 📋 Review Queue — the ONE list every agent adds to

**Purpose:** the things the owner must look at or decide, so no agent has to be asked twice and the
owner never has to read six handoffs to find what is waiting.

**How to answer:** reply with the row id and a word or two. Prose is not needed. 🎯

**Rules for agents — the short version** (full rules: `.github/instructions/agent-environment.instructions.md`)

| | |
|---|---|
| ✅ A row is a **technical fork** the agent cannot settle by measuring, **where a new input belongs**, a **policy number** with no clear winner, or **permission to spend effort** | 🛑 **Not** "do you like this?", **not** layout/colour/wording of an existing surface (the owner reviews the UI and replies), **not** anything with a clear logical advantage (decide it, record it in DONE) |
| ONE concern per row · question ≤ 40 words · ≤ 3 numbers | If it does not fit → it is an **explainer** (Lab / variant / mockup), not a row |

---

## OPEN

| id | the decision, in one breath | where | question |
|---|---|---|---|
| **R12** | Shall I build an **Old/New variant** of the Decision Trail so you can SEE the three ways to handle observations, instead of reading a description? | Decision Trail (`/decisions`) — the page now labels a no-consumer row `OBSERVED` with a "no consumer" chip | Yes / no. (If yes: build it, and tell you when it's ready to look at.) |
| **R13** | **Gate live scoring when the market is closed** — your reasoning ("no new data for those symbols, so why score?"). ⚠️ By policy a cadence change ships as an **A/B copy**, not an in-place edit | #956 · evidence: 840 of 5,756 score rows in 24h were produced while `marketStatus.open = false` | A/B copy (policy default) 🟢, or stop scoring outright? |
| **R14** | Persist **SL/TP** per backtest trade (2 nullable columns) so the replay shows the levels, not just `SL`/`TP`/`EOD`. Small, additive, old runs say "not recorded" | #819 · `backtesttrade` · the replay's named gap | Build now? |
| **R15** | Persist a **per-tick decision stream** per backtest run (new table + engine write path) — the only way "all ticks" and "why did it NOT trade here" become answerable. Large | #819 · would make the sprint's `signal only vs all ticks` filter possible | Build now, or after #606? |

---

## DONE — with the owner's verdict (2026-09-23)

| id | verdict / what happened |
|---|---|
| **R1** | **No change requested.** Owner: *"I don't want to be asked such specific UI questions. I prefer to review a UI and I will send the results to agent AI."* → the bot-detail panel stays as built; surfaces are for reviewing, not for asking about. |
| **R2** | **DECIDED — build it, two places.** (a) Setters **on the bot page** `…/trading/strategy/debe2fa7-8f19-42c6-9656-f2e8d2f3b650` so the input shows *where it belongs in the algorithm*; (b) a **simplified "Truth view"** reached from the existing `Truth view — all 29 rules + enforcement →` button on `/trading/trading-bots` — same view, **URL parameter**, **settings only**, not the full information. ⚠️ Owner note: *this* kind of UI question is welcome (placing a new input). → issue |
| **R3** | **DECIDED — 5%.** Owner expects ≥10 bots per account, so the allowance baseline is **5%**, plus a **toggle between percentage and a set amount**. |
| **R4** | **Settled by building it** — #819 Phase 1 shipped (replay: transport, timeline, filters, summary). |
| **R5** | **DECIDED — import bars, and add a NAMED period.** General market time is fine for some symbols, but the owner wants a **specific from/to window**, **named** and **noted** (their example: *"the 300% surge of Greenland Mining when Trump signed a deal, over just 2 days"*), captured once by a manual tool and **reused across many tests**. → issue |
| **R6** | **DECIDED — rename.** Owner: *"If you think it will be clearer to rename it then go for it."* → agent's call, done under #980. |
| **R7** | **APPROVED** — sprint proposal #930 stands. |
| **R8** | **Tabled into R12.** Owner could not usefully decide from the description: *"complex — this is an example of when I want to see a mockup"*. Two durable rules came out of it: for a COMPLEX UI change, offer a **variant or mockup** instead of a question; and **ask first** — never for every change. |
| **R9** | **Split, and mostly decided — see R13.** The owner called *"stop scoring symbols that cannot trade"* sensible, asked for far fewer numbers and a better layout, and asked a counter-question I must ANSWER, not ask: **what is "sibling"?** → SPY (the ETF) and US500 (the CFD) are two different instruments with two different contracts; the live bot is on US500, so the SPY score has no consumer — the sibling question was whether a bot on one should count as a consumer for the other. **Decided: no** — a consumer must be subscribed to the same symbol *and* protocol. |
| **R10** | **DECIDED 🟢 Option A**, one line: give a directive an **optional `portfolio` input**; when it is absent (a backtest, a replay) the directive reports *unmeasurable* rather than voting — so history is never judged with today's book. |
| **R11** | **Split.** The *"what shape should the replay be"* question is **withdrawn** — the owner reviews the replay and decides. The two **technical** forks survive as **R14** and **R15**. |

---

### 📚 Archived

`archive/REVIEW-QUEUE-2026-09-23-batch1.md` — the first batch (R1–R11 as written), kept because the
rows are the audit of what was raised, and because the batch's *size* is the evidence for the limits
above.
