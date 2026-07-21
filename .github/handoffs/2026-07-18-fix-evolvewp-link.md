# Handoff: Fix EvolveWP repo link in Intranet sprint tasks

**Date:** 2026-07-18
**Agent:** GitHub Copilot
**Issue:** Intranet sprint tasks referenced `https://github.com/RyanBayne/Website-EvolveWP.Dev` instead of the canonical `https://github.com/FifeCIC/Website-EvolveWP.Dev`.

## Changes
- Updated `intranet/data/sprint-tasks.json` to replace three occurrences of the `RyanBayne` repo URL with `https://github.com/FifeCIC/Website-EvolveWP.Dev`.

## Validation
- Searched the `intranet/data` JSON for the old URL and confirmed replacements.

## Notes
- This is a documentation/data fix for intranet task tracking. No code changes required.
- If you want, I can open a GitHub PR with these changes and reference the original Issue ID.
