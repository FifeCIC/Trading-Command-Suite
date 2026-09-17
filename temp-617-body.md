## Problem

The app has grown many small configuration points and switches scattered across endpoints, feature flags, DB tables, and environment variables. There is no unified view of what a user can change, and no sense of which options matter.

As META.Stack matures, the number of tunable options will grow into the hundreds. Most will be minor and insignificant for the majority of users ÔÇö but a handful are critical (trading enable, risk limits, thresholds). We need a deliberate design for how settings are surfaced.

## Goal

Produce a complete inventory of every user-changeable setting/configuration in the app, then decide:

1. **What belongs in the Settings area** (critical, frequently-used)
2. **What belongs on dedicated feature pages** (extensive feature-specific config)
3. **What should stay hidden** (advanced/developer-only, via config file or advanced section)

## Scope of the Audit

Inventory settings from ALL of these sources:

### 1. Feature flags & preferences
- `featureFlags` (frontend store)
- `localStorage` user preferences (`tcs:preferences`)
- `userpreferences` DB table
- `appsetting` / `global_setting` DB tables

### 2. Backend config & env
- `.env` / `.env.local` (NestJS ConfigModule)
- Provider credentials (API keys)
- Broker config (tradingEnabled, thresholds, intervals)
- `broker_config` DB table

### 3. Trading / risk controls
- Per-broker `tradingEnabled`, `tradeThreshold`, `requireConfirmation`, `scoreIntervalMs`
- Global risk multiplier
- `trading_strategy` fields (minComposite, slPct, tpPct, baseSize, cooldown)
- `scoring_strategy` fields (tradeThreshold, weightStrategy)
- Risk limits (max position size, max daily loss, max open positions)

### 4. Scoring / directives
- Protocol active/inactive toggles
- Directive active/inactive toggles
- Directive weights / maxScore overrides
- Calibration entries (`symbolcalibration`)

### 5. Theme / UI
- Theme packs, theme mode
- Layout preferences (font scale, contrast, focus indicators)
- Navigation visibility by experience level

## Design Principles to Apply

1. **Critical switches must be prominent** ÔÇö trading on/off, risk limits, global thresholds should be one click away, not buried in an advanced section.
2. **Group by importance** ÔÇö e.g. "Critical", "Common", "Advanced" tiers, or by area with prominence weighting.
3. **Separate areas/pages for extensive features** ÔÇö a feature with 20+ options gets its own page (e.g. a "Risk" page), with only its top 2-3 controls surfaced in main Settings.
4. **Minor options hidden by default** ÔÇö advanced/rarely-touched options behind an "Advanced" toggle or config file.
5. **Safe defaults documented** ÔÇö every setting should state its default and whether it resets on restart.

## Deliverables

- A settings inventory document (Google Drive docs folder, per repo convention)
- A proposed information architecture: which settings go to Settings area vs dedicated pages vs advanced
- Implementation plan (can be phased)

## Acceptance Criteria

- [ ] A complete inventory of changeable settings exists — **NOT DONE** (extracted to #849: this issue's implementation audited the Settings *area* and classified it by META.Stack layer; it did not inventory `.env`, `global_setting`, `broker_config`, `trading_strategy`, directive weights or `symbolcalibration`)
- [ ] Each setting has an importance tier and a proposed home — **NOT DONE** (same scope, same extraction: #849)
- [x] Critical settings are prominent in the Settings area — the META.Stack layer kill switches now lead the rail under "META.Stack Layers" and each appears on the page it governs
- [x] Minor settings are not cluttering the main Settings view — General went from 13 sections to 4; the other 9 moved to a page that answers the same question

## Status — 2026-09-16

**Implemented (this issue is closable for its IA half).** Settings is now one page per
META.Stack layer question:

| Page | Answers | Holds |
|---|---|---|
| General | "what is plumbing?" | API Connection, Security, Health & Diagnostics, + a "where things went" index |
| Appearance | "what does the app look like?" | Theme, Display, Market Tape, Performance, Refresh intervals |
| Trading | "what does each bot do?" | bots (bar vs achieved), manual trade defaults, risk limits, trading layer switch |
| Scoring | "what counts as a signal?" | scoring layer switch, trade thresholds, per-bot bars, scoring defaults |
| Automation | "is the loop running, and what's in it?" | loop control, layer inclusion switches, bot queue, automation rules |

**Found while doing it, and fixed here:**

- `GET /api/trading/strategies/risk-limits` was declared below `@Get(':id')`, so it was
  shadowed and returned **200 with an empty body** for its whole life — the "Server-Enforced
  Hard Limits" panel could never render. Fixed; now returns JSON and the panel renders.
- `apiPost('/api/automation/layer', …).catch(() => {})` made a failed layer switch
  indistinguishable from a successful one — including the safety-critical trading-OFF
  direction. Now surfaces the error.
- The Automation Rules toggle called `apiGet(url, { method: 'PUT' })`; `apiGet` takes one
  argument, so the button issued a GET and changed nothing. Now uses `apiPut`.
- The "no view selected" fallback used `views[0].id`; Settings is the first area to open with
  a `section-header` entry, which has an `id` but no page. Now skips headers.
- #722's bot-queue settings (`GET/POST /api/automation/bot-queue`) had no UI at all; they are
  now on Settings → Automation.

**Not done:** the exhaustive inventory and importance tiers. Extracted to **#849** rather than
ticked, because #617's audit scope (all five source groups, tier per setting) is a different
piece of work from the information architecture.

## Related

- #615 META.Stack control plane (layer kill switches ÔÇö a subset of this audit)
- 2026-08-13 discussion on app controls and settings prominence

