## Problem

The `IDirective` interface has no `readiness` field. Every directive must declare whether it's ALPHA, BETA, or READY before the readiness enforcement in #516 can begin.

## Task

Add `readonly readiness: 'alpha' | 'beta' | 'ready'` to the `IDirective` interface. Default every existing directive to `'alpha'` (alpha until proven otherwise). The TypeScript build will break on any directive that doesn't declare readiness — this is intentional enforcement.

## Steps

- [ ] Add `readonly readiness: 'alpha' | 'beta' | 'ready'` to `IDirective` interface in `nest/src/modules/directives/interfaces/directive.interface.ts`
- [ ] Add `readonly readiness = 'alpha'` to every existing directive implementation (~104 files)
- [ ] Add `readiness` to `DirectiveResult` metadata so the scoring pipeline can filter on it
- [ ] Add `readiness` column to Prisma schema (`Directive` model) — enum with default `'alpha'`
- [ ] Add `readiness` to `DirectivesService.seedToDatabase()` upsert
- [ ] Run `POST /api/directives/seed` to update live DB
- [ ] Build passes

## Acceptance

- [ ] `IDirective.readiness` exists and is type-safe (`'alpha' | 'beta' | 'ready'`)
- [ ] All 104 directives compile (no missing readiness declarations)
- [ ] Default value is `'alpha'` (alpha until proven otherwise)
- [ ] DB column `Directive.readiness` exists and is populated
- [ ] API returns `readiness` field on directive endpoints
- [ ] Build passes for both NestJS and Vite

## Notes

- This issue does NOT classify directives — it only adds the field with default `'alpha'`. Classification happens in the audit issue.
- After the audit is complete, a follow-up PR will promote the ~25 real directives from `'alpha'` to `'beta'` or `'ready'`.

## Related

- #516 (Layer A: Readiness Tiers)
- Prep #1: Audit all 104 directives for readiness classification
