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
| Signal badge component (render a signal from the view model) | `src/components/SignalBadge.jsx` |

---

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
- `/lab/meta-stack-pipeline` — canonical pipeline: Watchlists → Protocols → SEES → Scoring Strategies → Trading Strategies → Execution
- `/lab/pipeline-graph-lab` — detailed node view with files, endpoints, and tables per module
- `/lab/diagrams` — conceptual diagrams (⚠️ reference only, may be outdated)

---

## ✅ Pre-coding Checklist

Before writing any new function:
1. **Check signal-utils.js** — does this score/colour/formatting logic already exist?
2. **Check useProtocolData.js** — am I fetching protocols or runs? Use the hook.
3. **Check nav-tree.js** — am I adding a route? Register it properly.
4. **Check view-routes.jsx** — does my component need a VIEW_COMPONENTS entry?
