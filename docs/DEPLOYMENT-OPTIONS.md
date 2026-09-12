# Deployment Options — Tracking Document

> **Created 2026-09-12.** Purpose: track the deployment paths, the measured facts that
> determine which are viable, our progress on each, and the decisions still open.
>
> **Status of this document: MEASUREMENT DONE, DECISION OPEN.** Nothing here is a commitment.
>
> ⚠️ **Read "Measured constraints" before reading the options.** Every option's viability comes
> from those numbers, and three of them were measured on 2026-09-12 rather than assumed.

---

## 1. The hard constraint

```
import MetaTrader5 as mt5
```

`MetaTrader5` is a **Windows-only Python package** that attaches to a **running MT5 terminal on
the same machine** via local IPC. It is not a network API.

| Platform | MT5 possible? | Why |
|---|---|---|
| Windows | ✅ | Native |
| Linux / macOS | ⚠️ | Only via Wine + a real MT5 terminal; unsupported and fragile |
| **Android / iOS** | ❌ | No terminal to attach to |
| **Browser / hosted web** | ❌ | Cannot open local IPC; and it is *per-machine*, not per-user |

**This cannot be engineered around.** Any option that needs MT5 *execution* is Windows-desktop.

---

## 2. Measured constraints (2026-09-12, read-only queries)

### 2.1 Market data is ~97% MT5

| Provider | Routes | Bars | Symbols | Bars (7d) |
|---|---|---|---|---|
| **mt5** | **5** | **298,005** | **184** | **93,426** |
| binance | 4 | 10,175 | 7 | 6,368 |
| yahoo | **0** | 121 | 5 | 0 |

- **242 active symbols. 184 are MT5-only.** binance covers 7; yahoo covers 5 but has **zero
  routes**, so those 121 yahoo bars are orphaned — nothing routes to them.
- **Live scoring runs on 29-30 symbols, all MT5.** The binance symbols hold data but are
  **not in the scoring set**.

### 2.2 There ARE two execution paths, not one

| Adapter | `placeOrder` implemented | Live positions |
|---|---|---|
| `mt5.adapter.ts` | ✅ | 3 |
| `trading212.adapter.ts` | ✅ | **21** |

- **17 of 19 active strategies use `brokerId: mt5`.**
- ⚠️ `trading212` is a **real second broker** with more live positions than MT5. This is the
  single most valuable fact for deployment: it is a **non-Windows execution path that already
  works**.

### 2.3 This is a SINGLE-USER app

Columns named `userId`/`owner` exist on only: `userpreferences`, `userstar`, `watchlist`,
`roadmap_card.ownerAgent`.

**Every trading, scoring, protocol, position and credential table is unscoped.** There is no
tenant boundary anywhere in the schema. A hosted product needs multi-tenancy that **does not
exist** — this is missing architecture, not a missing feature.

### 2.4 Provider adapters present (15)

`alpaca` · `alpha-vantage` · `binance` · `capital-com` · `ecb` · `finnhub` · `fmp` · `fred` ·
`interactive-brokers` · `mt5` · `polygon` · `trading212` · `twelve-data` · `yahoo-finance`

⚠️ **Count ≠ coverage.** Only `mt5`, `binance` and `yahoo` have written any bars. The other 12
are implemented but **unproven against live data**.

### 2.5 The frontend is already deployment-agnostic

The React app talks **only** to NestJS (`localhost:3201`) and never to MT5 directly. MT5 is a
**plug-in**, not the foundation. There is **no PWA manifest** yet.

---

## 3. The options

### Option A — Windows desktop app

| | |
|---|---|
| **Shape** | Electron or Tauri wrapping the existing React app + bundled NestJS |
| **MT5** | ✅ Native, same machine |
| **Effort** | **Low** — the stack is already a local web app |
| **Code protection** | ⚠️ JS is plain text. Needs ASAR + obfuscation, or server-side logic |
| **Updates** | Auto-updater — genuinely easy |
| **Repos** | **Same repo**, extra build target. Not a second repo. |
| **Blocker** | None technical |

### Option B — Hosted web / SaaS

| | |
|---|---|
| **Shape** | Users log into your site; you host everything |
| **MT5** | ❌ **Blocked.** Needs a Windows VM **per user**, each with its own MT5 terminal, broker login and live session |
| **Cost** | ~£10-40/mo **per user** in VPS. This is the business model, not a detail |
| **Security** | You would hold broker credentials — a serious liability |
| **Effort** | **Very high**: multi-tenancy, auth, billing, credential vaulting, per-user MT5 isolation |
| **Status** | ⚠️ **Not "harder deployment" — a different product.** Requires architecture that does not exist (§2.3) |

### Option C — Sell source files (CodeCanyon)

| | |
|---|---|
| **Effort** | **Lowest** — package what exists |
| **Revenue** | One-off, typically £30-80/sale |
| **Fit** | ⚠️ **Poor.** Buyers expect install-and-run; this needs MT5 + MySQL + Python + Node + seeded DB + config editing |
| **Support** | Buyer support forever, per £50 sale |

### Option D — Analysis-only product (NOT YET ASSESSED)

| | |
|---|---|
| **Shape** | Ship the scoring/signals/backtesting UI as a **hosted web app**, no execution |
| **MT5** | ❌ Not required **if** the value does not depend on execution |
| **Effort** | **Medium** — but needs the data problem in §2.1 solved |
| **Blocker** | **Unproven.** See §5 — this is the open test. |
| **Repos** | Same repo |

---

## 4. Answering the specific unknowns

| Question | Measured answer |
|---|---|
| Windows **and** Android the same way? | **No.** Same *codebase* can serve a web UI on Android (PWA), but **execution is Windows-only** |
| Extra files per platform? | Windows: Electron wrapper + installer. Android: PWA manifest + service worker. **Not a rewrite** |
| Does the code get serialised? | **No — JS is plain text.** Real protection = server-side logic, or Electron bytecode/ASAR |
| Separate repos per platform? | **No.** Same repo, extra build targets. Separate repos means fixing every bug twice |
| Update burden | Electron auto-update and PWA are both ~free. **The hosted-SaaS path is the expensive one** |

---

## 5. ⚠️ THE OPEN TEST — the decoupling test

**Question:** does the app deliver meaningful value **without MT5**?

This is the single fact that decides whether Option D (hosted, no Windows) is even open.

| Sub-test | Status |
|---|---|
| Inventory MT5 coupling | ✅ **DONE** — §2 above |
| Can scoring produce meaningful output with only binance data? | ⬜ **NOT RUN** |
| Does the analysis UI work with the bridge stopped? | ⬜ **NOT RUN** |
| Is the app's *value* in analysis or in execution? | ⬜ **UNANSWERED — this is the real question** |

**Interim reading of the measurement:** ⚠️ **This looks bad for Option D.** Scoring currently
runs on 29-30 MT5 symbols only. binance has data for 7 crypto symbols but is **not in the
scoring set**, so "switch off MT5" today means "score 7 crypto symbols' worth of coverage".
Option D requires **adding non-MT5 symbol coverage first**, which is real work with no guarantee
it is commercially interesting.

**This is a strong signal that MT5 is close to load-bearing for the product as it stands** —
which points at Option A. But it is not proven until the test runs.

---

## 6. ⚠️ The finding that may matter most: broker support

You suspected broker support was thin. **It is thinner than "thin":**

| Broker | Execution | Data | Live positions |
|---|---|---|---|
| MT5 | ✅ | ✅ 184 symbols | 3 |
| Trading212 | ✅ | ❌ | **21** |
| Interactive Brokers | ❌ (adapter only) | ❌ | 0 |
| Alpaca / Capital.com | ❌ (adapter only) | ❌ | 0 |
| binance | ❌ | ✅ 7 symbols | 0 |

**Only 2 of 15 adapters can actually execute a trade, and only 3 of 15 have ever written a bar.**

### Why this is the most important number for commercial viability

⚠️ **Retail traders use the broker their account is with.** If a prospective buyer uses
Pepperstone, IC Markets, Saxo, OANDA, XTB, IG, eToro, AvaTrade, FXCM, or a bank — **this app
cannot trade for them.** MT5 covers many of those *via the terminal*, which is why MT5 is so
valuable — but that in turn **re-introduces the Windows constraint**.

So there is a genuine strategic tension:

| Want | Requires | Cost |
|---|---|---|
| Broad broker support | MT5 (the universal bridge) | Windows-only |
| No Windows | Non-MT5 brokers | Very narrow broker list |

**This tension, not the packaging, is the real deployment problem.**

---

## 7. Decisions open

| # | Decision | Blocked by |
|---|---|---|
| D1 | Which option (A / B / C / D)? | The decoupling test (§5) |
| D2 | Is the product's value analysis or execution? | Nobody has asked this directly |
| D3 | Broaden broker support, or accept MT5-only? | Commercial intent (sell vs self-use) |
| D4 | If selling: source files or licensed app? | D1 |
| D5 | Does multi-tenancy get built at all? | D1 — only Option B needs it |

---

## 8. Recommended order of work

> ⚠️ **SUPERSEDED 2026-09-12.** The direction is now decided: **Windows-only MT5 integration
> offering**, tiered commercial model. See **`DEPLOYMENT-MT5-OFFERING.md`** (decisions D1–D9,
> tier model §5b) and **`COMPETITIVE-FARMEDHEDGE.md`**. This section is kept for the reasoning.

1. **Run the decoupling test properly** (§5) — the cheapest thing that eliminates whole options.
2. **Decide analysis vs execution** (§7 D2) — a conversation, not engineering, and it gates D1.
3. **Establish broker intent** (D3) — who is the buyer, what do they trade on?
4. **Only then** pick an option and build.

⚠️ **Do NOT start on multi-tenancy, packaging, or a second repo** before D1–D3 are settled.
Each is expensive and each is wasted if the answer changes.

### Outcome of step 1 (measured 2026-09-12)

The decoupling question is **answered**: MT5 carries **298,005 of ~308,000 bars (97%)** and
**184 of 242 symbols**. Live scoring runs on **29–30 symbols, all MT5**. Option D (hosted,
no Windows) is therefore **not viable without first building broad non-MT5 symbol coverage** —
which is why Windows-only was chosen instead.

---

## 9. Change log

| Date | Change |
|---|---|
| 2026-09-12 | Created. MT5 coupling measured (§2). Boundary probe run. Option D identified as untested. |
