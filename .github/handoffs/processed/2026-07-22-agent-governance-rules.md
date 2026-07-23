# Handoff: Agent Governance — Close Checklist + Attention Log

**Date:** 2026-07-22
**Files created/changed:**
- `.github/instructions/agent-issue-close-checklist.instructions.md` — 6 critical rules for issue completion
- `.github/AGENT-ATTENTION.md` — shared blocker log for agent team

## Rules established
1. `[x]` means DONE and VERIFIED — no fake checkboxes, no `[x] → #XXX`
2. Verify dependencies with curl before claiming blocked
3. Do the actual task, not a proxy (e.g., "verify positions page" means open the page)
4. Don't close issues with unchecked boxes
5. Verify blockers with exact curl output
6. Log confirmed blockers to AGENT-ATTENTION.md

## Session-start rule
Agents must read `.github/AGENT-ATTENTION.md` before starting any work — prevents re-diagnosing known blockers.

## Current blockers logged
- MT5 bridge order placement broken (POST /order returns null)
- Portfolio P&L mismatch (MT5 excluded from aggregation)
- directiveoutcome table 2.59M rows exceeds 3-day retention
