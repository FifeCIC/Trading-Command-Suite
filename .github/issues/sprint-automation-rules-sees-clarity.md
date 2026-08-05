## Source

`/automation/automation-rules`

## Problem

### 1. SEES Score label unclear
The title "Minimum SEES Score" and value "0-100" doesn't make it obvious this is a percentage. For "dummies" clarity:

**Rename to:** "Minimum SEES Aggregate Score (%)"
**Display:** Value with % symbol

### 2. Missing Threshold setting
The view shows Minimum SEES Score but doesn't expose the Threshold setting (currently 60). This option needs to exist.

### 3. Not synced with Settings
These automation rules should be synced with the main Settings area. Any change here should reflect in Settings and vice versa. This applies to ALL areas of the app.

## Elements

Current:
```html
<h3>Minimum SEES Score</h3>
```

Should be:
```html
<h3>Minimum SEES Aggregate Score (%)</h3>
```

Also referenced:
```html
<div class="pf-account-detail">
  Minimum SEES Score  Require a minimum aggregate SEES score before...
</div>
```
