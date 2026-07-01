# GitHub Issue: Multi-Screen Dashboard Prototype

## Vision
A dashboard that spans 3 monitors with AI-managed widget placement. Fixed zones (user-controlled) + Dynamic zones (AI context-driven) + Conditional zones (trigger-based visibility).

## Prototype Phase (A)
Build a single-page prototype at `/dashboard/multi-screen` with:

### Fixed Widgets (always visible, user-positioned)
- Portfolio Summary — balance, P&L, open positions count
- SEES Live Stack — current highest-scoring symbols
- Alerts/Notifications — recent alerts, pattern detections

### Dynamic Widgets (AI context)
- Earnings Watch — auto-shows charts for held symbols with earnings in 48h. If none, widget minimizes/hides.
- Position Charts — shows chart for each open position. If no positions, widget hides.
- News Stream — filtered to held symbols + watchlist

### Conditional Widgets
- Speed Trading Panel — appears when speed trading mode active
- Correlation Warning — appears when 2+ positions are highly correlated

### Zone System
- 3 zones: left (fixed), center (dynamic), right (conditional)
- CSS Grid that adapts to viewport width
- When window spans 3 screens, all zones visible
- When window is single screen, zones stack vertically with priority
- Each zone has a label indicating its behavior: "🔒 Fixed" / "🤖 AI Managed" / "🔔 Conditional"

### Widget Contract
```typescript
interface DashboardWidget {
  id: string;
  title: string;
  component: React.ComponentType;
  defaultZone: 'fixed' | 'dynamic' | 'conditional';
  minWidth: number;
  visibilityRule?: string; // AI rule for show/hide
  priority: number; // Higher = keep when space constrained
}
```

Labels: frontend, dashboard, prototype, P1
