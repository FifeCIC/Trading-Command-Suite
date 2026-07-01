# Research Overview — Mini-Dashboard Design

Status: discussion
Created: 2026-06-30

## Current State
Page is empty — no content displayed. No visible skeleton or placeholder.

## Vision
A mini-dashboard that surfaces the most important information from the Research area:
- High-impact news affecting the broader market
- News/events specific to stocks the user holds positions in
- Upcoming earnings for watched/held stocks
- Social sentiment spikes on tracked profiles
- Sector rotation signals
- Price forecast changes for key symbols

## Priority Weighting System
Build a system that adds weight to information when it applies to the user's activity:
- Holding a position → multiply impact score
- Symbol in active watchlist → boost relevance
- Upcoming earnings within 7 days → high priority
- Social mention from tracked profile → elevated

This turns a passive dashboard into an active intelligence feed.

## Questions For You

1. **Hidden skeleton?** Is there any existing design, mockup, or prompt for this page that I missed? If so, what was the original concept?

2. **Layout preference**: Card grid (like a dashboard), feed (like a news timeline), or split view (key metrics top, feed below)?

3. **Real-time vs. on-demand**: Should this page poll for updates, or is it a snapshot you refresh manually?

4. **What's the ONE thing you'd want to see first?** Starting with a single high-value widget and expanding is better than building everything at once.
