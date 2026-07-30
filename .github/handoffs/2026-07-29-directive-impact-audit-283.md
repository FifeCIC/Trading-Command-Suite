# Handoff — Directive Impact Audit (#283) — 2026-07-29

## What Changed
Built a directive performance auditing system that ranks all 104 directives by real-world impact — which ones contribute the most AND move the most with the market.

### Backend: DirectiveImpactService
- `nest/src/modules/scoring/directive-impact.service.ts` — new service
- Reads Score table snapshots, extracts per-directive contributions from breakdown JSON
- Computes per directive: avgContribution, maxContribution, volatility (stddev), hitRate, trend (linear regression slope)
- **Impact Score** = avgContribution × volatility — combines magnitude + movement
- Tier classification: heavyweight (≥500), mover (100–499), steady (20–99), lightweight (<20)
- Endpoint: `GET /api/scoring/directive-impact/:symbol?window=10`

### Frontend: DirectiveImpactAuditPage
- `src/pages/DirectiveImpactAuditPage.jsx` + `.css` — new page
- Sortable, filterable table with all directives ranked by impact
- Controls: symbol input, window size selector, sort field, tier filter
- Summary bar showing tier distribution + top protocol candidates
- Visual impact bar per directive
- Color-coded readiness dots, tier badges, trend indicators
- Registered in nav-tree (Scoring → Impact Audit) and view-routes

### Sample Results (XAUUSD, 10-snapshot window)
| Rank | Directive | Impact | Tier |
|------|-----------|--------|------|
| 1 | Budget Gate | 1515 | Heavyweight |
| 2 | Bollinger Band Squeeze | 1389 | Heavyweight |
| 3 | Target Achieved | 990 | Heavyweight |
| 4 | Gold Session Profile | 957 | Heavyweight |
| 5 | Engulfing Pattern | 898 | Heavyweight |

11 heavyweight, 43 mover, 20 steady, 30 lightweight directives identified.

## Files Changed
- `nest/src/modules/scoring/directive-impact.service.ts` — new
- `nest/src/modules/scoring/scoring.module.ts` — registered service
- `nest/src/modules/scoring/scoring.controller.ts` — added endpoint
- `src/pages/DirectiveImpactAuditPage.jsx` — new
- `src/pages/directive-impact-audit.css` — new
- `src/core/nav-tree.js` — added nav entry
- `src/core/view-routes.jsx` — registered route

## Verification
- NestJS build: **zero errors**
- Vite build: **zero errors**
- Endpoint tested: returns real impact data for XAUUSD

## Related
- Closes #283
- Enables protocol building with high-impact directive groupings

## User Intent
The user wants to group heavyweight directives into protocols for bigger score swings. The "Top Protocol Candidates" in the summary bar shows the best directives to combine.
