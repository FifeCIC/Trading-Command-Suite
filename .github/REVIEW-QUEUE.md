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
| **R4** | 2026-09-23 | **#819 — the backtest replay view** ("a visually generated list, with speed control so that I can watch trade actions as they happen"). The sprint notes you already said *"I think you should build this now."* No agent has started it; it is the surface the new comparison payload (#965 items 1–2) was built for. | **#819** (sprint **#965** item 5) | Confirm you still want it built now, and in what shape — it is the one surface item 5 needs your direction on. |
| **R5** | 2026-09-23 | **Backtest comparison figures could not be validated on enough data for a verdict.** The new sample bar needs ≥30 trades *and* ≥30 signals per side; the runs with enough trades are legacy (no signal count recorded, so they refuse correctly) and `NVDA` now fails at `need 100+ bars, have 29`. Only a ~30-day 5m FX window cleared it. | **#965** comment (items 3–4 note) | Is importing bars for the stock symbols the right move, or should the replay/comparison work stay on FX windows for now? |
| **R6** | 2026-09-23 | **A backtest run's `winRate` is a SIGNAL rate, and adapters serve it as a trade rate** — measured `100%` beside `0 winners of 3`. Fixed in the comparison/list payloads; two other endpoints still conflate them. | **#980** | Do you want the stored column renamed (clearer, touches the schema) or the trade rate stored alongside it? |
| **R7** | 2026-09-23 | **Sprint proposal for the week of 2026-09-28** (*"make change evaluable, and stop the bleed"*) — a plan awaiting your approval, with a companion sprint (#932) already closed. | **#930** (proposal) / **#932** (closed) | Approve, amend, or reject. |

---

## DONE

*(none yet — close a row here with the date and one line of what happened)*
