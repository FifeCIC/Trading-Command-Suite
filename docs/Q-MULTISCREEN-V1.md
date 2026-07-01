# Q-MULTISCREEN-V1 — Multi-Screen Modular Trading Cockpit

**Agent:** react-ui-agent
**Area:** Trading / UI
**Priority:** Medium — architecture phase
**Depends on:** Existing page components, React window management

## Objective

Design and implement a modular multi-screen layout for the Trading Command Suite that supports 3–6 physical monitors. Each screen hosts independently configurable panels. The user can drag, resize, and assign panels to any screen. Configuration is persisted per user.

## Background

The current single-page-per-view architecture doesn't scale for power users who run multiple monitors. A trader may want:
- Screen 1: Speed Trading (chart + buy/sell)
- Screen 2: SEES Live Ordering Stack + Scanner
- Screen 3: Portfolio overview + P&L tracking
- Screen 4: Automation dashboard + decision log
- Screen 5: News + macro indicators
- Screen 6: Trade journal + performance analytics

## Design

### Core Concept
Each "screen" is a window that can be opened on any physical monitor. Each window contains a grid of panels. Panels are individual React components that can be dragged between windows.

### Architecture
- Window manager detects available monitors via `window.screen` API
- Panel registry maps component names to React components
- Layout config persisted to UserPreferences / localStorage
- Drag-and-drop via HTML5 drag API or react-dnd
