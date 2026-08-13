---
date: 2026-08-13
area: scoring
type: feature
---

## What Changed

Added a Directive Viewer page — a single-directive deep-dive reachable from Protocol Trail directive rows. It shows directive metadata (name, active/readiness/nature, category, priority, max score, version, direction bias), a recent-scores table, and the list of protocols that include the directive.

## Files Changed

- nest/src/modules/directives/directives.controller.ts — new GET /api/directives/:id/viewer endpoint (directive metadata + recent per-directive scores from Score.breakdown.breakouts + protocols via protocol_directive_entry)
- src/pages/DirectiveViewerPage.jsx — new page (reads ?id=, fetches the viewer endpoint)
- src/pages/directive-viewer.css — page styles
- src/core/view-routes.jsx — registered 'directive-viewer' view
- src/core/nav-tree.js — added "Directive Viewer" to the Protocols nav
- src/pages/ProtocolTrailPage.jsx — directive rows now deep-link to the viewer
- src/pages/decision-trail.css — .pt-directive-link styling

## Capability Map Entry

- **name:** Directive Viewer
- **persistence:** ephemeral
- **uiSurfaces:** 1
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** Directive Viewer shows detail, scores, and protocols
- **procedure:** Open /protocols/protocol-trail?symbol=XAUUSD&protocol=xau-speed-v1 and click a directive row, or open /protocols/directive-viewer?id=liquidity-check directly.
- **expected:** Page shows the directive name + status/readiness/nature badges, metadata grid (category, priority, max score, version, protocol count), a recent-scores table (symbol/protocol/score/signal/time), and a "Used in protocols" list with per-protocol group badges.

## Architecture Framework Entry

- **section:** routes
- **summary:** Directive Viewer — single-directive deep-dive at /protocols/directive-viewer?id=<directiveId>. Backed by GET /api/directives/:id/viewer which returns directive metadata, recent per-directive scores (extracted from Score.breakdown.breakouts[].directiveId), and the protocols that include the directive (protocol_directive_entry → group → protocol). Protocol Trail directive rows deep-link to it.
