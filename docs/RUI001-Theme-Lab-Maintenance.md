# RUI001 — Maintain Theme Lab Examples

**Agent:** React-UI-Agent
**Type:** Ongoing
**Frequency:** Weekly or on-demand when new UI tech is added
**Last maintenance:** 2026-06-22

## Task

The Theme Lab at `/lab/theme-lab` is the central showcase for all UI technologies used in the Trading Command Suite. Keep it rich, current, and well-documented.

### Regular Maintenance

1. **Verify all demos still work** — Navigate to each lab sub-page and confirm the examples function correctly
2. **Update browser support tables** — Check CanIUse for each technology and update the support badges
3. **Add real-world examples** — Take patterns from actual plugin pages and add simplified versions to the lab
4. **Update code snippets** — If APIs have changed, update the code examples shown in each demo card

### Adding New Examples

When adding a new technology example:

1. Create `src/pages/ThemeLab{Name}.jsx` following the existing pattern:
   - Header with description and status badge (Accepted/Experimental)
   - Interactive demos that users can manipulate
   - Code snippet showing the pattern
   - Browser support grid

2. Register in the navigation system:
   - Add `{ id: 'theme-lab-{name}', label: '{Label}', icon: '...' }` to `nav-tree.js` under `lab`
   - Add import + route handler in `App.jsx`
   - Add card link in `ThemeLabPage.jsx` `LAB_SECTIONS` array

3. Update `ui-standards.instructions.md` with the new technology's acceptance status

### Quality Standards

- Keep examples under 200 lines each
- No external data dependencies — everything self-contained
- Include both working demos AND code snippets
- Use CSS variables from the active theme (never hardcode colors)
- Add browser support information for every feature

## Current Lab Pages

| Page | Status | Route |
|---|---|---|
| Theme Lab Hub | ✅ Active | `/lab/theme-lab` |
| Motion Lab | ✅ Accepted | `/lab/theme-lab-motion` |
| Transitions Lab | ✅ Accepted | `/lab/theme-lab-transitions` |
| Scroll Animations | 🧪 Experimental | `/lab/theme-lab-scroll` |
| Container Queries | 🧪 Experimental | `/builder/theme-lab-container` |
| Popover API | 🧪 Experimental | `/builder/theme-lab-popover` |

## Maintenance Log

| Date | Changes |
|---|---|
| 2026-06-22 | Fixed all routes from `/builder/` and `/status/` → `/lab/`. Renamed Motion → Motion Lab, View Transitions → Transitions Lab. Updated ThemeLabPage hub: removed Container Queries/Popover from primary lab cards (still linked, noted as Development area). Added real-world accordion chevron example to Motion Lab. Added real-world usage notes to Transitions Lab and Scroll Animations. Updated Firefox View Transitions status to supported (130+). |
