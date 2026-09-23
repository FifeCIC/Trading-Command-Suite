# Review Queue — what needs the owner's eyes, in one list

**Status:** active
**Category:** A
**Created:** 2026-09-23
**Last updated:** 2026-09-23
**Owner:** any agent (append rows); the human reviews

---

## How to use this file

- **On "review list" (or "show me the review queue", "what needs me?") — print the OPEN section
  below, in full, in the chat.** Do not summarise it away, do not re-derive it from GitHub, and do
  not make the owner open this file. That sentence is the whole point of the file.
- **Append** a row when your work creates something a *human* must look at or decide: a new/changed
  UI surface, a policy or threshold choice, a naming/terminology call, a thing you deliberately did
  NOT do that the owner may want done, or a visual check you cannot perform yourself.
- **Do NOT append** purely technical follow-ups (those are GitHub issues), cosmetic notes, or
  anything an agent can settle by measuring. If an agent can decide it, it does not belong here.
- **Close a row** by marking it `DONE (date)` with one line of what the owner said or did — or by
  moving it out if it becomes an issue. Rows are never silently deleted: the list is the audit of
  "did anyone tell the owner?".
- Each row names **where to look** and **the decision needed**. A row without a decision is noise.

### Row format

```
| id | opened | what | where | decision needed |
```

---

## OPEN

| id | opened | what | where | decision needed |
|---|---|---|---|---|
| **R1** | 2026-09-23 | **Bot detail page now shows a REALISED RECORD panel** — 10 cells (n, expectancy + SE, payoff, win rate with W/L, total realised, capital allowance, max decline, return % of allowance, decline % of allowance, reliability chip), then the five rating blockers verbatim and the null-with-reason notes. Added by #894's work; you said you would adjust the UI to your liking. | `http://localhost:5173/trading/strategy/34ac0946-db7b-44ca-9121-e1eff293f05d` (**EURCAD Macro Session** — has an allowance) and `http://localhost:5173/trading/strategy/14fab974-b9e0-4294-b736-af4bbf610edc` (**Zurich EURCHF Session** — no allowance, so "not set" and no percentage cells) | Layout/emphasis only — is the panel in the right place, and is any figure too prominent or too quiet? |
| **R2** | 2026-09-23 | **No UI can SET a bot's capital allowance.** It is displayed, the blocker names it, and 17 of 18 bots have none — so every one of them is permanently unratable until someone uses `PATCH /api/trading/strategies/:id` or edits the seed. | **#977** | Do you want the setter built (a small form), or is a seeded/API value enough for now? |
| **R3** | 2026-09-23 | **The rating's risk condition is settled as an absolute CURRENCY allowance** (your Option A, corrected to currency). What is *not* settled: the **25% drawdown limit** is a policy number with no A/B copy, and no bot has an allowance except one seeded example. | `docs/SETTLED-DECISIONS.md` row 28; **#894** (closed) and **#965** | (a) Which bots should get an allowance, and at what amount? (b) Is 25% the right limit to start with? |
| **R5** | 2026-09-23 | **Sprint #965 items 1–4 are built, but a backtest VERDICT cannot be produced on today's data.** The sample bar needs ≥30 trades *and* ≥30 signals per side: the runs with enough trades are legacy ones with no recorded signal count (they refuse correctly), `NVDA` fails at `need 100+ bars, have 29`, and the real XAU pair yields **7 and 15**. Only a ~30-day 5m FX window cleared it in testing. | **#965** comments (items 1–4) | Is importing bars for the stock symbols the right move, or should the comparison work stay on FX windows for now? (A data decision — the code is done.) |
| **R6** | 2026-09-23 | **A backtest run's `winRate` is a SIGNAL rate, and adapters serve it as a trade rate** — measured `100%` beside `0 winners of 3`. Fixed in the comparison/list payloads; two other endpoints still conflate them. | **#980** | Do you want the stored column renamed (clearer, touches the schema) or the trade rate stored alongside it? |
| **R7** | 2026-09-23 | **Sprint proposal for the week of 2026-09-28** (*"make change evaluable, and stop the bleed"*) — a plan awaiting your approval, with a companion sprint (#932) already closed. | **#930** (proposal) / **#932** (closed) | Approve, amend, or reject. |
| **R8** | 2026-09-23 | **The Decision Trail now labels an OBSERVATION instead of showing it as a signal** (#971). A ladder row carries no consumer, so it is written as `OBSERVED` and the page adds a muted **"no consumer"** chip beside the decision badge. ⚠️ Two visual side-effects you may want to overrule: Symbol Focus's `SCORED` badge changed from `#60a5fa` to `#3b82f6` (it now uses the SHARED palette after three pages each had their own), and the Decision Trail's colour for an unknown/unrecognised value changed from amber `#f59e0b` (which reads as "blocked") to neutral grey. **Measured:** the 12 most recent decision rows are ALL observations — they are the majority of the log, and they crowd out the rows that actually did something | `/decisions` (Decision Trail) and `/symbol/:ticker` (Symbol Focus) — the chip, and the badge colour on both pages | **Is an observation worth a row in the Decision Trail at all?** Options: (a) keep listing them with the chip (current behaviour); (b) hide `OBSERVED` by default with a "show observations" toggle, so the page leads with decisions that had a consumer; (c) list them but collapsed into one summary line per tick. Also: are the two badge colours in R8-acceptable, or should each page keep its own? |
| **R9** | 2026-09-23 | **#956 wants to stop scoring symbols that cannot trade — and the measurement says the target is 21%, not 85%.** Measured on the `score` table, last 24h, 5,756 rows / 29 symbols: market **closed** at score time = **840 rows (14.6%)**; **no active bot** on that ticker = **712 rows (12.4%)**; the **union = 1,209 rows (21.0%)**. ⚠️ The issue's headline "85% HOLD or NO_DATA" **does not reproduce** — today `breakdown.signal` is BUY 3,387 · HOLD 1,611 (28%) · STRONG_BUY 662 · STRONG_SELL 56 · SELL 40, and there are **no `NO_DATA` rows at all**, so the 5,764 came from a population I have not found (#971's 93% was decision_log rows — a third, different population). ⚠️ Also: SPY and US500 are separate symbols and the bot "US SPY Speed" is on **US500**, so "SPY has no bot" may be a sibling-instrument question rather than waste. And by policy a cadence change needs an **A/B copy**, not an in-place edit, so nothing is implemented yet | #956 (comment with the numbers + Options A/B/C and a falsification test) — evidence is `score.breakdown` in MySQL, no code changed | Three: **(1) which population is the target** — the measured 21%, or the original 85% (name the source of the 5,764 so it can be re-measured)? **(2) does a sibling instrument count as a consumer** (SPY ETF vs US500 CFD)? **(3) is a *planning* score still produced for a closed market** (#640's surface) or does the symbol stop until the session opens? |
| **R10** | 2026-09-23 | **#660's three "risk" directives do not all need the same thing — one is unblocked, two need an input-surface decision.** `volatility-regime` is computable from **bars alone** and could ship today; `position-concentration` and `correlation-drag` need **portfolio context**, which `DirectiveInput` does not carry (read it: `symbol` + `bars` only — `directive.interface.ts` L66) and **no directive receives holdings at all** (every "position" hit in `directives/**` is *price* position). ⚠️ The engine that consumes them, `RiskGatingEngine.apply(baseScore, riskDirectives)`, is deliberately **pure — no I/O** — and `assessGlobalRiskLimits()` is called from the **automation loop** (L411, L2117), not the scoring service | #660 (comment with the measurement + Options A/B/C). Recommendation 🟢 **A**: an optional typed `portfolio?` on `DirectiveInput`, populated by the loop, with absence returning *unmeasurable* (never a veto) so backtests/replays are unaffected | Two: **(1) A, B or C** for the portfolio context — B (inject a service) is the one to avoid, it would make a replay read *today's* book; **(2) if A, what travels** — per-symbol weight only, or the whole book (`correlation-drag` needs the other holdings). Plus: does `volatility-regime` ship now, or wait so the `risk` group changes once? || **R11** | 2026-09-23 | **The backtest REPLAY view is built but has not been LOOKED at.** #819 Phase 1: a real run now replays - play/pause/step, 1x/10x/100x/instant, a price timeline with entry and exit markers, filters and a running summary - mounted INSIDE the existing Backtest Engine page (no new route). It was blocked on a data defect this work found and fixed: **all 556 persisted backtest trades were stamped 00:00:00** (5m runs: entry == exit 117 of 117), so a marker could not be placed on a timeline at all. Not visually verified - the dev server was 500-ing on an unrelated module's HMR and :4173 would not render the route, so this is code- and API-verified only. Two gaps it states on screen: SL/TP are NOT persisted per trade (only the exit reason) and no per-tick decision stream exists, so 'signal only vs all ticks' is not possible yet | /education/backtest - run a backtest (Symbol + Days > Run Backtest) and the replay appears below the results. Run 262904f8-d05c-4c3c-9579-79460ea40d9b (EURCAD 5m, 26 trades, real intraday times) replays immediately; a pre-fix run such as 214b9340-67d6-4d66-862d-d461d9cdff31 shows the 'cannot place markers' caveat instead | Is the replay the shape you wanted - list first with the timeline above it, and is the transport row in the right place? And do you want SL/TP persistence and the per-tick decision stream built next? (Both are engine changes; the decision stream is what makes 'all ticks' possible.) |


  ---

## DONE

| id | closed | what happened |
|---|---|---|
| **R4** | 2026-09-23 | **Settled by BUILDING it** - #819 Phase 1 shipped (a real run now replays with transport, timeline, filters and a summary). The row asked *confirm you still want it built now, and in what shape*; the build answers the first half, and the second half (\what shape\) moved to **R11**, which is the only place it is still open. Kept here rather than deleted, so the list stays an audit of what was raised. |

