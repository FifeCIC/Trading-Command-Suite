## Source

`/scoring/scoring-runs`

## Problem

The Scoring Runs page appears to be a duplicate of Scoring Activity Logs (`/scoring/scoring-activity-logs`), which is the better view.

## Options

### Option A: Delete it
If there's no unique value, remove the page, route, and nav entry.

### Option B: Adapt to live scoring feed
Transform it into a live view that shows tickers appearing with scores as they happen in real-time — but ONLY if this doesn't add significant overhead to the automation loop. The concern is that pushing live scoring updates could slow down the tick cycle.

## Discussion

Which approach? Delete is simpler and less risky. Live feed is more valuable but needs careful performance consideration.

## Element

View: `/scoring/scoring-runs`
