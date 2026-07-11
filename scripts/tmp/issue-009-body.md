## From UI/UX Review (2026-07-11)

### Current State
`http://localhost:5173/lab/component-lab` — needs real content.

### Required Changes
Create a range of components using **real data** from:
- Database (Prisma/MySQL)
- MT5 bridge

Components should demonstrate:
- Data-bound tables
- Live-updating indicators
- Status cards with real position data
- Charts fed by actual market data

### Acceptance Criteria
- [ ] 4+ components consuming real API data
- [ ] Components use Notice + StatusBadge where applicable
- [ ] Loading, empty, and error states handled
- [ ] Components documented for reuse

### Related
- Reopened #217 (Theme & UX Standards)
- #225 (Charts Lab — prior art for data-bound components)
