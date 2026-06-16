---
title: "Multi-Screen Command Dashboard — Widget System & Zone Layout"
labels: ["feature", "P1", "dashboard"]
---

## Description

Build a multi-screen command dashboard with a widget-based zone system. This is the foundational dependency for HOTAS/gamepad integration, speed trading panels, and conditional alert zones.

## Design

Three-zone CSS Grid layout:
- **🔒 Fixed Zone** (30% left) — Portfolio Summary, SEES Mini Stack, Alert Stream
- **🤖 AI Managed Zone** (40% center) — Earnings Watch, Position Charts, News Feed — widgets appear/hide based on context rules
- **🔔 Conditional Zone** (30% right) — Speed Trading Panel, Correlation Warning — triggered by events

## Widget Contract System

- Define a `DashboardWidget` interface (id, title, defaultZone, visibilityRule, priority)
- Widget registry for adding/removing widgets
- Each widget declares its zone, visibility rules, and priority
- Zone labels show behavior type explanations

## Deliverables

1. `src/pages/MultiScreenDashboardPage.jsx` + CSS — route: `/dashboard/multi-screen`
2. Widget registry (`src/dashboard/widgetRegistry.js`)
3. Fixed zone: Portfolio Summary, SEES Mini Stack, Alert Stream widgets
4. Dynamic zone: Earnings Watch, Position Charts, News Feed (with context rules)
5. Conditional zone: Speed Trading Panel, Correlation Warning
6. Responsive stacking on narrow viewports

## Dependencies

None — this is a foundational piece.

## Blocking

This blocks the HOTAS/gamepad integration (#HOTAS-Integration) which depends on the widget zone system and speed trading panel.

See: `G:\My Drive\...\.agenticmemory\prompts\Q235-Multi-Screen-Dashboard.md`
