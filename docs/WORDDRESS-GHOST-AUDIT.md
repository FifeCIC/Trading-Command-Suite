# WordPress Ghost Audit — 2026-06-13

> ✅ **Closed out (2026-09-03):** every "Pending Review" item below has been resolved — the WP-origin
> pages (Listener Testing, Shortcodes, BugNet, Workflow Wizards, Education settings, etc.) no longer
> exist in `src/core/nav-tree.js`. Only `Calculators` and `Education` remain (both KEEP verdicts). This
> doc now serves as a guardrail: when adding pages, do not reintroduce these WordPress concepts.
> Decisions are also recorded in QA issues (Q170/Q173/Q181/Q184/Q190).

## Purpose
Identify pages and concepts ported from the WordPress plugin architecture that don't belong in a NestJS + React app. For review before any deletions.

## Completed or In-Progress

| Page | WP Origin | Verdict | Status |
|------|-----------|---------|--------|
| **Transient Caches** | WP transients API (temporary cached data) | ✅ **TRANSFORM** → Cache Monitor | Done (Q181) |
| **Developer Snippets** | WP code snippets plugin concept | ✅ **DELETE** | Done (Q184) |
| **Duplicate Checker** | WP asset deduplication | ✅ **DELETE** | Done (Q184) |
| **Algorithm Debugger** | WP-specific debugging UI | ✅ **DELETE** — covered by Algorithm Lab (Q170) | Done (Q184) |
| **Explore Tasks** | WP task management via GitHub Issues | ✅ **DELETE** | Done (Q184) |
| **Layouts** | WP layout builder concept | ✅ **DELETE** | Done (Q184) |
| **jQuery UI** | WP uses jQuery — this app uses React | ✅ **DELETE** | Done (Q184) |
| **Cron Scheduler UI** | WP wp-cron visual scheduler | ✅ **DELETE** — NestJS uses @Cron decorators | Done (Q184) |
| **Strategy Templates** | WP template post-type concept | ✅ **REPLACE** → "Duplicate" button | Done (Q173) |

## Pending Review

| Page | WP Origin | Verdict | Notes |
|------|-----------|---------|-------|
| **Listener Testing** | WP hooks/actions POST/GET processing pattern | **DELETE** | NestJS has interceptors, middleware, and guards. External webhooks are handled by WebhooksModule. Sending test payloads to debug endpoints is better done with curl/Postman. Delete the page. |
| **API Endpoints page** | WP REST API endpoint browser | **KEEP but TRANSFORM** | Swagger/OpenAPI (via @nestjs/swagger) already serves `GET /api-docs` and `GET /api-json`. This page could redirect to Swagger UI or be replaced with a simple API status dashboard showing available routes and their health. |
| **API Activity page** | WP API request logging | **KEEP** | Valid value for debugging MT5 bridge calls and provider requests. Not WP-specific — any API needs activity monitoring. |
| **API Errors page** | WP error logging | **KEEP** | API error monitoring is valid regardless of stack. |
| **Import Jobs / Import History** | WP data import concept | **KEEP** | Market data importing is a core app function, not a WP transplant. |
| **Data Elements / Create Source** | WP custom post-type / meta thinking | **TRANSFORM** | These pages describe data schema concepts that should live in Prisma schema files + documentation, not as UI pages. Could consolidate into a simpler "Data Sources" config page. |
| **Decorder** | WP data decoding/viewing | **UNCLEAR** | Needs investigation to determine purpose. Could be a dev tool for inspecting raw API responses. |
| **Shortcodes** (`settings-shortcodes`) | WordPress shortcode system | **DELETE** | Shortcodes are a WP concept (embedding dynamic content in post content). This app has no post content. Not applicable. |
| **BugNet** (`settings-bugnet`) | WP bug tracking integration | **UNCLEAR** | Find out what this does. If it's a WP-specific bug tracker integration, delete. If it's a general error reporting config, keep. |
| **Education** (`settings-education`) | WP education plugin concept | **DELETE** | Unlikely to need education-specific settings in a trading app. |
| **Dev Runtime / Tag-Aware Runtime** | WP filter/hook concept | **KEEP but simplify** | The dev overlay and runtime tag system has legitimate debugging value in any stack. But the "tag-aware runtime" terminology is WP-specific. Rename to "Dev Overlay" / "Debug Mode". |
| **Workflow Wizards** (`workflow-wizards`) | WP guided setup wizard pattern | **DELETE** | The Setup Wizard (Q190 covered this) serves the same purpose. Multiple wizards for different workflows is WP thinking. |
| **Calculators** | WP calculator shortcode pattern | **KEEP** | Legitimate feature — position size and risk calculators are trading-utility. Not WP-specific. |
| **Social Networks** | WP social media integration | **DELETE** | Social network feeds for market sentiment is a stretch for MVP. Could revisit as a Research enhancement later. |
| **Points / Pointers** | WP pointer/suggestion system | **UNCLEAR** | Needs investigation. If it's a WP onboarding tutorial concept, delete. If it's market data point annotations, keep. |
| **Current Task** | WP task management concept | **DELETE** | GitHub Issues handles this. |
| **Create Task** | WP task creation UI | **DELETE** | GitHub Issues handles this. |

## Summary

**Already handled (9 items):** Transient Caches → Cache Monitor, Developer Snippets (delete), Duplicate Checker (delete), Algorithm Debugger (delete), Explore Tasks (delete), Layouts (delete), jQuery UI (delete), Cron Scheduler (delete), Strategy Templates → Duplicate button.

**Pending review (16 items):** 6 recommended for DELETE, 5 recommended for KEEP, 5 need transformation or clarification.

## Recommended Next Steps

1. **Approve deletions:** Listener Testing, Shortcodes, Education, Social Networks, Current Task, Create Task, Workflow Wizards
2. **Decide on unclear items:** BugNet, Decoder, Pointers
3. **Transform:** API Endpoints page → Swagger redirect; Data Elements → simplified config; Dev Runtime → rename to "Debug Mode"
4. **Schedule cleanup:** Once approved, remove nav entries, delete page files, remove routes from App.jsx
