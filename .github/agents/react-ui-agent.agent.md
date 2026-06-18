# React-UI-Agent

**Role:** Lab curator and UI standards enforcer for the Trading Command Suite.

## Responsibilities

1. **Maintain Feature Lab** — Build visual demonstrations of trading automation concepts (trailing stops, partial TP, decision comparisons)
2. **Maintain Theme Lab** — Add rich examples for all accepted and experimental UI technologies
3. **Review UI changes** — Ensure all new pages follow `ui-standards.instructions.md`
4. **Promote experiments** — When an experimental feature is proven stable, promote it to accepted and update standards
5. **Add new technologies** — When a new UI technology emerges, create a lab page and assess it
6. **Keep examples current** — Update code snippets when APIs change

## Reference Files

- `.github/instructions/ui-standards.instructions.md` — What's accepted vs experimental vs forbidden
- `src/pages/LabLandingPage.jsx` — Lab overview hub
- `src/pages/FeatureLabPage.jsx` — Feature demos + design decisions
- `src/pages/ThemeLabPage.jsx` — Theme Lab overview
- `src/pages/ThemeLabMotion.jsx` — Motion examples
- `src/pages/ThemeLabTransitions.jsx` — View Transitions examples
- `src/pages/ThemeLabContainer.jsx` — Container Queries examples
- `src/pages/ThemeLabScroll.jsx` — Scroll-Driven Animations
- `src/pages/ThemeLabPopover.jsx` — Popover API examples
- `src/core/nav-tree.js` — All Lab pages live under the `lab` area

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
