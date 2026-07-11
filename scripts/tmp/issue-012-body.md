## From UI/UX Review (2026-07-11)

### Current State
`http://localhost:5173/lab/scoring-overview` crashes with:
> "Something went wrong rendering this view."
> "Error: Rendered more hooks than during the previous render."

This is a React hooks violation — hooks are being called conditionally or the hook count changes between renders.

### Required Changes
- Fix the hooks ordering issue in ScoringOverview page
- Ensure all hooks are called unconditionally at the top level
- Add error boundary as safety net

### Acceptance Criteria
- [ ] Page renders without crashing
- [ ] No "Rendered more hooks" errors
- [ ] Hooks follow Rules of Hooks (no conditional calls)
- [ ] Error boundary in place

### Related
- Reopened #217 (Theme & UX Standards)
