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
    why: '`src/core/format-utils.js` exists and 26 pages import it, but 8 pages declare their own '
      + '`fmtPct`/`fmtTime`/`fmtMoney`/`fmtWhen`/`num2` with DIFFERENT behaviour for the same name.',
    gate: null,
    gap: 'No gate. Needs a scan for locally-declared formatters that shadow format-utils.',
    verify: null,
    selfTest: null,
    enforcedIn: 'none',
  },
  {
    id: 'page-data-access',
    name: 'A page reads data through the shared client',
    why: '37 raw `fetch()` calls in `src/pages` bypass the client and its error handling.',
    gate: null,
    gap: 'No gate. Needs a scan for `fetch(` in `src/pages`.',
    verify: null,
    selfTest: null,
    enforcedIn: 'none',
  },
  {
    id: 'page-colour-literals',
    name: 'A page declares no colour of its own',
    why: '2,487 hex literals across 112 page files; a hex ignores every theme pack by construction.',
    gate: null,
    gap: 'No gate. `validate-css-tokens` covers stylesheets only, not inline styles in JSX.',
    verify: null,
    selfTest: null,
    enforcedIn: 'none',
  },
];

/** Grouped for display: met (a gate exists) versus declared gap (no gate). */
export function standardsByStatus() {
  return {
    met: STANDARDS.filter((s) => s.gate),
    gaps: STANDARDS.filter((s) => !s.gate),
  };
}
