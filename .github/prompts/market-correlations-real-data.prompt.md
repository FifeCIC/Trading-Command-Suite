# Market Correlations — Real Data, Demo Removal & Signal Impact

Status: discussion
Created: 2026-06-30

## Current State
- Grid changes quickly — likely demo/simulated data
- Pair Comparison menus change the Correlation Matrix — not clear why
- Graph visualization (scatter) exists but isn't explained
- Tight green dots suggest close correlation — maybe that's the intended reading

## Clear Actions

### 1. End Demo Data
- [ ] Identify whether the correlation data is simulated
- [ ] If demo, remove simulation and show "No data yet — awaiting real correlation computation"
- [ ] Only show data when real correlations have been computed from market data

### 2. UI Explanation
- [ ] Add explanatory text: what positive/negative correlation means for a long position
- [ ] Label the scatter plot axes
- [ ] Add tooltip on hover explaining what each dot represents
- [ ] Color-code: green = positive correlation (move together), red = negative (move opposite)

### 3. Pair Comparison Menu Behavior
- [ ] Investigate why changing Pair Comparison triggers Correlation Matrix changes
- [ ] These should be independent — the matrix shows all pairs, the comparison zooms into one

## Discussion Points

### 1. Unique Correlation Behaviors
Do some correlations have their own unique behavior?
- Gold/USD: typically inverse
- Oil/CAD: commodity-driven correlation
- VIX/SPX: fear gauge — near-perfect inverse
- Crypto correlations: regime-dependent (risk-on vs. risk-off)

Should these be modeled as known relationships vs. purely statistical?

### 2. Signal & Trading Integration
This data supports features that help make good signals and trading decisions:
- Correlation drag directive (already exists — does it use this data?)
- Portfolio-level risk: are my positions too correlated?
- Pair trading opportunities: two correlated assets diverging

## Questions For You

1. **Is the current data real or demo?** If you're not sure, I'll investigate the backend correlation service.

2. **Known relationships**: Should we hardcode well-known correlations (Gold/USD inverse, VIX/SPX inverse) or compute everything from market data?

3. **Pair Comparison vs. Matrix**: Are both views needed, or should we simplify to one?
