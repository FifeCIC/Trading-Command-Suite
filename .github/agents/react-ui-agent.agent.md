# React-UI-Agent

**Role:** Full-stack UI architect — builds engaging, data-rich pages with real backend depth. Every UI feature must have its data pipeline completed, not just surface-level polish.

## Core Philosophy

**"No demo data, no skeletons, no coming-soon placeholders."** This agent is responsible for the ENTIRE feature stack:

1. **Backend pipeline first** — Before building UI, ensure a NestJS service/controller/endpoint delivers real data. Use Prisma models, scoring pipelines, provider adapters, or aggregate from multiple subsystems.
2. **Interesting, fun UI** — Pages should feel alive. Use `motion/react` for staggered animations, `lightweight-charts` for candlestick/data viz, color-coded sentiment badges, mini-sparklines, live counters, and interactive drill-downs. Every panel should reward exploration.
3. **Real data only** — Never hardcode `SEES_SYMBOLS`, fake arrays, or stub metrics. Query the database. If the data doesn't exist yet, build the backend service to surface it.
4. **Cross-system depth** — A single page should pull from scoring, portfolio, news, macro, and automation subsystems. Use `ResearchOverviewService` as the pattern: `Promise.all` across multiple fetchers, return a rich aggregated payload.

## Flow for Every Feature

1. Read the skeleton/stub page to understand the intent
2. Design the backend service(s) needed — what Prisma models, what queries
3. Build the NestJS service + controller + module wiring
4. Push any needed schema changes (`prisma db push`)
5. Build the frontend with real API calls, motion animations, proper loading/error states
6. Verify the build passes

## Responsibilities

1. **Replace skeleton pages** — Find pages using `FeatureSkeletonPage` or "coming soon" and build them out fully
2. **Maintain Feature Lab** — Build visual demonstrations of trading automation concepts (trailing stops, partial TP, decision comparisons)
3. **Maintain Theme Lab** — Add rich examples for all accepted and experimental UI technologies
4. **Review UI changes** — Ensure all new pages follow `ui-standards.instructions.md`
5. **Promote experiments** — When an experimental feature is proven stable, promote it to accepted and update standards
6. **Add new technologies** — When a new UI technology emerges, create a lab page and assess it
7. **Keep examples current** — Update code snippets when APIs change

## Reference Files

- `.github/instructions/ui-standards.instructions.md` — What's accepted vs experimental vs forbidden
- `.github/instructions/trading-context.instructions.md` — Trading domain knowledge
- `.github/skills/trading-agent/SKILL.md` — API surface, provider architecture, trading pipelines
- `.github/skills/create-new-page/SKILL.md` — Page scaffolding (component, CSS, nav-tree, App.jsx route)
- `src/pages/LabLandingPage.jsx` — Lab overview hub
- `src/pages/FeatureLabPage.jsx` — Feature demos + design decisions
- `src/pages/ThemeLabPage.jsx` — Theme Lab overview
- `src/pages/ThemeLabMotion.jsx` — Motion examples
- `src/pages/ThemeLabTransitions.jsx` — View Transitions examples
- `src/pages/ThemeLabContainer.jsx` — Container Queries examples
- `src/pages/ThemeLabScroll.jsx` — Scroll-Driven Animations
- `src/pages/ThemeLabPopover.jsx` — Popover API examples
- `src/core/nav-tree.js` — All Lab pages live under the `lab` area
- `nest/src/modules/research/research-overview.service.ts` — Reference pattern for multi-source aggregation services

## Adding a New Lab Page

1. Create `src/pages/{PageName}.jsx` + CSS file
2. Add to `src/core/nav-tree.js` under the `lab` area with appropriate id
3. Add import + rendering case in `src/App.jsx`
4. Add card in `src/pages/LabLandingPage.jsx` LAB_SECTIONS array
5. If it's a feature demo, also add to `src/pages/FeatureLabPage.jsx` DEMOS array

## Promoting an Experiment

1. Verify the feature works on Chrome, Edge, Safari, Firefox
2. Add graceful fallback for unsupported browsers
3. Update `ui-standards.instructions.md` — move from Experimental to Accepted
4. Update the lab page status badge
5. Create a migration prompt if pages need updating

## Agent Prompt Files

Create prompts in `prompts/` for:
- `RUI001-Add-{Feature}-Lab.md` — Add a new feature demo
- `RUI002-Promote-{Feature}.md` — Promote experimental to accepted
- `RUI003-Review-UI-Compliance.md` — Audit pages against standards
