## Source

`/trading/market-context`

## Problem

Market Context is a standalone page. Its content should be modular and reusable — displayed on multiple surfaces.

## Expected

### Phase 1: Modularize
Break Market Context content into reusable, embeddable components/widgets.

### Phase 2: Surface on Dashboard
Add Market Context widgets to `http://localhost:5173/dashboard`.

### Phase 3: Surface on Triple Screen (Pipeline)
Add as the **first column** in the META.Stack pipeline triple-screen layout (non-modular version).

### Phase 4: Delete standalone page
Once the content is verified as available and useful on Dashboard + Triple Screen, delete the standalone `/trading/market-context` page, route, and nav entry.

## Dependency

This depends on the Triple Screen redesign (pipeline layout) being completed first.
