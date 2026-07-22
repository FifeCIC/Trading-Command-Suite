---
description: "MANDATORY — Before closing any GitHub issue, every agent MUST complete and post a pre-close checklist as an issue comment. The checklist verifies that the fix is real, visible, and tested — not just 'build passes.' No agent discretion — always post the checklist before closing."
applyTo: "nest/src/**, src/pages/**, src/components/**, src/data/**, src/core/**, scripts/**"
---

# Issue Pre-Close Checklist — ALWAYS APPLY

You MUST NOT close a GitHub issue by running `gh issue close` directly. You MUST first post a pre-close checklist comment, THEN close the issue with that comment.

## The checklist — USE THE ISSUE'S OWN ACCEPTANCE CRITERIA

**Do NOT invent your own checklist.** Every issue already has acceptance criteria checkboxes in its description (under an "Acceptance" or "Acceptance Criteria" heading, or as a `- [ ]` list at the bottom).

Steps:

1. **Read the issue** with `gh issue view <number> --repo FifeCIC/Trading-Command-Suite --json body`
2. **Find the acceptance criteria** — look for `- [ ]` checkboxes, or a section labelled "Acceptance", "Acceptance Criteria", or "Checklist"
3. **Verify each item** — for each checkbox, actually check it: curl the endpoint, reload the page, trace the data path
4. **Update the ISSUE BODY with honest checkboxes**:
   - For tasks you COMPLETED AND VERIFIED: replace `- [ ]` with `- [x]`
   - For tasks you DID NOT complete: leave `- [ ]` and add a note: `(NOT DONE — <reason>)`
   - NEVER write `- [x] → #XXX` — that's a fake checkbox
   - Use `gh issue edit <number> --repo FifeCIC/Trading-Command-Suite --body "<updated text>"`
5. **If ANY `[ ]` remain, the issue stays OPEN.** Only close when all boxes are `[x]` or the unchecked items have been extracted into separate standalone issues.
5. **Post the ticked list as a comment** — as a supplement, post the same updated checklist in a comment for the notification record.

Example — if the issue has:

```
### Acceptance
- [ ] Protocol IDs in ladder are consistent (slugs only, no UUIDs)
- [ ] Screen Options toggle for inactive protocols
- [ ] Build passes
```

Your closing comment should be:

```markdown
## Pre-Close Verification

- [x] Protocol IDs in ladder are consistent (slugs only, no UUIDs)
- [x] Screen Options toggle for inactive protocols
- [x] Build passes
```

**If the issue has NO acceptance criteria**, add this fallback before ticking:

```markdown
> ⚠️ This issue has no acceptance criteria. Adding minimal verification:

- [x] Code is live — services restarted
- [x] API returns real data — curl tested
- [x] Build passes
```

## Critical rules — NEVER violate these

### 1. `[x]` means the task is DONE and VERIFIED. Nothing else.

| Mark | Meaning |
|------|---------|
| `[x]` | Task completed AND verified (curl tested, page loaded, data confirmed real) |
| `[ ]` | Task NOT done. Leave unchecked. Add a note: why is it not done? What's the blocker? |
| `[x] → #XXX` | **FORBIDDEN.** This is a lie — the task isn't done, it's just been moved. |

If a task cannot be completed, leave it `[ ]` with an explanation. The issue stays OPEN until all boxes are `[x]` or the unfinished items are extracted into separate issues.

### 2. Never assume a dependency is broken — VERIFY before claiming something is blocked.

❌ WRONG: "Can't verify positions page — MT5 bridge is probably down based on old logs."
✅ RIGHT: `curl http://localhost:5000/` → bridge responds → positions endpoint works → verify the page.

A blocked dependency must be CONFIRMED broken, not assumed. Check it every time.

### 3. Do the actual task, not a proxy for the task.

"Verify `/trading/positions` shows MT5 positions with ticket, SL, TP, PnL" means:
- Open `http://localhost:5173/trading/positions` in a browser
- Look at the position cards
- Confirm each shows ticket number, stop-loss price, take-profit price, and P&L
- If any field is missing, the task is NOT done

It does NOT mean "the schema supports storing those fields" or "the recorder passes them" or "the endpoint returns data." Those are prerequisites, not the task itself.

### 4. An issue with ANY unchecked `[ ]` boxes is NOT complete.

Do not close it. Either:
- Complete the remaining tasks
- Extract unfinished items into new issues, update the body to reference them, and close the parent only if the remaining items are truly independent

After posting the checklist as a comment, close the issue WITH that comment using:

```powershell
gh issue close <number> --repo FifeCIC/Trading-Command-Suite --comment-file -
```

Or post the comment first, then close:

```powershell
# Step 1: Post checklist comment
gh issue comment <number> --repo FifeCIC/Trading-Command-Suite --body "...checklist with ticks..."

# Step 2: Close the issue
gh issue close <number> --repo FifeCIC/Trading-Command-Suite
```

Do NOT use `gh issue close -c "Fixed."` with a one-liner. The close comment MUST contain the completed checklist.

## What "real data" means

| ❌ NOT real data | ✅ Real data |
|-----------------|-------------|
| Hardcoded `score: 85` in JSX | Score from `apiGet('/api/scoring/...')` |
| `Math.random()` or seeded values | Values from actual DB queries |
| Mock arrays like `[{symbol:'AAPL'}]` | Arrays from `apiGet` or `apiPost` responses |
| Static text like `"Connected"` | Response from `GET /api/health` or provider check |
| Fake news counts like `5` | Count from `GET /api/news/counts` response |
| Heuristic keyword matching | DB-backed scoring/computation results |

## Common failure patterns (agents must self-audit)

1. **Build passes but old code is running** — NestJS wasn't restarted after tsc build. Symptom: curl returns 404 for new endpoints. Fix: `pwsh -File scripts/tcs-launch.ps1`.

2. **Endpoint exists but returns empty/null** — The SQL query runs but returns 0 rows. Symptom: `[]` for slow queries, `null` for vitals. Fix: check table names, column names, and whether data actually exists in those tables.

3. **UI renders but with stale/empty data** — The React component mounts but the `useQuery` is erroring silently. Symptom: empty table, "No data" message. Fix: check browser console, check API response shape matches what the component expects.

4. **Data comes from a different source than claimed** — The endpoint is wired but the data it queries is unrelated to what the UI label says. Symptom: "Protocol: built-in-default" when the expected protocol is different. Fix: trace the full data path end-to-end.

5. **Prisma relation not loaded** — Query uses `select: { protocolId: true }` instead of `include: { protocol: { select: { slug: true } } }`. Symptom: UUIDs shown instead of human-readable slugs. Fix: use `include` with relation when you need fields from the related table.
