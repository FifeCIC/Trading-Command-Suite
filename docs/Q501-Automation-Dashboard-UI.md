# Q501 — Automation Dashboard UI

**Type:** Feature — Frontend  
**Depends on:** None (dashboard can be scaffolded before backend)  
**Status:** CLAIM__

## Context

The Automation subsystem needs a visual anchor — a dashboard where users can see running protocols, scored symbols, and execution queue state. This is the first Automation deliverable.

The dashboard serves as the user-facing control panel for multi-protocol orchestration. Users will configure protocol runs (symbols, protocols, frequency), see live scoring results in stack or grid view, and monitor the execution queue.

## Steps

### 1. Create AutomationDashboardPage.jsx
- Path: `src/pages/AutomationDashboardPage.jsx`
- Layout: split-pane with protocol config sidebar + results area
- Protocol config sidebar:
  - "Add Protocol Run" button
  - Each run shows: name, protocol preset, symbol list, status (idle/running/complete/failed), last run time
  - Quick actions: run now, pause, remove
- Results area (tabbed):
  - **Stack View**: vertical list of protocol runs with expandable score cards
  - **Grid View**: symbol × protocol matrix with color-coded scores
  - **Queue**: execution queue showing pending/completed/failed jobs

### 2. Create automation-dashboard.css
- Path: `src/pages/automation-dashboard.css`
- Use existing design tokens (CSS variables from theme)
- Protocol cards: glass-panel style matching RUI016
- Score badges: color-coded (green 70+, yellow 40-69, red <40)
- Running indicator: pulsing green dot animation

### 3. Wire into App.jsx
- Add route: `/trading/automation`
- Map `AutomationDashboardPage` component
- Use lazy loading (React.lazy)

### 4. Add to nav tree
- Add sidebar nav entry under "Trading" section
- Icon: `⚡` or `🔄`
- Label: "Automation"

### 5. API endpoints to plan for (stub mode initially)
- `GET /api/automation/runs` — list configured protocol runs
- `POST /api/automation/runs` — create a new protocol run
- `POST /api/automation/runs/:id/execute` — trigger a run
- `GET /api/automation/results/:runId` — get latest scores
- `GET /api/automation/queue` — execution queue status
- `DELETE /api/automation/runs/:id` — remove a run

## Design Notes

- Dashboards start visible, not hidden behind config. Show "No protocols configured — create your first run" empty state.
- Stack view is the default — it matches the mental model of "what's running right now"
- Grid view is for comparison across protocols
- Queue view is for debugging/audit
- All data should come from real API calls. No fake demo data.

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/pages/AutomationDashboardPage.jsx` | Create |
| `src/pages/automation-dashboard.css` | Create |
| `src/App.jsx` | Modify (add route) |
| `src/core/nav-tree.js` | Modify (add nav entry) |
