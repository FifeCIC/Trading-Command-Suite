## From UI/UX Review (2026-07-11)

### Current State
`http://localhost:5173/` shows System Status, Trading Workflow menu, Supporting Areas menu, and other elements.

### Required Changes
1. **`/` (Home):** Show SYSTEM STATUS only. Move the logo to the center. Make it appear more like a login/landing page (no actual login needed yet).
2. **Move menus:** Relocate TRADING WORKFLOW and SUPPORTING AREAS navigation to `/dashboard` (change route from `/dashboard/home` to just `/dashboard` — drop "Home" as it's too website-like).

### Acceptance Criteria
- [ ] `/` shows only System Status with centered logo
- [ ] Trading Workflow + Supporting Areas nav lives at `/dashboard`
- [ ] Route `/dashboard/home` → `/dashboard`
- [ ] No broken navigation links

### Related
- Reopened #217 (Theme & UX Standards)
