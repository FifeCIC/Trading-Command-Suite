# Page Walkthrough — three exploration asks, answered from the code and from measurement

Three views, one document, because all three asks are **"examine / explore / how much work"** rather than
build instructions. Each section states what already exists before proposing anything, because two of
the three turned out to be partly built already.

---

## 1. `/scoring/live-ordering-stack` — the scoring-system ideas

Owner: *"SIGNAL is far too low, and I'm wondering if we should trial the ability to switch between a
single score and dual - how much work would that involve? Also would there be any benefit in designing
and trialing a scoring system that is broken down into 3-5 stages, like gates made-up of groups of
directives. Just explore these ideas for now. As for the page itself it does not need changes."*

### (a) "SIGNAL is far too low" — it is a SCALE, not a fault

Measured 2026-10-08 via the new Scoring mechanics panel (`/trading/trading-bots`):

| | |
|---|---|
| Signal composite | **8** |
| Protocol's maximum | **910** |
| As a percentage | **0.88%** |
| Opportunity (separate screen) | 358 / 1010 = 35.45% |

The composite is the **raw** sum of directional directive scores, and the protocol's capacity is the sum
of every directive's `maxScore` (1010 for `xau-speed-v1`). So a "low-looking" number is a raw figure
against a large denominator. Earlier the same symbol read 106 of 1010 = **10.5%**.

⚠️ **This is a maths question and is NOT changed here.** Any change to what a scored, tradeable symbol
scores needs a copied configuration and a monitored comparison (`.github/instructions/maths-change-requires-ab.instructions.md`).
What is safe and worth doing first is the *presentation*: the same panel now shows raw/max/percent
together so the scale is visible, which is what made this diagnosable at all.

### (b) Single vs dual score — **dual already exists in the engine**

From the signal state machine (`/development/diagrams`, group *Signals & Alerts*): DUAL protocols do not
flip by themselves — BUY↔SELL switching comes from **pairing a LONG and a SHORT protocol** on a scoring
strategy (`shortProtocolId`), and the loop compares both composites with the winner above threshold
deciding; both below = HOLD.

So the work is **not** engine work. It is exposure: showing which mode a bot is in and why, on the view
where the bot is configured. That is a UI task measured in days, not a scoring-system rewrite.

### (c) 3–5 stages of gates — the grouping already exists

Protocols already carry **groups**, and groups already carry gate semantics: `isRiskGate` with
`minMultiplier`/`maxMultiplier` (a multiplicative gate where only a percentage of the signal survives),
plus per-group weights that are currently **declared INERT** (register row 30 — shown and stored, not
applied by the scorer). Group percentages are already computed as `sum(raw) ÷ sum(max)`.

So "stages made of groups of directives" is closer to **naming and ordering what is already there** than
to building a new mechanism. The open question is whether the inert group weights should become real —
that is a maths change and would need the A/B treatment.

---

## 2. `/status/order-testing` — a feedback system

Owner: *"examine the existing QA page and how we might create a system that can feedback to myself."*

**What exists:** `src/data/qa-checklist.js` holds the test registry, and every entry already carries the
fields a feedback loop needs — `area`, `system`, `name`, `procedure`, `expected`, `category`, `priority`.
The entries are therefore already *executable instructions*, which is the hard half.

**The gap is that nothing records a result.** There is no pass/fail, no date, no comment — so the same
tests can be re-run and the outcome lives nowhere.

**Proposal — reuse the Page Walkthrough's own mechanism rather than inventing a second one.** The
walkthrough already stores a verdict per view in the `appsetting` store, mirrored to
`nest/app-settings.json` so an agent can read it as a file, with `note`, `uiScore`, `noteApplied`. The
same shape fits a QA entry: `{result: pass|fail|null, note, checkedAt}`, keyed by QA id. That gives:

- a page where the owner marks each test as they run it;
- a file an agent can read without a browser;
- and — the important part — **visibility of what has never been run**, which is currently invisible.

Cost is small because the storage, the mirror and the agent-readable file all already exist.

---

## 3. `/trading/trading-plans` — limit orders and support levels

Owner: *"I've wondered if this is where we list limit orders too and potentially allow bots to create
limit orders based on a new type of protocol score... not sure if we have a good mechanism for finding
the support level yet? I asked for a view that shows us the levels so I can visually test them."*

The dependency the owner names is the real one: **a limit order needs a level, and there is no levels
mechanism to point at.** Bars are in `marketbar` and swing highs/lows are computable from them, but
nothing currently publishes a level for either a human or a bot to agree on.

**Proposal, in the owner's own order:**
1. A **Levels view** — swing highs/lows and round numbers per symbol, drawn on a chart, explicitly for
   visual testing rather than for trading.
2. Only once those levels are trusted, a **limit order** path that references one — a new order type
   alongside market orders, on the queue and through the guards like any other order.

⚠️ Do not start at step 2. A bot placing a limit order at an untested level is a new way to be wrong
about price with no way to check it.

---

## Not done here

- **No maths is changed.** Sections 1(b) and 1(c) both end at "this needs an A/B", and section 1(a) is
  presentation only.
- **No levels mechanism is built.** Section 3 is a sequencing proposal.
- **The QA feedback store is designed, not built** — it needs the owner's sign-off on the stored shape
  because it becomes the record of what has been verified.
