# GLOSSARY — testing and comparison terms

**Created:** 2026-11-03 · **Status:** active · **Category:** C (reference / contract)

> ⚠️ **Why this file exists.** Owner, 2026-11-03: *"can we create a term/name for that form of testing.
> We have the longterm A/B testing approach that requires live market data but the comparison approach
> as part of backtesting is different and I want to avoid confusion when discussing it."*
>
> Two different activities were both being called "A/B", and they differ in **time**, **cost** and
> **what a result can mean**. Naming them apart is not pedantry: a sentence like *"the A/B says the
> threshold is better"* is unfalsifiable until you know which one spoke.

---

## The three terms

| Term | What it is | Data | Time to a verdict | Lives in |
|---|---|---|---|---|
| **Backtest** | ONE configuration, replayed over ONE historical window | stored bars | seconds | `POST /api/backtest/run` |
| **Contrast** | TWO backtests over the **same bars** differing in **exactly one declared input**, producing a verdict | stored bars | seconds | `POST /api/backtest/runs/compare` |
| **Live A/B** | TWO accounts trading **forward in parallel**, differing in one declared input | live market, forward | days to weeks | `ab_test`, `/api/automation/ab-tests` |

### Contrast — the definition, and the rule that comes with it

> **A contrast is two backtests over identical bars where the caller names the ONE input that
> differs. Baseline and variant. Anything else is not a contrast.**

The rule is what makes the word worth having, and it cuts both ways:

| Differences | Verdict |
|---|---|
| **0** | Not a contrast — nothing to learn. Two identical runs should be *identical*, which is a useful **reproducibility check**, not a comparison. |
| **exactly 1** | **A contrast.** The difference in outcome is attributable to that one input. |
| **2 or more** | **Confounded** — not a contrast. If threshold *and* stop moved together, neither can be credited (this is the same rule as the live A/B pair LOCK, #963: *"one declared difference"*). |

### Vocabulary inside each

| | Two sides are called | The difference is called |
|---|---|---|
| **Contrast** | **baseline** / **variant** | the **declared difference** |
| **Live A/B** | **arm A** / **arm B** | the **changed field** |

⚠️ **"Arm" means LIVE.** If a sentence says "arm", it is talking about live trading. That is the point
of splitting the vocabulary — one word tells the reader which of the two clocks is running.

---

## Why these words

| Candidate | Verdict |
|---|---|
| 🟢 **Contrast** | **Chosen.** Names the *discipline* (compare against a fixed reference), carries no trading meaning to collide with, and yields "contrast run", "contrast it", "the contrast said". |
| ❌ "Backtest A/B" | Rejected. It is exactly the confusion the owner asked to remove — the same two letters for two different clocks. |
| ❌ "Comparison" | Rejected as the *term*: it is already a UI verb ("compare these two runs") and says nothing about the one-difference rule. It survives as the plain-English word inside the definition. |
| ❌ "Twin run" | Close second — accurate, but "twin" implies *identical*, and a contrast is deliberately **not** identical. |
| ❌ "Delta run" | Rejected: "delta" already means the P&L delta in this app. |
| ❌ "Shadow run" | Rejected: in trading, "shadow" usually means a parallel run against live feed, which is the *other* column of the table. |
| ❌ "Counterfactual" | Already used, and correctly, for something narrower — a backtest that re-scores history with today's configuration is labelled *"Counterfactual, not a record"*. Keeping that word for **one** meaning is worth more than reusing it here. |

⚠️ **A contrast is not evidence about the future.** It says "on these bars, with this one change, these
numbers moved". It cannot see a regime that is not in the window — which is the gap the **Live A/B**
exists to close. A contrast narrows the search; live trading confirms it.

---

## Related

- `docs/SETTLED-DECISIONS.md` — row 144 names this vocabulary, and the live-A/B pair LOCK (#963)
  is the decision the one-difference rule is copied from.
- **#963 / #965** — the live A/B pair and the decision that the measurement is the backtest.
- **#944** — `src/data/theories.js`, where a claim must carry a falsification test before either
  method is allowed to settle it.

---

# Part 2 — Strategy words: Theory, Track record, Observation

**Added 2026-11-03 (#1189).** The owner asked for a word for *"factual behaviour and evidence output
by a strategy"*, because "the theory behind them" and "what they actually did" were being described
with the same vague nouns. Same reason as Part 1: two things that are not the same thing had one name.

## The pair

A **complete strategy** is a bot plus a **theory** plus a **track record**. Neither half is optional,
and each is worthless without the other: a claim with no observation is a hope, an observation with no
claim is trivia.

| Term | What it is | Where it lives | Written by |
|---|---|---|---|
| **Theory** | What this strategy is FOR. A claim, in prose: the intended behaviour, what a good day looks like, the known weakness. | `trading_strategy.theory` + `.theoryKind` (bot) · `protocol.theory` (leg) | a human, at design time |
| **Track record** | What this strategy has DONE. One sentence per observation, plus the numbers behind it. | `strategy_track_record`, one row per observation | any agent or script, at the moment of measurement |
| **Observation** | The unit of a track record: **one plain sentence + the numbers + the source**. | one `strategy_track_record` row | whoever measured it |

### Theory kinds — a theory must declare what type of claim it is

`control` is a **first-class kind**, not a missing value. A strategy with no directional thesis is a
legitimate design, and saying so out loud stops the next reader inventing one to fill the gap.

| Kind | The claim it makes | Falsified by |
|---|---|---|
| **asymmetry** | It behaves differently up than down — the two legs are not mirrors. | the two legs winning at the same rate and the same speed |
| **participation** | It predicts no direction; it decides whether to be in the market at all. | a window where being in vs out made no difference |
| **regime** | One instrument, two clocks — the same symbol behaves differently in different sessions. | the session gate performing the same as all-hours |
| **control** | Nothing. It exists to produce a comparison, not a claim. | nothing — it makes no prediction |

### The four observation kinds — where a track record row came from

| Kind | Produced by |
|---|---|
| **contrast** | a backtest pair with one declared difference (Part 1) |
| **live** | a live A/B, or live trading that has been measured |
| **data** | a finding about the data itself — missing bars, a stale symbol |
| **behaviour** | something the app did that was watched rather than measured |

### The rule a track record enforces

> **One sentence. Then the numbers. The numbers are the proof, not the message.**

A row whose sentence carries its own arithmetic is unreadable and uncheckable; a row with a number and
no source is a rumour. So `headline` is capped at 300 characters (one sentence), `numbers` holds the
structured measurement, and `source` names the script or endpoint that produced it — **named, never
inferred**.

⚠️ **A track record is not a journal and not a blog.** It is the audit trail of what was measured. The
narrative of *why* belongs in the GitHub issue; the durable claim, once it becomes falsifiable, belongs
in `src/data/theories.js` and is linked by `theoryRef`.

## Why these words

| Candidate | Verdict |
|---|---|
| 🟢 **Track record** | **Chosen.** It is already the idiom for "what has it actually done", it implies a history rather than a snapshot, and it carries no ambiguity with the app's existing "realised record" (which is P&L from closed trades, a *derived* view — see below). |
| ❌ "Journal" | Rejected. `journal` is **already taken** in this app: it is the derived trades view with no table of its own. A second meaning would collide with a live one. |
| ❌ "Log" | Rejected — overloaded immediately (`tcs-<date>.log`, execution logs, scoring JSONL). |
| ❌ "Evidence" | Rejected as the *term*: it names a quality, not a thing, and a row is not evidence until someone reads it. It survives as the plain-English word inside the definition. |
| ❌ "Performance" | Rejected: it already means P&L. Most of what belongs in a track record is not P&L. |
| ❌ "Notes" | Rejected: `research_note` already exists and is linked to nothing, which is the defect being fixed, not a pattern to copy. |

⚠️ **Track record ≠ realised record.** The bot page's *realised record* is computed from closed trades
(`bot-performance`); a *track record* row is a human- or agent-written observation that may have no
trade behind it at all. Same shelf, different object. If a row cites P&L, `source` must say which
window it came from.

