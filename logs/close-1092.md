## Pre-close checklist — the fix is real, visible and tested
- [x] **Reproduced live first**: `/trading/strategy/<id>` crashed for TWO different bots (Sydney AUDJPY + Sydney AUDUSD) — verbatim: `PAGEERROR: Cannot read properties of null (reading 'declared')` at `BotLifecyclePath` (ViewStrategyPage.jsx:167).
- [x] **Root cause read, not guessed**: `buildBotStagePath()` adds brake-layer nodes with `tally: null` BY DESIGN (bot-stage-path.js L231-247) and `botStageClaims()` guards for it (`if (!n.tally) continue`). The page's stage filter did not.
- [x] **Consumer sweep**: grep `\.tally\.declared` across `src/**` → this was the ONLY unguarded read. Fix closes the class, not just the instance.
- [x] **Observed AFTER**: same URL, 0 page errors, body renders (27,725 chars) — and the row this issue blocked now shows: `Session window | sessionWindow | all-hours | LIVE` (that is #982's verification, which is how this was found).
- [x] **Structural gate**: `npm run build` (Vite/PWA) → clean, 113 precache entries generated.
## Not done
- No automated spec for this component (none exists for ViewStrategyPage; the browser canary above is the reproduction — before: crash, after: render). A component test harness is not in this change's scope.