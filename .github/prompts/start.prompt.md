---
name: start
description: "Start a new agent session — check agent-state, pick an unclaimed issue, claim it, load context, and begin work."
agent: agent
tools: [read, search, write, execute]
---

# /start — Begin a work session

## 1. Check coordination state
```
node scripts/agent-claim.cjs status
```
If `claimed: true` with recent heartbeat → issue is taken, pick different one.

## 2. Get available issues — CHECK CACHE FIRST

The `status` output shows `snapshotFresh` and `snapshotAge`.

**If `snapshotFresh: true` (age < 5 min):** read `.github/issue-cache/snapshot.md` locally. Skip the GitHub API call entirely.

**If no snapshot or stale:** fetch and cache in one pipeline:
```
gh issue list --repo FifeCIC/Trading-Command-Suite --limit 50 --state open --json number,title,labels,updatedAt | node scripts/agent-claim.cjs cache-snapshot
```
Filter to unassigned. Present top 10-15 sorted by recently updated. Let user pick.

## 3. Read issue body
```
gh issue view {number} --repo FifeCIC/Trading-Command-Suite
```

## 4. Claim it
```
node scripts/agent-claim.cjs claim {number} "{title}"
```

## 5. Load context & work
Read `.agent-rules.md` from `G:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\`. Read relevant `.github/instructions/` files. Then implement.

## 6. Heartbeat every ~5 min
```
node scripts/agent-claim.cjs heartbeat
```

## 7. On completion
- Write handoff: `…\Trading-Command-Suite-Documentation\handoff\YYYY-MM-DD-{slug}.md`
- Release: `node scripts/agent-claim.cjs release`
- Close issue: `gh issue close {number} --repo FifeCIC/Trading-Command-Suite --comment "summary"`
