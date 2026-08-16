---
date: 2026-08-16
area: scoring
type: feature
---

## What Changed

Enforced the user policy "if a directive is not ready, the protocol is not ready and should not be active" in code. A protocol is only eligible to score when every included directive has `readiness === 'ready'`; otherwise it is paused and the reason is surfaced to the UI.

## Files Changed

- nest/src/modules/directives/directive-inclusion.ts — added `isDirectiveReady()` (single source of truth)
- nest/src/modules/scoring/protocol-gating.service.ts — added `assessReadiness(protocolId)`; `scoreWithGating` returns a `readinessGate {ready, blockers, reason}` persisted into the score breakdown
- nest/src/modules/scoring/protocol-gating.controller.ts — registry returns per-protocol `readiness {ready, blockers}`
- nest/src/modules/automation/automation-loop.service.ts — skips non-ready protocols with a logged reason

## Capability Map Entry

- **name:** Directive readiness gate
- **persistence:** ephemeral
- **uiSurfaces:** 1 (Protocol Trail)
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Directives
- **name:** Non-ready directive pauses its protocol
- **procedure:** GET the protocol registry; confirm a protocol containing a `beta`/`alpha` directive reports `readiness.ready=false` with the blocker named.
- **expected:** Paused protocol shows its blocking directive; automation loop logs "PAUSED — non-ready directives".

## Architecture Framework Entry

- **section:** scoring
- **summary:** Readiness gate — `isDirectiveReady()` is the single source of truth; `assessReadiness()` gates scoring so a protocol with any non-ready directive is paused. Registry surfaces `{ready, blockers}` to the UI.
