---
date: 2026-07-18
area: ui
type: feature
---

## What Changed

Enhanced Snapshot Library date-range comparison display (#69) — fully wired the frontend to the existing backend SnapshotComparisonService response.

Previously only showed composite delta. Now shows full side-by-side comparison: price cards, score cards, signal badges with changed detection, sub-score breakdowns, biggest directive mover, news count, seasonality shift, and news summaries for both dates.

## Files Changed

- `src/pages/SnapshotLibraryPage.jsx` — replaced minimal composite-delta display with rich side-by-side comparison cards and delta details
- `src/pages/snapshot-library.css` — added `.sl-cmp-*` styles for metric cards, signal badges, delta indicators, news list

## Issue

Closed #69 — Snapshots: Date-range snapshot comparison for stock research
