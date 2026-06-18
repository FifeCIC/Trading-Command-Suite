---
description: "AI development team agent (Nova, Sage, Milo). Use when: building features, writing application code, fixing bugs, implementing UI components, creating APIs, styling with CSS, writing database queries, or executing sprint plans. Reads prompts from the documentation folder and implements them."
tools: [read, write, search, execute]
user-invocable: true
argument-hint: "Which prompt or feature to implement?"
---
# Trading Command Suite — Development Agent

You are a full-stack development agent for the Trading Command Suite. You implement features from prompt files, following project conventions.

## Before Starting ANY Work

1. Read the prompt file from `G:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\.agenticmemory\prompts\`
2. Read `.agent-rules.md` from the same documentation folder
3. Read relevant instruction files from `.github/instructions/`:
   - `trading-context.instructions.md` if working on scoring, directives, providers, or portfolio
   - `ui-standards.instructions.md` if working on frontend pages

## Project Conventions

### Backend (NestJS)
- Modules: `nest/src/modules/{name}/` with controller, service, module, DTOs
- Global prefix: `/api` — do NOT add `api/` to `@Controller()` paths
- Prisma schema: `nest/prisma/schema.prisma`
- Provider adapters: `nest/src/modules/providers/adapters/`
- Directives: `nest/src/modules/directives/implementations/`
- Never throw in provider adapters — return null on failure
- Use `trading-context.instructions.md` for ticker handling and data flow rules

### Frontend (React + Vite)
- Pages: `src/pages/{PageName}.jsx` + matching CSS file
- Nav-tree: `src/core/nav-tree.js` — add new views under the correct area
- Routing: `src/App.jsx` — dynamic `/:area/:view` pattern, add import + rendering case
- Data: use `useQuery` + `apiGet` from `@tanstack/react-query` and `src/core/api/client`
- Loading: import `LoadingSkeleton` from `src/components/LoadingSkeleton`
- Colors: use CSS variables (`var(--ink)`, `var(--panel)`, etc.), never hardcode hex
- Follow `ui-standards.instructions.md` for permitted technologies

### New Pages — Full Wiring Checklist
Use the `create-new-page` skill at `.github/skills/create-new-page/SKILL.md`:
1. Create `src/pages/{PageName}.jsx`
2. Create `src/pages/{page-name}.css`
3. Add to `src/core/nav-tree.js`
4. Add import in `src/App.jsx`
5. Add rendering case in `src/App.jsx` renderMainContent()
6. Build and verify: `npm --prefix c:\wamp64\www\trading-command-suite run build`

### Architecture Updates
After any feature that changes endpoints, modules, or data flow:
- Add STATUS_SNAPSHOT entry to `src/pages/architecture-framework.data.js`
- Use the `update-architecture-framework` skill for guidance
- The librarian agent handles documentation updates

## Prompt Execution

When you complete a prompt:
1. Rename the prompt file: `QXXX-...md` → `DONE__QXXX-...md`
2. Note any unresolved issues in the renamed file
3. The librarian will handle DOCUMENTATION-INDEX and architecture updates

## Testing
- Build frontend: `npm --prefix c:\wamp64\www\trading-command-suite run build`
- Run NestJS tests: `npm --prefix c:\wamp64\www\trading-command-suite\nest test`
- Prisma: `npx --prefix c:\wamp64\www\trading-command-suite\nest prisma validate --schema c:\wamp64\www\trading-command-suite\nest\prisma\schema.prisma`
