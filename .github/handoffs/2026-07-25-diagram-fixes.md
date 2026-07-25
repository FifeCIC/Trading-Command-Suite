---
date: 2026-07-25
area: docs
type: docs
---

## What Changed

Fixed 3 inaccurate diagrams and added 4 new ones to DiagramsPage (now 31 total, up from 27). All diagrams now reflect the actual codebase architecture.

## Files Changed

- `src/pages/DiagramsPage.jsx` — 3 diagram bodies replaced, 4 new diagrams inserted before `];`

**Fixed diagrams:**

1. **scoring-gating** — Replaced hardcoded BUY≥65/HOLD≥35/SELL<35 thresholds (never existed in code) with the actual 3-layer per-strategy threshold architecture: global ENTRY_THRESHOLD=40/HOLD_FLOOR=20 label classification + per-protocol style defaults (scalp=75, day=65, swing=55, pos=45) + per-strategy `tradeThreshold` from `scoring_strategy` table. Added group-weighted vs maxscore-weighted duality and directive memoization cache (#408).

2. **data-flow-architecture** — Removed false "zero usage" labels from MacroSnapshot, SocialMention, and InsiderTransaction. All three are actively used in the scoring pipeline (macro-snapshot.service.ts, social-buzz.directive.ts, insider-activity.directive.ts). Replaced "32 Protocols" with "Protocols — DB-driven via ProtocolDbService".

3. **sees-automation** — Replaced hardcoded counts ("42 protocols, 7 ScoringStrategies, 35 TradingStrategies") with "DB-driven — varies per deployment". Replaced "99+ Directives" with "DB-Sourced Directives".

**New diagrams:**

4. **memoization-cache** — Directive Memoization Cache (#408): tickCache Map prevents re-executing the same symbol+bar-signature within a tick. Shows the 67% reduction from 3000 to 1000 directive runs per tick.

5. **db-vs-hardcoded** — DB-Driven vs Hardcoded Architecture: shows current hardcoded state (102 register() calls, 36 PROTOCOL_REGISTRY entries) vs target DB-driven state (Epic #510), with the hard line that algorithm code never goes in DB.

6. **priority-queue-dispatch** — Priority Queue + Mode Dispatch: Hot Stock Picks boost to front, manual/semi-auto/auto mode divergence, safety gates (cooldown, duplicate, diversification) applied before dispatch.

7. **dual-protocol-fallback** — Dual-Protocol Scoring Fallback: compareProtocolPair() both paths — dual LONG vs SHORT comparison and single-protocol fallback (trusts signal field directly).

## QA Test Entry

- **area:** UI / Diagrams
- **name:** Verify all 31 diagrams render without errors
- **procedure:** Navigate to /lab/diagrams. Click through each diagram in the sidebar. Verify Mermaid renders without "Diagram rendering failed" fallback text.
- **expected:** All 31 diagrams render correctly. No Mermaid syntax errors in console.

## Architecture Framework Entry

- **section:** docs
- **summary:** DiagramsPage has 31 Mermaid diagrams covering all major subsystems. Diagrams are now accurate to actual code — threshold values, data flow, and component counts match runtime reality. 4 new diagrams cover memoization, DB migration path, dispatch modes, and dual-protocol fallback.
