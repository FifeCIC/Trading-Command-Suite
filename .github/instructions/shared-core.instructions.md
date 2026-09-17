---
description: "MANDATORY before writing any UI or scoring code. Prevents accidental duplication of shared utilities that already exist. Maps the canonical import paths for signal logic, API calls, protocol data, and theme tokens."
applyTo: "src/**, nest/src/**"
---

# Shared Core — Import, don't re-implement

**Purpose:** This project has a core utility layer. Before writing any helper function, check whether it already exists here. Duplication wastes tokens, creates maintenance debt, and makes simple changes (e.g. signal thresholds) require edits across 15+ files.

---

## 🚨 Real Example — 2026-08-08

An agent wrote `scoreClass()` and `signalBadge()` as local functions in `SymbolsLadderPage.jsx`. Those same functions already existed in **14 other files** across the codebase:

```
ProtocolsLadderPage.jsx, ProtocolsPerformancePage.jsx, StrategyLaddersPage.jsx,
SeesArenaPage.jsx, ScoringRunsPage.jsx, GoldSpeedTradingPage.jsx,
BtcSpeedTradingPage.jsx, SpeedTradingPage.jsx, SectorRotationPage.jsx,
SpeedChart.jsx, ... (15 files total)
```

The thresholds `>= 65` / `>= 40` were hardcoded identically in every file. If the signal rules change (e.g. Strong Buy/Buy/Hold/Sell/Strong Sell), **15 files** need editing. This is what we avoid.

---

## 📦 Shared Utility Files — Import from here FIRST

| If you need... | Import from... |
|---------------|----------------|
| Signal thresholds, badges, score colours, P&L formatting | `src/core/signal-utils.js` |
| API calls (GET/POST) | `src/core/api/client.js` — `apiGet()`, `apiPost()` |
| Navigation tree (add/remove views) | `src/core/nav-tree.js` |
| View metadata (routes, components, CSS) | `src/core/view-meta.js` |
| View component registration | `src/core/view-routes.jsx` |
| Protocol data hook (protocols + runs + name lookup) | `src/core/useProtocolData.js` |
| Signal display model (signal/tone/state/pct from a score row) | `src/core/score-display.js` — `buildScoreDisplay()` |
| **A `*Pct` reading's standing on the achievable scale** | `src/core/score-display.js` — `thresholdGeometry(pct, scale)` then `standingClass(standing)`. Get `scale` from `fetchScoringThresholds()`. |
| Live classification thresholds | `src/core/api/signals.js` — `fetchScoringThresholds()` → `GET /api/scoring/gated/thresholds` |
| Signal badge component (render a signal from the view model) | `src/components/SignalBadge.jsx` |
| **User-facing message text** (errors, warnings, info, success) | **`src/core/notices/registry.js`** — `notice(code, params)`. Add a **code**, never inline prose. |

---

## 🗣️ Messages — one registry, stable codes (#824)

Every message the app shows a human lives in **`src/core/notices/registry.js`**, keyed by a stable
code (`TCS-TRADE-001`). A call site passes a **code plus data**, never a sentence:

```js
import { notice } from '../../core/notices/registry';

const n = notice('TCS-TRADE-001', { symbol: 'XAGUSD', mode: 'FOK', broker, allowed });
// n.severity · n.title · n.message · n.cause · n.action · n.external · n.refs
```

The server never sends wording — it sends `{ code, params }` and the client renders from the
registry. That keeps one source of text (translation-friendly), and it is why the two roots need no
shared build.

**Why codes, not strings:** wording can be reworded, translated or rewritten without breaking the
link between a log line, a UI card, a test and a GitHub issue. Before this, the identity of a
message *was* its wording — so a typo fix orphaned every reference to it.

**Rules**
1. New message → add a registry entry first. Never inline a user-facing string.
2. Unresolved `{placeholders}` and unknown codes render **loudly**, never blank — a message that
   hides its own defect is worse than none.
3. `scripts/validate-notices.cjs` (runs in the backend `prebuild`) fails on an unregistered code,
   a malformed code, an undeclared placeholder or duplicate params.

```powershell
node scripts/validate-notices.cjs --list   # catalogue
node scripts/validate-notices.cjs --md     # markdown table, for docs/Librarian
```

---

## ⚠️ TWO SCALES — know which one your number is on (#847, measured 2026-09-16)

This is the single most common way a frontend display goes wrong here, and it is **silent**: the
number looks plausible, nothing throws, and the colour is simply wrong.

| Scale | Range in practice | Correct helper |
|---|---|---|
| **0-100 score** — e.g. `signal_rank_snapshot.combinedStrength` | **18-74** | `scoreClass(v)` / `scoreColor(v)` (`signal-utils.js`, bars 65/40) |
| **Percent of configured capacity** (ADR-011) — e.g. `strategy_signal_queue.compositePct`, `signalPct` | **7-17** | `thresholdGeometry(pct, scale)` + `standingClass()` |

**Why it matters, measured:** `compositePct` runs 7-17. Against the 0-100 bars (65/40) that value
can never clear 40, so `scoreClass(compositePct)` returned "low" for **100% of 16 rows** while the
server was calling some of them BUY/STRONG. The fix was not a new number — it was classifying the
percentage against the scale it was actually measured on.

**Rules**
1. **Never pass a `*Pct` value to `scoreClass()` / `scoreColor()`.** They classify the 0-100 scale.
2. **Get the scale from the server** (`fetchScoringThresholds()`), never from a constant. A
   hand-copied bar is exactly what survived the 2026-09-15 rescale and mis-classified the UI (#839).
3. **Unknown scale renders muted, never "low".** `standingClass()` returns `pl-muted` for a null
   `standing`. "We cannot judge" and "this is poor" are different claims — see `score-display.js`.

`nest/scripts/validate-threshold-sources.cjs` fails the build on a module-level numeric threshold
declared anywhere in `src/` outside its declared owner, so the next hand-copied bar is caught.

## 🧠 Design principle — "establish output once"

Pages must NOT decide signal classification, tradeability state, tone, arrow, or
percentage locally. ONE function makes those decisions:

- `src/core/score-display.js` — `buildScoreDisplay(raw)` turns a raw score payload
  (from `/api/scoring/runs` or `/api/scoring/breakdown`) into ONE view model:
  `{ signal, tone, arrow, state, frozen, score, scoreMax, pct, opportunityScore,
     opportunityMax, opportunityPct, marketStatus }`.
- `src/components/SignalBadge.jsx` — the ONE component that renders a signal from
  that view model: `<SignalBadge display={vm} />`.

Rules:
1. **Server owns classification.** `signal` comes from `breakdown.signal`. Never
   re-threshold a percentage client-side — `signalBadge(pct)` is banned.
2. **Tradability is decided once.** `buildScoreDisplay()` derives `state`
   (LIVE | PAUSED | STALE | UNSCORED) from `marketStatus`. A frozen row is rendered
   muted ("⏸ PAUSED") on EVERY page — never a confident green BUY.
3. **Migrate incrementally.** When touching any page that computes `pct`, `closed`,
   tone, or a badge locally, switch it to `buildScoreDisplay()` + `<SignalBadge>`.

---

## 📊 Bar data — one canonical loader; never bypass it (#751)

> ⚠️ **The authoritative invariant list is
> `.github/instructions/meta-stack-contracts.instructions.md`** (IDs `INV-*`, each with a
> build-time guard and a QA entry). This section is the short form for people about to write
> scoring code. If the two ever disagree, the contracts file wins — it is the one that is
> machine-checked, including against this file's checklist below.

**One function owns "give me the newest N bars for a symbol":**

```ts
this.marketData.getBars(symbolId, timeframe, count)   // MarketDataService
```

It filters by `timeframe`, takes the newest `count` rows, and returns them
**oldest → newest** — the order every directive expects. It is already used in 19 places
across 6 modules (automation loop, directives controller, protocol-gating, speed-scan,
signal-envelope).

| ❌ Never | Why |
|---|---|
| `prisma.marketBar.findMany(...)` directly in a scoring/data path | The two hand-rolled queries that existed (#751) had **both** lost the `timeframe` filter, so arrays mixed cadences (e.g. `5m` + `1d`) |
| `orderBy: { timestamp: 'asc' }, take: N` meaning "the newest N" | `asc + take` returns the **OLDEST** N. One of the two hand-rolled queries did this and scored 34 data-rich symbols on ~4-month-old data |
| Passing a `desc` array straight through to directives | Reverses the series — see the ordering contract below |

If you must query directly, copy `MarketDataService.getBars()` exactly, **including the
`timeframe` filter and the `.reverse()`**.

### The ordering contract

`DirectiveInput.bars` is **oldest → newest**, and ~34 directives read
`bars[bars.length - 1]` as the CURRENT bar (current price, candle patterns, session
lookups). A reversed array makes "current price" the **oldest** bar and mis-scores
everything — no error, no warning, just plausible-looking wrong numbers. `DirectivesService`
enforces the order at its boundary (`normalizeDirectiveBars()`), but do not rely on that to
justify a wrong-order array: keep the boundary as the safety net, not the fix.

### Per-protocol cadence

Each protocol declares `recommendedTimeframe` as free text (`'5s–30s'`, `'5m–1h'`,
`'15m–1d'`, …). `selectBaseTimeframe()` in `signals/signal-envelope.service.ts` maps that to
a single cadence (`1m`/`5m`/`15m`/`1h`/`4h`/`1d`); pair it with
`ProtocolDbService.getRequiredBars(protocolId)` for per-timeframe bar counts. Protocols are
already per-timeframe by design (`xau-speed-m5`, `xau-speed-m15`, `xau-speed-1h`), so a
sub-minute scalp protocol must never be judged on higher-timeframe bars.

---

## 🎨 CSS Variables — Theme tokens only

All colours MUST use CSS variables from the theme. Never hardcode a hex value for text, background, or borders.

| Token | Purpose |
|-------|---------|
| `--panel` | Card/panel background |
| `--line` | Borders, dividers |
| `--ink` | Primary text |
| `--ink-soft` | Secondary/muted text |
| `--accent` | Interactive, highlights |
| `--bg` | Page background |

**Hover effect pattern:** `tbody tr:hover { background: var(--line); }` — the same pattern used across all tables.

---

## 🔗 Visual Roadmap Pages

Before making architectural decisions, check these pages (open in browser):
- `/status/meta-stack-pipeline` — canonical pipeline: Watchlists → Protocols → SEES → Scoring Strategies → Trading Strategies → Execution
- `/lab/pipeline-graph-lab` — detailed node view with files, endpoints, and tables per module
- `/lab/diagrams` — conceptual diagrams (⚠️ reference only, may be outdated)

---

## ✅ Pre-coding Checklist

Before writing any new function:
1. **Check signal-utils.js** — does this score/colour/formatting logic already exist?
2. **Check useProtocolData.js** — am I fetching protocols or runs? Use the hook.
3. **Check nav-tree.js** — am I adding a route? Register it properly.
4. **Check view-routes.jsx** — does my component need a VIEW_COMPONENTS entry?
5. **Check `MarketDataService.getBars()`** — am I loading bars? Use it (guarantees the
   `timeframe` filter and oldest → newest order). See the Bar data section above.
