## Source

`/automation/execution-queue`

## Problem

The Execution Queue is unclear about what it represents:

### 1. "Execution" naming
Execution usually implies trade activity, but no trades are happening in MT5. What does "execution" mean in this context?

### 2. Inconsistent indicators
- Some events show "HOLD"
- Others show "info"
- These don't seem like the same type of indicator

### 3. Event type confusion
- Most events are "⟳ Tick"
- Some are "⚡ Decision"
- Decision events have a composite score number at the end of the row

## Questions to resolve

1. What does this queue actually represent — tick processing? Decision pipeline?
2. Should "HOLD" and "info" be the same type of status indicator?
3. What does the composite score on Decision events mean?
4. Should the view be renamed to better reflect its purpose?

## Elements

```html
<span class="eq-event-status">HOLD</span>
<span class="eq-event-status">info</span>
<span class="eq-event-type-badge">⟳ Tick</span>
<span class="eq-event-type-badge">⚡ Decision</span>
<span class="eq-event-composite">8</span>
```
