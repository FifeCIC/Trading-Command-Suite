# Scoring Activity Logs & Application-Wide Logging System

Status: discussion
Created: 2026-06-29

## Current State
- **Scoring Activity Logs** page (`/scoring/scoring-activity-logs`) uses hardcoded MOCK_RUNS — not connected to any real data source
- **Scoring Runs** page (`/scoring/scoring-runs`) queries the Score table — real data but slow and confusing UX
- Two pages with overlapping purpose, neither clearly defined

## The Core Question

You suggested: *"A 'Log' or 'Logs' page should be file-based. Whatever file type makes it easier to quickly write to."*

This raises a bigger question: Should the app have a unified logging system?

## Discussion Points

### 1. File-Based Logging vs. Database Logging
| Approach | Pros | Cons |
|---|---|---|
| **File-based** (JSON lines, NDJSON) | Fast writes, no DB contention, easy to rotate/archive, human-readable with tools | Harder to query, no joins, needs parsing |
| **Database** (Prisma table) | Queryable, joinable, consistent with other data | Slower writes, DB bloat, migrations needed |
| **Hybrid** | DB for structured events, files for debug/raw output | Two systems to maintain |

### 2. What Should Be Logged?
If we build a unified logging system, what's in scope?
- Scoring runs (start, progress, completion, errors)
- Signal generation (signal created, expired, accepted, rejected)
- Trade execution (order placed, filled, cancelled)
- API calls (already has ApiActivityLog middleware)
- Provider health (connection status changes)
- User actions (page views, button clicks, settings changes)
- System events (startup, shutdown, errors, memory warnings)

### 3. Visualization
You want to view logs in "an interesting way rather than raw text." Ideas:
- Timeline/chart of scoring activity over time
- Heatmap of errors by hour/day
- Filterable table with color-coded severity
- Real-time streaming log viewer (like a terminal tail)
- Expandable rows showing full context

### 4. Relationship to Scoring Runs
Should these be one page or two?
- **Option A: Merge** — One "Scoring History" page with tabs: Runs (structured) + Activity (events)
- **Option B: Separate** — Runs = scored results (queryable), Activity Logs = debug/monitor output (file-based)
- **Option C: Three-way** — Runs (results), Activity (events log), and a standalone Log Viewer (system-wide)

## Clear Actions
- [ ] Decide: file-based, DB, or hybrid logging
- [ ] Design log event schema (timestamp, level, source, message, context)
- [ ] Implement logging service (write + query + stream)
- [ ] Build log viewer UI (filters, search, visualization)
- [ ] Connect scoring runs data to the same system
- [ ] Remove MOCK_RUNS from scoring-activity-logs

## Questions For You

1. **Merge or keep separate?** Which of the three options above feels right? Or something else entirely?

2. **Log file format**: NDJSON (one JSON object per line) is standard for log aggregation tools. Does that work for your needs, or do you want a more human-readable format like Markdown or plain text?

3. **Log rotation**: How long should logs be kept? Daily rotation with 30-day retention? Size-based? Both?

4. **Real-time streaming**: Do you want a live-updating log viewer (like `tail -f` in the browser), or is on-demand refresh sufficient?

5. **What's the most important log source to start with?** Scoring runs? Trade execution? System health? Starting with one and expanding is better than boiling the ocean.
