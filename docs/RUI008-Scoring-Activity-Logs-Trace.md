# RUI008 — Scoring Activity Logs with Directive Trace Viewer

**Agent:** react-ui-agent
**Area:** Scoring
**Priority:** P2 — debugging protocol runs
**Depends on:** Scoring module, Score model in DB

## Current State
`ScoringActivityLogsPage` partial — logs table exists but no detailed trace viewer.

## Task

### Protocol Run Trace
For each scoring run:
- Timestamp, protocol name, symbols scored
- Total runtime, directives executed
- Expand to see per-symbol, per-directive breakdown

### Directive Trace Viewer
Click any directive score to see:
- Input values that went into the calculation
- Formula applied step-by-step
- Final score + confidence
- Historical comparison: "This directive scored NVDA 72 today vs 68 yesterday"
- Chart: directive score over time for a symbol

### UI Guidance

**Layout:** Split — runs list (left 40%) + trace detail (right 60%)

**Visual styling:**
- Scoring runs: timeline-style list with animated progress dots (green=complete, amber=running, grey=queued)
- Per-directive cards in trace view: `motion` staggered entrance
- Score changes: green up-arrow animation for improvement, red down-arrow for decline
- Formula breakdown: monospace terminal-style panel with syntax highlighting
- Historical sparkline: small `motion`-drawn line chart per directive

**Transitions:**
- Select a run: trace panel slides in from right
- Expand directive: accordion-style height animation (pattern from Motion Lab)
- Time range change: sparkline data morphs with `layout` animation

**Time travel:** Slider to step through scoring history — see how scores evolved across multiple runs. Uses the scrubber pattern from Snapshot Replay.
