# Deployment — MT5 Integration Offering: Market & Valuation

> **Created 2026-09-12.** Companion to `docs/DEPLOYMENT-OPTIONS.md`.
> **Direction chosen: MT5 integration offering.** Trading212 ruled out by the owner
> (weak execution API, inadequate data source) — see §6.
>
> ⚠️ **Prices below are live observations from the MQL5 Market, captured 2026-09-12.** They are
> comparable-product prices, **not** a valuation of this app. §4 is the valuation, and it rests
> on assumptions stated explicitly for you to challenge.

---

## 1. The dominant comparable: MQL5 Market

**This is the marketplace you would sell on, and it sets the ceiling.**

| Fact | Detail |
|---|---|
| Size | **259 pages of MT5 Experts**, 316 pages of Utilities (18/page → **~4,600 utilities, ~4,700 experts**) |
| Audience | "millions of MetaTrader users" (platform's own claim) |
| Payment | MQL5 handles billing; seller gets a revenue share |
| Protection | MQL5 Market products are **compiled binaries** — source is protected by the platform |
| Rentals | Supported per-product |

### ⚠️ The key structural insight

**MQL5 Market sells compiled MQL5 binaries, not web apps.** A React + NestJS + Python stack
**cannot be listed there as-is.** That is either:

- a **barrier** (you can't use the biggest channel), or
- a **moat** (what you have, nobody on that market can easily build)

Which one it is depends on §4.

---

## 2. Observed price points (2026-09-12)

### Experts (EAs) — automated strategies

| Product | Rating (reviews) | Price |
|---|---|---|
| Quantum Titan MT5 | 4.78 (36) | $1,299.99 (was $1,999) |
| Quantum Queen X MT5 | 5 (52) | $1,199.99 |
| Ultimate Breakout System | 5 (51) | $1,699 |
| Scalping Robot Pro MT5 | 4.34 (161) | $1,599 |
| Quantum Commander | 4.64 (11) | $899.99 |
| Aikon MT5 | 5 (3) | $897.97 |
| The Gold Reaper MT5 | 4.48 (105) | $949 |
| MoonDog EA | 4.39 (31) | $349 |
| Smart Gold Hunter | 3.95 (66) | $299 |

**EA band: ~$300–$1,700. Median of the above ≈ $950.**

### Utilities — the closer comparable to this app

| Product | Rating (reviews) | Price |
|---|---|---|
| FarmedHedge Pair Trading Dashboard | 5 (4) | $490 |
| EA Overfitter (100 synthetic histories) | 5 (1) | $149 |
| POC Breakout dashboard | 5 (8) | $139 |
| Entry In The Zone (SMC MTF) | 4.83 (6) | $119 |
| Trade Assistant MT5 | 4.41 (**216**) | $100 |
| TradePanel MT5 | 4.88 (**167**) | $100 |
| Forex Trade Manager MT5 | 4.98 (**676**) | $99 |
| Telegram→MT5 Signal Trader | 5 (32) | $99 |
| Premium Trade Manager | 5 (4) | $89–111 |
| Telegram→MT5 MultiChannel | 4.46 (13) | $89.99 |
| Astro Trade MT5 | 5 (7) | $75 |
| Exp COPYLOT CLIENT | 3.97 (35) | $75 |
| Signal TradingView→MT5 Pro | 4.5 (2) | $75 |
| HINN MagicEntry Extra | 4.74 (19) | $60 |
| Local Trade Copier EA MT5 | 4.94 (**148**) | $50 |
| Strategy Ledger Pro (read-only analysis) | 5 (2) | $39 |

**Utility band: ~$40–$500. Median ≈ $95.**

### ⚠️ The pattern that matters most

**Review count and price are inversely related in the utility market.**

| Reviews | Price |
|---|---|
| 676 | $99 |
| 216 | $100 |
| 167 | $100 |
| 148 | $50 |
| 35 | $75 |
| **4** | **$490** |
| **2** | **$39** |

**The $490 and $500 products have 4 and 2 reviews.** The $99 products have hundreds.
This says the market **rewards distribution and adoption over feature depth** — high-priced
utilities are unproven new entrants, not market leaders.

---

## 3. What the comparables imply

| Observation | Implication for this app |
|---|---|
| Utilities cluster **$50–$150** | A feature-led utility price is **$99–$199** |
| Only 3 of 16 listed utilities exceed $200 | $490 is an outlier, not a target |
| Dashboards with 100+ features sell at **$100** | **Feature count is not the price driver** |
| EAs (strategies) reach $1,000+ | **The money is in strategy, not tooling** |
| No comparable has multi-provider data | This app's breadth is **not priced by this market** |
| ⚠️ Zero comparables are web apps | **The stack is unlistable here** |

---

## 4. Valuation — stated honestly

⚠️ **I cannot give you a defensible standalone valuation, and here is why:**

**Value = (price achievable) × (units sellable).** The market gives a credible answer to the
first and **no answer at all** to the second, because this app has:
- **no users** (`development-status.instructions.md`: "None. No external users.")
- **no revenue history**
- **no proven edge** (measured 2026-09-12: 4 days, `insufficient-data`)
- **no working MT5 packaging yet**

**A valuation without units-sold is a guess with a number attached.** I'd be repeating today's
mistake — asserting a conclusion from inadequate evidence.

### What *can* be said with evidence

| Basis | Range | Confidence |
|---|---|---|
| **Utility comparable band** | **$99–$199** | Moderate — 16 live comparables |
| Utility with 100+ reviews | $100–$150 | Moderate |
| Premium outlier (unproven) | $399–$499 | Low — n=2 |
| EA comparable (if it becomes strategy-led) | $300–$1,700 | Low — different product class |

### The honest position

> **Comparable pricing supports a unit price of roughly $99–$199 for a utility, or $299–$499
> if positioned as a premium dashboard with provable edge.** It says nothing about how many
> units, and therefore nothing about the app's total value.

⚠️ **And note the trap in the review data: the $490 products have 2–4 reviews.** Pricing high
with no reviews is the *normal* outcome for a new entrant, not a success signal.

---

## 5. ⚠️ The gap between "MT5 integration" and this app

This is the practical blocker, and it is large.

| Requirement | Reality |
|---|---|
| MQL5 Market lists | **compiled MQL5 binaries** |
| This app is | React + NestJS + **Python bridge** + MySQL |
| Can it be listed? | **No** — different runtime entirely |
| What would be listed? | A **thin MQL5 EA** that talks to your backend, at most |
| Who hosts the backend then? | ⚠️ You — which returns you to the hosted-per-user cost problem |

**So "MT5 integration offering" resolves to one of two shapes:**

| Shape | Description | Viability |
|---|---|---|
| **A. Desktop app + MQL5 helper** | Sell a Windows app; a small MQL5 EA bridges the terminal | ✅ **Realistic.** Circumvents the listing constraint |
| **B. MQL5-only product** | Reimplement scoring inside MQL5 | ❌ **A rewrite.** Months of work, loses the web UI |
| **C. Hybrid: MQL5 EA + hosted backend** | EA on Market, backend hosted by you | ⚠️ You carry per-user hosting cost (§ DEPLOYMENT-OPTIONS §3 B) |

**Option A is the only shape that uses what you have.** Option B throws the app away.

---

## 5b. The commercial model — TIERED (owner's strategy, 2026-09-12)

> **Owner's stated intent:** *"sell this app on a low price on a single strategy. Sell it at a
> premium with a lot more strategies. Potentially remove a lot of views for the cheaper versions
> and sell an expert suite that includes all the fancy stuff."*

### Proposed tiers

| Tier | Contents | Notes |
|---|---|---|
| **Entry** (low price) | **One strategy**, reduced view set | Volume product; the on-ramp |
| **Standard** | Several strategies | The middle |
| **Expert suite** (premium) | Everything — all strategies, all analysis, all views | The margin product |

### ⚠️ The blocker: no tier concept exists

Measured 2026-09-12: there is **no licence model, no tier concept, and no feature gating anywhere**
in the app. This is not a UI change.

**Tracked in #809.**

### ⚠️⚠️ The finding that must be understood before pricing is set

> **Hiding a view is not licensing.**

For a **Windows desktop app**, the backend runs on the user's machine. A local licence flag in
JS/SQLite is trivially bypassed — and **the user has the whole database anyway**, so gating the UI
while shipping the data protects nothing.

| Approach | Protects against | Cost |
|---|---|---|
| UI gating only | Casual misuse | ⚠️ **Nothing** |
| Signed licence key, checked locally | Casual misuse; enables per-tier delivery | Bypassable; needs key issuing |
| Server-side entitlement | Real gating | ⚠️ **Reintroduces hosting** — the cost we avoided |

**Genuine tension, not an implementation detail:** strong enforcement pulls toward hosting, and
hosting is the expensive path. **"Secure it properly" may not be affordable for a low-price entry
tier** — and the sales copy must not imply stronger protection than exists.

### ⚠️ A second constraint on tiering

| Lever | Difficulty |
|---|---|
| Gate **strategies** | ✅ Straightforward — 19 protocols, clear boundaries |
| Gate **views** | ✅ Straightforward — 162 pages exist, exposure is a config choice |
| Gate **directives** | ❌ **Not straightforward** — 155 directives compose into protocols; "single strategy" may still expose most of the scoring engine |

### Market position of the tiers

Against the comparables in §2:

| Tier | Comparable anchor |
|---|---|
| Entry | Below the utility floor (~$39–$60) |
| Standard | The utility cluster (**$99–$150**) |
| Expert suite | The premium outlier (**$399–$499**) — ⚠️ where the 4-review products sit |

⚠️ **The high tier competes with products that price high and have almost no reviews.** That is
the normal outcome for a new entrant, not a proven position.

---

## 6. Decisions and progress


| # | Decision | Status |
|---|---|---|
| D1 | Direction: MT5 integration offering | ✅ **CHOSEN** |
| D2 | Trading212 as execution path | ✅ **RULED OUT** by owner — weak API, poor data |
| D3 | Platform: **Windows only** | ✅ **CHOSEN** |
| D4 | Sellable shape (A / B / C from §5) | ✅ **A CHOSEN** — desktop app + MQL5 helper (shape A) |
| D5 | Commercial model: **tiered** | ✅ **CHOSEN** (§5b) — entry / standard / expert suite |
| D6 | Sell before proven? | ✅ **NO** — owner: *"I won't attempt to sell until the app is a bit more proven"* |
| D7 | Enforcement approach for tiers | ⬜ **OPEN** — ⚠️ see §5b, "hiding a view is not licensing" |
| D8 | Unit price per tier | ⬜ **OPEN** — anchors in §5b |
| D9 | Is this for sale, or for self-use? | ⬜ **OPEN — still gates D7, D8** |

### Issues filed 2026-09-12

| Issue | Covers |
|---|---|
| **#806** | Pair-spread z-score signal — correlation + z-score both exist, never joined |
| **#807** | Two-leg pair execution feasibility — ⚠️ money-moving, design before code |
| **#808** | Windows packaging — Electron/Tauri + MQL5 helper EA |
| **#809** | Tiered licensing and feature gating |

### Progress

| Date | Progress |
|---|---|
| 2026-09-12 | MT5 integration direction chosen. Market comparables captured (§2). Utility band $99–199, premium $399–499 established. MQL5 Market cannot list a web app (§5). Tiered model defined (§5b). Issues #806–#809 filed. |
| | ⬜ No packaging work started. ⬜ No MQL5 EA written. ⬜ No tier enforced. ⬜ No price set. |
| | ✅ Decoupling measured: MT5 = 298,005 of ~308,000 bars (~97%); 184 of 242 symbols MT5-only |

---

## 7. Recommended next actions

| # | Action | Why |
|---|---|---|
| 1 | **Answer D9: for sale, or for you?** | Gates the enforcement and pricing decisions. If self-use, §4–§5b are moot. |
| 2 | **Write a minimal MQL5 EA** that calls your backend (part of **#808**) | ⚠️ The single highest-value unknown — proves shape A is achievable or kills it cheaply |
| 3 | **Read MQL5 Market seller rules** | Determines whether an external-dependency product is permitted |
| 4 | **Verify two-leg feasibility** (**#807**) before building the pair signal | ⚠️ Money-moving; MT5 netting vs hedging changes the design fundamentally |
| 5 | **Build the read-only pair signal** (**#806**) | Cheap, no money at risk, produces visible output — and it is the one capability a competitor charges $490 for |
| 6 | **Decide tier enforcement** (**#809**) before pricing | ⚠️ The enforcement limitation must be known *before* a price implies protection that does not exist |
| 7 | **Accumulate edge evidence** (**#777**, edge verdict) | ⚠️ Selling a trading tool with unproven edge is a reputational risk, not just commercial |

### Sequence logic

```
#808 MQL5 EA feasibility  ──▶ decides whether the product can exist
#807 two-leg design       ──▶ decides whether pair trading can exist
#806 pair signal           ──▶ cheap, visible, measurable (no money at risk)
#809 tier enforcement      ──▶ must precede pricing
#777 edge evidence         ──▶ must precede selling
```

### ⚠️ A caution I want on the record

Two of your own instruction files point the same way: *"Development status — pre-release, no
users"* and *"do not report a partial change as complete."* **You have a substantial, well-built
tool with no users and no demonstrated edge.** The market data above does not fix that; it only
tells you what similar products charge. **The adoption question and the edge question are both
bigger than the pricing question.**

---

## 8. Change log

| Date | Change |
|---|---|
| 2026-09-12 | Created. MT5 offered as the integration direction. Comparables captured from the live MQL5 Market (§2). Utility band $99–199, premium $399–499 (§4). Noted MQL5 Market cannot list a web app (§5). |
| 2026-09-12 | **Direction locked:** Windows-only, shape A (desktop + MQL5 helper), tiered model (§5b). **Issues #806–#809 filed.** Decisions D3–D6 closed; D7–D9 open. |

## 9. Related documents

| Document | Purpose |
|---|---|
| `DEPLOYMENT-OPTIONS.md` | The wider option space and the decoupling measurement (superseded on direction, kept for reasoning) |
| `COMPETITIVE-FARMEDHEDGE.md` | Head-to-head against the $490 market leader; established #806/#807 |
| `../.github/handoffs/` → `docs/handoff/` | Handoffs for the work that produced this analysis |
| Issues **#777** (profitability), **#769** (schema drift) | Pre-existing blockers, not duplicated here |
