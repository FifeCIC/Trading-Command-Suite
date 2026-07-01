# Directive Strategy Validation

## Overview
Prevent directives from being disabled when they are part of active trading strategies.

## Requirements
- Check if directive is used in any active strategies before allowing disable
- Display warning message if directive is part of active strategy
- Provide option to disable strategy first or force disable directive
- Update Configure Directives interface to show strategy dependencies

## Implementation Tasks
1. Create strategy dependency checker function
2. Add validation to directive toggle handler
3. Update UI to show strategy usage indicators
4. Add confirmation dialog for force disable option

## Priority
Medium - Safety feature to prevent accidental strategy disruption

## Related Documentation
- `docs/systems/SCORING-SYSTEM.md`
- `docs/systems/DIRECTIVE-TESTING-STRATEGY.md`

## Notes
This prevents users from accidentally breaking active trading strategies by disabling required directives.

---
**Migrated from:** TradePress-Documentation/roadmap/directive-strategy-validation.md
**Target:** Trading Command Suite (SEES feature)
