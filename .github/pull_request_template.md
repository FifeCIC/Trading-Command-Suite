## What changed

<!-- One or two sentences. The diff shows the how; this says the why. -->

## How it was verified

<!--
  A claim is a claim. Name the command and the result, not "tests pass".

  npm run build
  npm --prefix nest run typecheck
  node scripts/validate-site-links.cjs
-->

## What is NOT done

<!--
  Delete this section only if genuinely nothing is outstanding.
  A partial change reported as complete is worse than a partial change.
-->

## Public surfaces affected

<!--
  The app is the source; Pages, the wiki and the discussions are claims about it.
  Naming a page here is what stops them drifting.

  Affects: wiki `Installing` (setup steps changed) · none (site, discussions)
-->

⚠️ Edit `wiki/*.md` or `docs/*`, never the wiki page itself — `scripts/publish-public-docs.cjs`
overwrites generated pages.

## Checklist

- [ ] `prisma db push` was **not** run (it drops the 13 unmodelled tables)
- [ ] If a bug was fixed, a guard exists so the same class fails the build next time
- [ ] If scoring maths changed, it was done on a **copied** configuration, not the live one
