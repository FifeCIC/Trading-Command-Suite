/**
 * standards.js — THE STANDARDS THIS PROJECT CLAIMS, AND THE GATE THAT PROVES EACH ONE.
 *
 * ── WHY A DATA FILE AND NOT A PAGE OF PROSE ────────────────────────────────────────────────────
 * A standards page that lists good intentions is the defect this repo names repeatedly: a claim with
 * no observation behind it. So every entry here names a **`gate`** — a file that must exist, must be
 * wired into a build chain, and (where it has one) must be runnable with `--self-test`. That turns a
 * badge from marketing into an assertion `scripts/validate-standards.cjs` can check.
 *
 * ⚠️ **`status` IS DERIVED, NEVER TYPED.** There is no `status: 'passing'` field, because a hand-typed
 * pass is a claim somebody has to remember to update. The validator re-derives each standard's state
 * from the gate it names, and a standard whose gate has disappeared fails the build rather than
 * quietly reading as met.
 *
 * ⚠️ **A STANDARD WITH NO GATE IS ALLOWED, AND MUST SAY SO.** `gate: null` plus a `gap` sentence is
 * honest — "we do not check this yet" — and it is the entry the owner can act on. What is forbidden
 * is an entry that LOOKS checked and is not.
 *
 * ── WHERE THIS SURFACES ────────────────────────────────────────────────────────────────────────
 *   · `/development/standards` (the Development area, which is already the engineering surface)
 *   · the README badge block (generated, not typed — see the validator's `--report`)
 *   · the public site, once the wording has been through `validate-public-claims.cjs`
 *
 * ── WHAT IT IS NOT ─────────────────────────────────────────────────────────────────────────────
 * It is not a second copy of `audit-project-readiness.cjs`. That tool answers *"does this repository
 * have the processes a project needs"* (governance files, decisions register, layout). This answers
 * *"which product standards are enforced, by what, and which are not"*. They overlap on nothing but
 * the word "ready".
 */

/** A standard is one thing a contributor can check before shipping. */
export const STANDARDS = [
  {
    id: 'data-integrity',
    name: 'No column is written that nothing reads',
    why: 'A column nobody writes reads as a capability. `position.magic` held no value for its whole life (#1354).',
    gate: 'scripts/audit-column-writers.cjs',
    verify: 'npm run audit:column-writers',
    selfTest: 'npm run audit:column-writers:self-test',
    enforcedIn: 'on-demand (needs a live database)',
  },
  {
    id: 'schema-safety',
    name: 'The database is never rewritten from schema.prisma',
    why: '`prisma db push` drops every table with no model, including live ones, and waits for a `y`.',
    gate: 'nest/scripts/validate-schema-safety.cjs',
    verify: 'npm --prefix nest run db:check',
    selfTest: null,
    enforcedIn: 'on-demand',
  },
  {
    id: 'decision-record',
    name: 'Every settled decision is recorded in all three homes',
    why: 'A decision in two homes is not recorded — #919 landed code citing an issue whose register row was never written.',
    gate: 'scripts/validate-decisions.cjs',
    verify: 'node scripts/validate-decisions.cjs',
    selfTest: 'node scripts/validate-decisions.cjs --self-test',
    enforcedIn: 'prebuild',
  },
  {
    id: 'quoted-conversation',
    name: 'No private conversation is published',
    why: 'The reasoning is ours to keep; a verbatim quotation reproduces a private message.',
    gate: 'scripts/validate-owner-quotes.cjs',
    verify: 'node scripts/validate-owner-quotes.cjs',
    selfTest: null,
    enforcedIn: 'prebuild',
  },
  {
    id: 'public-claims',
    name: 'A public page may only state what the repository can prove',
    why: 'Screenshot counts and the release stage drifted from the facts on five pages before this gate existed.',
    gate: 'scripts/validate-public-claims.cjs',
    verify: 'node scripts/validate-public-claims.cjs',
    selfTest: 'node scripts/validate-public-claims.cjs --self-test',
    enforcedIn: 'prebuild',
  },
  {
    id: 'accessibility-contrast',
    name: 'Colour pairs meet the contrast policy',
    why: 'A theme pack can look deliberate and fail a colour-blind reader; contrast is measured, not judged.',
    gate: 'src/theme/semantic-contrast.test.js',
    verify: 'node --test src/theme/semantic-contrast.test.js',
    selfTest: null,
    enforcedIn: 'prebuild',
  },
  {
    id: 'theme-tokens',
    name: 'A stylesheet uses tokens, not colours of its own',
    why: 'An undefined token or a hardcoded hex silently ignores every theme pack.',
    gate: 'scripts/validate-css-tokens.cjs',
    verify: 'node scripts/validate-css-tokens.cjs',
    selfTest: null,
    enforcedIn: 'prebuild',
  },
  {
    id: 'parity-register',
    name: 'Every mechanism a backtest models is compared to live',
    why: 'A run that silently differs from the bot reports a strategy nobody can trade.',
    gate: 'nest/scripts/validate-parity-register.cjs',
    verify: 'node nest/scripts/validate-parity-register.cjs --report',
    selfTest: 'node nest/scripts/validate-parity-register.cjs --self-test',
    enforcedIn: 'prebuild',
  },
  {
    id: 'tool-findability',
    name: 'A tool nobody can find is a tool that does not exist',
    why: 'Measured 2026-09-26: 141 tools, 75 orphans. Three proposals in one session were for things already built.',
    gate: 'scripts/tools-index.cjs',
    verify: 'node scripts/tools-index.cjs --check',
    selfTest: 'node scripts/tools-index.cjs --self-test',
    enforcedIn: 'prebuild',
  },
  {
    id: 'repo-hygiene',
    name: 'A file lives where its concern lives',
    why: 'A 151 KB canary backup and thirteen one-off SQL repairs were tracked in a public repo root.',
    gate: 'scripts/validate-repo-hygiene.cjs',
    verify: 'node scripts/validate-repo-hygiene.cjs',
    selfTest: 'node scripts/validate-repo-hygiene.cjs --self-test',
    enforcedIn: 'prebuild',
  },
  {
    id: 'empty-swallow',
    name: 'A failure is never swallowed into a plausible empty result',
    why: '`catch { return [] }` makes "the query broke" indistinguishable from "there is nothing".',
    gate: 'scripts/validate-no-empty-swallow.cjs',
    verify: 'node scripts/validate-no-empty-swallow.cjs',
    selfTest: 'node scripts/validate-no-empty-swallow.cjs --self-test',
    enforcedIn: 'prebuild',
  },
  {
    id: 'fault-taxonomy',
    name: 'A fault is counted in episodes and retired, never deleted',
    why: 'A deleted fault code makes the next occurrence look brand new.',
    gate: 'scripts/validate-fault-taxonomy.cjs',
    verify: 'node scripts/validate-fault-taxonomy.cjs',
    selfTest: 'node scripts/validate-fault-taxonomy.cjs --self-test',
    enforcedIn: 'prebuild',
  },
  /* ── DECLARED GAPS — no gate, stated rather than implied ───────────────────────────────────── */
  {
    id: 'shared-formatters',
    name: 'One formatter per concept across pages',
    why: '`src/core/format-utils.js` is imported by 26 files, yet 13 more declared a formatter of their '
      + 'own and four names collided with a canonical export — `fmtCurrency` that rendered no currency, '
      + '`fmtDuration` that said "2d 0h" where the shared one says "2d", and two `fmtPrice` rules under '
      + 'one name. The shorter-lived copy is the one that gets the next fix.',
    gate: 'scripts/validate-formatters.cjs',
    verify: 'node scripts/validate-formatters.cjs',
    selfTest: 'node scripts/validate-formatters.cjs --self-test',
    enforcedIn: 'prebuild',
  },
  {
    id: 'debt-expiry',
    name: 'Accepted debt is reviewed before it expires',
    why: 'Nine ratchet baselines held **~1,640 findings**, and every one was guarded against GROWTH by its own '
      + 'gate — but **none against AGE**. "The baseline may only go down" is a rule about direction, not pace: '
      + 'a number that never moves is a decision nobody revisited. `pipeline-contracts` was worse — it printed '
      + '"does not fail the build" and exited 0 while five directive classes still scored off the calendar.',
    gate: 'scripts/validate-debt-expiry.cjs',
    verify: 'npm run debt',
    selfTest: 'npm run debt:self-test',
    enforcedIn: 'prebuild',
  },
  {
    id: 'component-catalogue',
    name: 'A component nobody can find is a component that will be duplicated',
    why: 'Measured 2026-11-27: `src/components` holds **117 components, none orphaned, 86% reused** — and '
      + 'nobody could see them. The same wager `tools-index.cjs` already paid for (**175 tools, 75 orphans**, '
      + 'and three separate proposals to build things already in the list). Every duplicated widget is a '
      + 'second copy that drifts, and only one of the two gets the next fix.',
    gate: 'scripts/components-index.cjs',
    verify: 'npm run components',
    selfTest: 'npm run components:self-test',
    enforcedIn: 'prebuild',
  },
  {
    id: 'page-data-access',
    name: 'A page reads data through the shared client',
    why: 'Measured 2026-11-26: 45 real `fetch(` calls across 21 files bypassed `src/core/api/client.js`, '
      + 'which is not a convenience wrapper — it is the only thing that aborts a stalled request at 28 s '
      + 'and the only thing that turns Nest\u2019s `{ message }` into `err.detail`, so "market closed" can '
      + 'be shown as a reason instead of a bare status. A raw call has no timeout and no error path.',
    gate: 'scripts/validate-page-data-access.cjs',
    verify: 'npm run data-access',
    selfTest: 'npm run data-access:self-test',
    enforcedIn: 'prebuild',
  },
  {
    id: 'page-colour-literals',
    name: 'A page declares no colour of its own inside an inline style',
    why: 'A hex in `style={{ }}` is invisible to the CSS cascade, so no theme pack can override it — and '
      + 'the accessibility fix that replaced `#ef4444` with `--color-loss` never reached 50 of them. '
      + '⚠️ The figure this replaced was "2,487 hex across 112 page files"; re-measured with a stated '
      + 'basis (hex inside `style={{ }}`, 6/8-digit only) it was 263 in 48 files. The 2,487 also counted '
      + 'issue references in prose (`#782`), `*.css`, and SVG diagram fills — content, not styling.',
    gate: 'scripts/validate-colour-literals.cjs',
    verify: 'npm run colours',
    selfTest: 'npm run colours:self-test',
    enforcedIn: 'prebuild',
  },
];

/** Grouped for display: met (a gate exists) versus declared gap (no gate). */
export function standardsByStatus() {
  return {
    met: STANDARDS.filter((s) => s.gate),
    gaps: STANDARDS.filter((s) => !s.gate),
  };
}
