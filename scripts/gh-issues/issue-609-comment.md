## Pre-Close Verification

- [x] **Protocol detail panel shows list of directives with current weights** — "Directive Weights" section in `ProtocolsPageB.jsx` (the default Page B variant), rendering each directive's name + effective maxScore.
- [x] **Weight source badge (global vs override) visible** — each row shows a `global` / `override` badge; flips to `override` when a protocol key exists.
- [x] **Click directive to edit weight inline** — Edit button opens an inline input (pre-filled with the current effective value) + Save/Cancel.
- [x] **Save writes to DB with proper key pattern** — `PATCH /api/scoring/protocols/:slug/directive-config` writes `protocol:{slug}:{directiveId}:maxScore` to `global_setting`. Verified: PATCH speed-momentum → 180 persisted, effective 180, total 1150→1210.
- [x] **Reset removes the override key** — `DELETE /api/scoring/protocols/:slug/directive-config/:directiveId` deletes the keys. Verified: DELETE → back to global 120, total 1210→1150.
- [x] **Total Weight recalculates after changes** — endpoint returns `totalWeight`, and the UI stat + section total update from the config response.
- [x] **Builds clean** — NestJS `tsc` passes; Vite build passes (`✓ built in 1.98s`).

> Note: the issue's API table wrote `/api/protocols/:slug/directive-config`; the actual route is `/api/scoring/protocols/:slug/directive-config` (the existing `ProtocolsController` prefix). Behaviour matches the spec otherwise.
