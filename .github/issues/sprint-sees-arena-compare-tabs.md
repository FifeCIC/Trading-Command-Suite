## Source

`/scoring/sees-arena`

## Problem

The SEES Arena has a "Compare Protocols" tab but clicking Compare doesn't create a persistent tab — results are lost when switching away. Users need to:
1. Configure a comparison
2. Have it open in a new named tab
3. Keep multiple comparisons open simultaneously
4. Delete tabs when done

## Expected

### New tab on Compare
When the user clicks Compare, create a new tab beside "Compare Protocols" with a simple auto-generated name (e.g., "Compare 1", "Compare 2", or based on selected protocols).

### Tab management
- Ability to delete/close individual tabs
- Move the Summary results into the new tab (instead of appearing below the controls)

### Persistence
- Save tab configurations to the database so they survive page reloads
- This requires a new database table for arena comparison configurations

### Discussion point
Is this actually part of the A/B testing system? The SEES Arena is fundamentally a comparison tool. It may need its own table rather than piggybacking on A/B test infrastructure, but the relationship should be considered.

## Elements

Current tab:
```html
<button class="sa-tab sa-active">Compare Protocols</button>
```

Summary (should move into new tabs):
```html
<strong>Summary</strong>
```
