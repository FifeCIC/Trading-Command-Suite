#!/usr/bin/env node
/**
 * publish-public-docs.cjs — publish the financial disclaimer to the wiki, and the landing page to Pages.
 * =====================================================================================================
 *
 * WHY THIS EXISTS (2026-10-31)
 * ---------------------------
 * The owner asked for `DISCLAIMER.md` to be on the public GitHub Pages site and the wiki. Measured, and
 * the short answer was **"there is nothing to publish to yet"**:
 *
 *   repo visibility   private
 *   has_pages         false        GET /pages → 404
 *   has_wiki          false        PATCH has_wiki=true returns 200 and CHANGES NOTHING
 *   org plan          free
 *
 * The wiki PATCH was ignored **while the token held `permissions.admin: true`**, `updated_at` never
 * moved, and it was reproduced with `-f` (string) and `-F` (typed boolean) and with `gh` directly —
 * so it is not the wrapper and not a missing permission. On a free plan, wikis and Pages are
 * unavailable for PRIVATE repositories. ⚠️ That cause is INFERRED: GitHub returned no error naming
 * it. What is measured is that the toggle is a silent no-op.
 *
 * So this exists to make the publish **one command at the moment the repository goes public**, rather
 * than a procedure someone has to reconstruct from an issue.
 *
 * THE ONE-COPY RULE
 * -----------------
 * ⚠️ The wiki page is WRITTEN FROM `DISCLAIMER.md` — it is not a second hand-maintained copy. Two
 * copies of the same legal text drift, and the copy a user actually accepted is the one that matters.
 * `site/index.html` carries a SHORT risk summary and links to the canonical file; a summary is a
 * pointer, not a duplicate.
 *
 * Usage:
 *   node scripts/publish-public-docs.cjs                dry run (default) — reports, changes nothing
 *   node scripts/publish-public-docs.cjs --apply        actually publish
 *   node scripts/publish-public-docs.cjs --self-test    prove the preflight can fail (no network)
 *   node scripts/publish-public-docs.cjs --repo X/Y     override the repository
 *
 * Exit: 0 = done (or dry run clean) · 1 = refused, with a named reason · 2 = cannot determine state
 *
 * ⚠️ IT NEVER FORCES ANYTHING. No `git push --force`, no branch rewrite, no visibility change. It
 * cannot make a repository public — that is the owner's decision and it is not reversible in the
 * way the rest of this script is.
 *
 * ⚠️ DRY RUN IS THE DEFAULT, deliberately. Publishing is outward-facing: the difference between "I
 * checked" and "I published" has to be a flag someone typed, not a default they inherited.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPO = 'FifeCIC/Trading-Command-Suite';
const DISCLAIMER = path.join(ROOT, 'DISCLAIMER.md');
const SITE_INDEX = path.join(ROOT, 'site', 'index.html');
/** The wiki page name. GitHub derives the URL from this; changing it breaks every existing link. */
const WIKI_PAGE = 'Financial-Disclaimer.md';
const WIKI_HOME = 'Home.md';
/** Pages serves this folder. `site/` is intentional: it is NOT `docs/`, which holds internal reference. */
const PAGES_PATH = '/site';

// ── The decision, isolated so it can be tested without a network ────────────────────────────────

/**
 * decidePreflight(state) → { ok, wiki, pages, warnings }
 *
 * Pure. Every rule below was chosen because its absence produces a publish that LOOKS successful:
 * a wiki pushed to a remote nobody can reach, a Pages site whose landing page is a 404, or a wiki
 * page linking to a file the public repository does not contain.
 *
 * ⚠️ THE TWO SURFACES ARE INDEPENDENT, and that is a correction made after a live run. A single
 * shared verdict meant an uncommitted `site/` folder refused the WIKI as well — a publish that works
 * blocked by a publish that does not. Each surface now reports its own blockers.
 */
function decidePreflight(s) {
  const shared = [];
  const wiki = [];
  const pages = [];
  const warnings = [];

  if (!s.disclaimerExists) {
    shared.push('DISCLAIMER.md is missing — there is nothing to publish');
  }
  if (s.visibility !== 'public') {
    shared.push(
      `repository is ${s.visibility} — wikis and Pages are unavailable for private repos on the free ` +
        'plan, so anything published would be unreachable',
    );
  }

  // ── wiki ──
  if (!s.hasWiki) {
    wiki.push('has_wiki is false — the wiki git remote does not exist, so there is nowhere to push');
  }
  if (!s.disclaimerTracked) {
    // Not fatal: the wiki page is generated from the local file, which is correct. But the page
    // links to the canonical file IN THE REPO, and an uncommitted file makes that a dead link.
    warnings.push(
      'DISCLAIMER.md is not committed — the published page will link to a file the public repo lacks',
    );
  }

  // ── pages ──
  if (!s.siteIndexExists) {
    pages.push('site/index.html is missing — Pages would serve a 404 landing page');
  } else if (!s.siteIndexTracked) {
    // ⚠️ MEASURED 2026-10-31: `site/` existed on disk and was UNTRACKED. Enabling Pages from
    // `master:/site` in that state publishes a 404 — the local file is invisible to GitHub, and
    // nothing about the API call fails. Existence on disk is not existence in the repository.
    pages.push(
      'site/index.html is NOT COMMITTED — enabling Pages from master:/site would publish a 404; ' +
        'commit and push site/ first',
    );
  }
  if (!s.secretScanning) {
    warnings.push(
      'secret scanning is not enabled — free on public repos; it should be on before history is exposed',
    );
  }

  const withShared = (own) => [...shared, ...own];
  return {
    ok: withShared(wiki).length === 0 || withShared(pages).length === 0,
    wiki: { ok: withShared(wiki).length === 0, blockers: withShared(wiki) },
    pages: { ok: withShared(pages).length === 0, blockers: withShared(pages) },
    warnings,
  };
}

// ── Self-test: the preflight must be able to fail, in both directions ───────────────────────────

const GOOD = {
  disclaimerExists: true,
  siteIndexExists: true,
  siteIndexTracked: true,
  visibility: 'public',
  hasWiki: true,
  disclaimerTracked: true,
  secretScanning: true,
};

function selfTest() {
  // [name, state, wantWikiOk, wantPagesOk]
  const cases = [
    ['a fully ready repo publishes both', GOOD, true, true],
    ['a PRIVATE repo refuses both', { ...GOOD, visibility: 'private' }, false, false],
    ['a missing disclaimer refuses both', { ...GOOD, disclaimerExists: false }, false, false],
    ['wikis off refuses the WIKI ONLY', { ...GOOD, hasWiki: false }, false, true],
    ['site index missing refuses PAGES ONLY', { ...GOOD, siteIndexExists: false }, true, false],
    // ⚠️ THE REGRESSION CASE. Measured 2026-10-31: `site/` existed on disk and was untracked, and the
    // first version of this preflight passed it. Enabling Pages there publishes a 404 with no error.
    ['site index UNCOMMITTED refuses PAGES ONLY', { ...GOOD, siteIndexTracked: false }, true, false],
    ['an uncommitted disclaimer WARNS but passes', { ...GOOD, disclaimerTracked: false }, true, true],
    ['secret scanning off WARNS but passes', { ...GOOD, secretScanning: false }, true, true],
  ];

  let fail = 0;
  for (const [name, state, wantWiki, wantPages] of cases) {
    const r = decidePreflight(state);
    const ok = r.wiki.ok === wantWiki && r.pages.ok === wantPages;
    if (!ok) fail++;
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${name} → wiki=${r.wiki.ok} pages=${r.pages.ok}` +
        (ok ? '' : ` (want wiki=${wantWiki} pages=${wantPages})`),
    );
  }

  // ⚠️ Asserted as a RULE, not a case: a surface reporting ok must carry no blockers, and reporting
  // not-ok must carry at least one. A verdict that contradicts itself is worse than none.
  const consistent = [
    { ...GOOD, visibility: 'private' },
    { ...GOOD, hasWiki: false },
    { ...GOOD, siteIndexTracked: false },
    { ...GOOD, disclaimerExists: false },
    GOOD,
  ].every((s) => {
    const r = decidePreflight(s);
    return [r.wiki, r.pages].every((v) => (v.ok ? v.blockers.length === 0 : v.blockers.length > 0));
  });
  console.log(`  ${consistent ? 'PASS' : 'FAIL'}  every surface verdict agrees with its own blockers`);
  if (!consistent) fail++;

  const warnStillPasses = decidePreflight({ ...GOOD, disclaimerTracked: false, secretScanning: false });
  const warnsDontBlock =
    warnStillPasses.wiki.ok && warnStillPasses.pages.ok && warnStillPasses.warnings.length === 2;
  console.log(`  ${warnsDontBlock ? 'PASS' : 'FAIL'}  warnings do not become blockers`);
  if (!warnsDontBlock) fail++;

  console.log(`\n[publish-public-docs] ${fail === 0 ? 'PASSED' : 'FAILED'} — ${fail} failure(s)`);
  return fail === 0 ? 0 : 1;
}

// ── Live state ──────────────────────────────────────────────────────────────────────────────────

function gh(args) {
  return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8' });
}

function readState(repo) {
  const raw = gh(['api', `repos/${repo}`]);
  const r = JSON.parse(raw);
  let tracked = false;
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', 'DISCLAIMER.md'], { cwd: ROOT, stdio: 'pipe' });
    tracked = true;
  } catch {
    tracked = false;
  }
  const sa = r.security_and_analysis || {};
  let siteTracked = false;
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', 'site/index.html'], { cwd: ROOT, stdio: 'pipe' });
    siteTracked = true;
  } catch {
    siteTracked = false;
  }
  return {
    disclaimerExists: fs.existsSync(DISCLAIMER),
    siteIndexExists: fs.existsSync(SITE_INDEX),
    siteIndexTracked: siteTracked,
    visibility: r.visibility,
    hasWiki: r.has_wiki === true,
    disclaimerTracked: tracked,
    secretScanning: sa.secret_scanning?.status === 'enabled',
    hasPages: r.has_pages === true,
    htmlUrl: r.html_url,
  };
}

// ── Publish steps ──────────────────────────────────────────────────────────────────────────────

function publishWiki(repo, disclaimerBody, apply) {
  const url = `https://github.com/${repo}.wiki.git`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tcs-wiki-'));
  console.log(`\n[wiki] ${url}`);
  if (!apply) {
    console.log(`  would write ${WIKI_PAGE} (${disclaimerBody.split('\n').length} lines, from DISCLAIMER.md)`);
    console.log(`  would create ${WIKI_HOME} only if absent`);
    return 'dry-run';
  }
  try {
    execFileSync('git', ['clone', url, tmp], { stdio: 'pipe' });
  } catch {
    // ⚠️ MEASURED 2026-10-31: `has_wiki: true` does NOT mean the wiki git repository exists. GitHub
    // creates `<repo>.wiki.git` when the FIRST page is saved in the browser, and there is no REST
    // API that creates one — so this cannot be bootstrapped from a script, however many permissions
    // the token holds. Before this was handled, the run died with a Node stack trace, which reads as
    // "the script is broken" rather than "one manual step is missing".
    console.log(`  ⚠️  the wiki repository does not exist yet — GitHub creates it when the first page`);
    console.log(`      is saved in the browser. ONE manual step: open https://github.com/${repo}/wiki and`);
    console.log(`      click "Create the first page", save anything, then re-run this script.`);
    return 'needs-bootstrap';
  }
  fs.writeFileSync(path.join(tmp, WIKI_PAGE), disclaimerBody, 'utf8');
  const home = path.join(tmp, WIKI_HOME);
  if (!fs.existsSync(home)) {
    // ⚠️ Only created when absent. A Home page is the wiki's front door and someone may have edited
    // it; overwriting it would destroy prose this script knows nothing about.
    fs.writeFileSync(
      home,
      ['# Trading Command Suite — wiki', '', '> 🛑 **[Financial Disclaimer](' + WIKI_PAGE.replace(/\.md$/, '') + ')** —',
        '> read this before connecting any account. The software is not configured to profit by default.', '',
        'The source of truth for this wiki is the repository. See the [README](../..).', ''].join('\n'),
      'utf8',
    );
    console.log(`  created ${WIKI_HOME}`);
  } else {
    console.log(`  ${WIKI_HOME} exists — left untouched`);
  }
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: tmp, encoding: 'utf8' }).trim();
  if (!status) {
    console.log('  nothing to commit — wiki already current');
    return 'no-change';
  }
  execFileSync('git', ['add', WIKI_PAGE, WIKI_HOME], { cwd: tmp, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'Publish financial disclaimer from DISCLAIMER.md'], { cwd: tmp, stdio: 'pipe' });
  execFileSync('git', ['push'], { cwd: tmp, stdio: 'pipe' });
  console.log('  pushed');
  return 'published';
}

function publishPages(repo, state, apply) {
  console.log(`\n[pages] source: branch master, path ${PAGES_PATH}`);
  if (state.hasPages) {
    console.log('  already enabled — not touching its configuration');
    return 'already-enabled';
  }
  if (!apply) {
    console.log('  would enable Pages from master:/site');
    return 'dry-run';
  }
  gh(['api', '-X', 'POST', `repos/${repo}/pages`, '-f', 'source[branch]=master', '-f', `source[path]=${PAGES_PATH}`]);
  console.log('  enabled');
  return 'enabled';
}

// ── Main ───────────────────────────────────────────────────────────────────────────────────────

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: node scripts/publish-public-docs.cjs [--apply] [--repo owner/name] [--self-test]');
    return 0;
  }
  const iRepo = argv.indexOf('--repo');
  const repo = iRepo >= 0 && argv[iRepo + 1] ? argv[iRepo + 1] : DEFAULT_REPO;
  const apply = argv.includes('--apply');

  let state;
  try {
    state = readState(repo);
  } catch (err) {
    console.error(`[publish-public-docs] cannot read repository state: ${err.message.split('\n')[0]}`);
    return 2;
  }

  const verdict = decidePreflight(state);
  console.log(`[publish-public-docs] ${repo} — ${state.visibility}, wiki=${state.hasWiki}, pages=${state.hasPages}`);
  for (const w of verdict.warnings) console.log(`  ⚠️  ${w}`);

  const report = (label, v) => {
    if (v.ok) return;
    console.log(`  🛑 ${label}:`);
    for (const b of v.blockers) console.log(`       ${b}`);
  };
  report('wiki cannot publish', verdict.wiki);
  report('pages cannot publish', verdict.pages);

  if (!verdict.ok) {
    console.log('\nREFUSED — nothing published. Neither surface is ready, and none of the blockers');
    console.log('above can be cleared from this script: making a repository public is the owner\'s decision,');
    console.log('and an uncommitted file is fixed by committing it, not by changing a setting.');
    return 1;
  }

  const body = fs.readFileSync(DISCLAIMER, 'utf8');
  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN — pass --apply to publish'}`);
  if (verdict.wiki.ok) publishWiki(repo, body, apply);
  if (verdict.pages.ok) publishPages(repo, state, apply);

  if (apply) {
    const pagesUrl = `https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/`;
    if (verdict.wiki.ok) console.log(`\nWiki:  ${state.htmlUrl}/wiki`);
    if (verdict.pages.ok) console.log(`Pages: ${pagesUrl} (first build takes a minute)`);
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { decidePreflight };
