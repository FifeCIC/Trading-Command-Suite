---
date: 2026-08-26
area: scoring
type: feature
---

## What Changed

Protocol Theory (#689) first slice — protocols now carry a written `theory` (target behaviour, why these groups, what a good day looks like, known weaknesses). Seeded for 9 protocols including the four diagnosed-silent index protocols; shown as a "Theory" section on the Protocols Registry (both A and B variants); long-form reading in Drive `docs/theories/PROTOCOL-THEORY.md`.

## Files Changed

- `nest/prisma/schema.prisma` — `theory String? @db.Text` on Protocol
- `nest/src/modules/scoring/protocol-db.service.ts` — theory read via raw SQL in getAllProtocols + findBySlug; ProtocolConfig.theory
- `nest/src/modules/scoring/protocol-gating.controller.ts` — `theory` on GET /api/scoring/gated/protocols response
- `src/pages/ProtocolsPage.jsx` / `src/pages/ProtocolsPageB.jsx` — Theory section on both registry variants
- `src/pages/protocols-page.css` / `protocols-page-b.css` — theory panel styles
- `scripts/db/protocol-theory-seed.sql` — idempotent seed: ALTER + UPDATE for 9 protocols

## Capability Map Entry

- **name:** Protocol Theory (written intent on protocols)
- **persistence:** stored
- **uiSurfaces:** 1
- **pipeline:** scoring
- **completion:** partial (9 of 42 protocols seeded)

## QA Test Entry

- **area:** Scoring / Protocols
- **name:** Theory section renders on the registry for seeded protocols
- **procedure:** Open /protocols/protocols-registry (variant A and B) → select "Gold Speed Scalp V1" → look for the Theory panel under the description
- **expected:** Theory panel shows the gold speed family intent text; unseeded protocols show no panel

## Architecture Framework Entry

- **section:** data
- **summary:** protocol.theory column (#689) — written intent stored on the protocol, surfaced on the registry and documented in Drive docs/theories/PROTOCOL-THEORY.md. Changes to a protocol's directive groups must update its theory.
