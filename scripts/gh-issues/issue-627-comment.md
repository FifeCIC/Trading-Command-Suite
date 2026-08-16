## Pre-Close Verification

- [x] **An active protocol cannot contain a non-`ready` directive** — `isDirectiveReady()` in `nest/src/modules/directives/directive-inclusion.ts` is the single source of truth; `assessReadiness()` in `protocol-gating.service.ts` gates scoring; `automation-loop.service.ts` skips non-ready protocols with a logged reason (`Protocol "X" PAUSED — non-ready directives: …`).
- [x] **Registry/UI shows WHY a protocol is gated** — the protocol registry returns per-protocol `readiness {ready, blockers}`; `readinessGate` (with `blockers` + `reason`) is persisted into the canonical score `breakdown` and surfaced in the Protocol Trail.
- [x] **Build passes** — `npm --prefix nest run build` compiles clean.

Result: `7 of 16 active protocols ready for scoring` — 9 paused, each with its blockers named in the UI.
