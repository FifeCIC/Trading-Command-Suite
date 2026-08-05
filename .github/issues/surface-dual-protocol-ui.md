## Problem

Dual-protocol scoring (LONG + SHORT protocols, `shortProtocolId`) is **fully implemented in the backend** but has **zero visibility in the UI**. The Diagrams page has a concept diagram, but no interactive UI surface shows:

- Whether a trading strategy is single or dual protocol
- Which short protocol is paired (the `shortProtocolId`)
- That dual-protocol enables **hedging** (compare long vs short and pick the winner)

This feature is a potential differentiator for sophisticated hedging strategies, but it's invisible to users and agents alike.

## Current state

**Backend (wired):**
- `ScoringStrategy.shortProtocolId` — stored, queried, scored
- `compareProtocolPair()` — dual-path with threshold enforcement
- `AutomationLoopService` — scores both protocols per tick, picks the stronger side

**Frontend (NOT wired):**
- **No** `shortProtocolId` in any strategy form, card, or detail page
- **No** visual indicator of single vs dual on strategy cards
- The Diagrams page shows the concept (`Protocol Pair LONG + SHORT`) but it's static

**Docs:**
- Architecture Framework mentions it (#327, directionality)
- But no end-user documentation explains dual-protocol as a hedging feature

## Tasks

### Backend verification
- [ ] Confirm `shortProtocolId` is returned in all strategy endpoints (GET /api/trading/strategies, /automation/status)
- [ ] Confirm the field exists on TradingStrategy and ScoringStrategy responses
- [ ] If not, add it to the response shapes

### Frontend — surface single/dual protocol state
- [ ] Add a visual indicator on strategy cards showing `Single` / `Dual` protocol type
- [ ] Show the paired short protocol name/slug on dual-protocol strategy cards
- [ ] Add a `shortProtocolId` selector in Create/Edit Strategy forms (only when direction=BOTH)
- [ ] Consider a "Hedge Mode" toggle that switches between single and dual protocol

### Documentation
- [ ] Add a section in USER_GUIDE.md or a new guide explaining:
  - Single-protocol: one protocol sets direction (most strategies)
  - Dual-protocol: long vs short comparison, higher composite wins (hedging capable)
  - How to configure a dual-protocol strategy
  - When to use dual-protocol (hedging, market-neutral strategies, A/B testing)

## Why this matters

Dual-protocol strategies are the foundation for **hedging** — you score an asset with both a long-biased and short-biased protocol, and let the stronger one trade. This is a genuinely sophisticated feature for a retail trading app. Without UI support, it's code that exists but nobody knows about.
