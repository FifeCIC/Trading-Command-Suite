## Pre-Close Verification

- [x] **`protocols-seed-data.ts` contains no per-protocol `directiveMaxScores`** — stripped all 124 blocks + the `SeedProtocolGroup` interface field. A safety cross-check confirmed all 69 seed `directiveId`s resolve to a registered directive class before stripping (so the class value always wins).
- [x] **Re-seeding produces class maxScores** — `POST /api/scoring/gated/protocols/seed` → 43 protocols / 124 groups / 429 entries; `node nest/scripts/verify-seed-maxscores.cjs` confirms every `protocol_directive_entry.maxScore` equals its directive class maxScore.
- [x] **Orphaned entries pruned** — 5 `earnings-proximity` rows (orphaned by the #626 protocol cleanup; no longer in any seed `directiveIds`) were deleted so the DB has no stale maxScore rows.
- [x] **Build passes** — `npm --prefix nest run build` compiles clean; backend restarted and re-seeded successfully.
