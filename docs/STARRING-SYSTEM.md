# GitHub Issue: Starring System — Global Favorite Symbols, Procedures & Strategies

## Why
Users need to mark items as important across the app. Starred items appear first in timeline, single symbol view, SEES stacks, and dashboard. Without starring, there's no way to say "these 5 symbols are my focus."

## What
- ⭐ toggle on every symbol, scoring procedure, and trading strategy
- Stored per-user in database (UserStar model)
- Starred items get priority display in:
  - Trading Timeline (Q244)
  - Single Symbol View (Q243)
  - Navigation Dashboard
  - SEES stacks (starred symbols at top)
- Filter toggle on any list: "⭐ Starred" / "All"
- Multi-star: select multiple items in a table → "Star Selected"

## API
- POST /api/stars/toggle — { itemType, itemId }
- GET /api/stars — returns all starred items grouped by type
- GET /api/stars/symbols — just starred symbols
- GET /api/stars/procedures — just starred procedures

## Implementation
- Backend: Q243 includes basic starring
- This issue tracks expanding it to procedures + strategies + UI polish

Labels: ux, data, P1
