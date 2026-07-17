## Summary

Create a daily summary report endpoint + frontend component that generates a formatted Markdown summary of today's trading activity. The user can copy the Markdown and paste into Reddit or other platforms.

This is Phase 1 of a larger social posting feature (tracked separately). No automated posting — just copy-to-clipboard.

## Backend: GET /api/reports/daily-summary

Query all of today's data and return a structured Markdown string:

**Data to include:**
- Portfolio summary: total P&L, open positions (long/short counts), best/worst performer
- Today's top signals: from GET /api/scoring/ranked (top 5-10 by score)
- Trades closed today: from GET /api/providers/mt5/history — symbol, type, P&L, duration
- Automation stats: strategies evaluated, decisions made, SKIP reasons
- Provider health summary
- Date and session info

**Response shape:**
```json
{
  "markdown": "string - full formatted Markdown",
  "date": "2026-07-17",
  "generatedAt": "ISO timestamp",
  "sections": {
    "portfolio": "...",
    "signals": "...",
    "trades": "...",
    "automation": "..."
  }
}
```

## Frontend: Daily Summary Report Page

- New page at /lab/daily-summary-report
- Show the rendered report (Markdown preview)
- Copy to Clipboard button - copies raw Markdown
- Copy as Text button - copies plain text (stripped of Markdown formatting, for non-Markdown platforms)
- Refresh button to regenerate
- Graceful fallback when backend not yet deployed

## Acceptance Criteria

- Backend endpoint returns formatted Markdown with real data
- Frontend page shows rendered preview
- Copy to clipboard works in both Markdown and plain text
- Works with no data (shows 'No trades today' etc.)
- Falls back gracefully if backend not deployed
- Navigation entry registered
- Build passes
