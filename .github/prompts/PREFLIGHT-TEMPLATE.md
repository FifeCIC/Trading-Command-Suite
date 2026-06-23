---
description: "Standard pre-flight checks that every implementation prompt must include before building. This prevents duplicate work, architecture drift, and confusion about what already exists."
appliesTo: ".github/prompts/**"
---

# Prompt Pre-Flight Template

Every implementation prompt MUST include this section at the top, before any implementation instructions.

```markdown
## Pre-Flight Checks

Before implementing, verify:

1. **Architecture Framework** — Load `/builder/architecture-framework` or read `src/pages/architecture-framework.data.js`.
   - Check `REVISION_LOG` for changes in the last 7 days to the affected area.
   - Check `CURRENT_SLICE` to confirm what already exists vs what's planned.
   - Check `CURRENT_ROUTE_CONTRACTS` for existing API endpoints.

2. **Capability Map** — Load `/status/capability-map`.
   - Confirm the feature isn't already covered by an existing subsystem.

3. **Existing Pages** — Check `src/core/nav-tree.js` and `src/App.jsx`.
   - Does a page already exist for this? Is there a route conflict?

4. **Existing Endpoints** — Query `GET /api/architecture/manifest` or check controller files.
   - Does an endpoint already serve this data? Could it be reused instead of duplicated?

5. **Existing DB Models** — Check `nest/prisma/schema.prisma`.
   - Is there already a model for this concept? (`Strategy`, `Protocol`, `TradingStrategy`, etc.)

6. **Active Claims** — Check `.agenticmemory/prompts/` for `CLAIM__` prefixed files.
   - Has someone else already claimed this work?

## Post-Implementation

After building, verify:
- [ ] `REVISION_LOG` updated with what was done
- [ ] Architecture Framework updated if routes/contracts changed
- [ ] No duplicate pages, endpoints, or data sources created
- [ ] Cross-linked from related pages (e.g., trading page links to protocols page)
```

## Why This Matters

Without pre-flight:
- **2026-06-23 example:** Two different protocol lists existed (`/scoring/protocols` and the trading page's scoring tab) because the trading page was built without checking what already existed.
- **Architecture drift:** The Architecture Framework claimed "Automated daily trading scheduler — done" when it was a stub with hardcoded data.
- **Forked implementations:** `TradingSchedulerService` (stub) and `TradingStrategyService` (real) both exist without coordination.

With pre-flight, each prompt author confirms what exists before adding anything new.
