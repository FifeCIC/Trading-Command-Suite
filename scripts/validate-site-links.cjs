#!/usr/bin/env node
/**
 * validate-site-links.cjs — the public site has no build step, so nothing catches a broken link.
 * ================================================================================================
 *
 * WHY THIS EXISTS (2026-11-01)
 * ---------------------------
 * `site/` is hand-authored HTML served by GitHub Pages. Unlike `src/`, it has NO compiler, NO
 * bundler and NO test — so a renamed section, a moved asset or a typo produces a dead link that
 * nobody sees until a visitor does. That is the "plausible output, no error" shape this repo keeps
 * closing, except the plausible output is a 404.
 *
 * It found two real defects on the first run, both introduced by an agent the same day:
 *
 *   1. `404.html` used RELATIVE links (`./`, `showcase/`). GitHub Pages serves that file at the
 *      ARBITRARY path that was not found — so `showcase/` resolved to
 *      `/Trading-Command-Suite/typo/path/showcase/`, which is also not found. A 404 page whose
 *      every escape route is broken is worse than the default one.
 *   2. An `og:image` was a relative path, which resolves in a browser and to nothing in a crawler.
 *
 * Usage:
 *   node scripts/validate-site-links.cjs               report
 *   node scripts/validate-site-links.cjs --self-test   prove every rule can fail (no site needed)
 *
 * Exit: 0 = every link resolves · 1 = at least one broken link · 2 = cannot run
 *
 * ⚠️ It checks what can be checked statically. A link to `https://example.com` is not fetched:
 * a checker that makes network calls fails when the network does, and then gets allowlisted.
 */

const fs = require('fs');
const path = require('path');

const SITE = path.resolve(__dirname, '..', 'site');
/** Pages serves this repo at a subpath. Absolute site links must carry it. */
const PAGES_BASE = '/Trading-Command-Suite/';

/** Attributes that can point at a local file. */
const REF_ATTR = /\b(?:href|src)\s*=\s*"([^"]+)"/g;

function isExternal(ref) {
  return /^(?:https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(ref);
}

function stripFragment(ref) {
  const i = ref.indexOf('#');
  return i === -1 ? { path: ref, frag: null } : { path: ref.slice(0, i), frag: ref.slice(i + 1) };
}

/**
 * Collect every reference in one HTML file, classified.
 * ⚠️ Pure — takes the file text and its directory, touches no disk — so `--self-test` can drive it.
 */
function collectRefs(html, fromDir) {
  const out = [];
  for (const m of html.matchAll(REF_ATTR)) {
    const raw = m[1];
    if (!raw.trim()) continue;
    if (isExternal(raw)) {
      out.push({ raw, kind: 'external' });
      continue;
    }
    const { path: p, frag } = stripFragment(raw);
    if (!p) {
      // `href="#section"` — same-file anchor.
      out.push({ raw, kind: 'anchor', target: null, frag });
      continue;
    }
    const resolved = p.startsWith('/')
      ? // An absolute site path must be under the Pages base, or it points outside this site.
        p.startsWith(PAGES_BASE)
        ? path.join(SITE, p.slice(PAGES_BASE.length))
        : null
      : path.resolve(fromDir, p);
    out.push({ raw, kind: p.startsWith('/') ? 'absolute' : 'relative', target: resolved, frag });
  }
  return out;
}

/** Does this file exist, treating a directory as its index.html? */
function targetExists(p) {
  if (!p) return false;
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return fs.existsSync(path.join(p, 'index.html'));
  return fs.existsSync(p);
}

/** Does the target file actually contain `id="frag"` (or `name="frag"`)? */
function hasAnchor(p, frag) {
  if (!frag) return true;
  const file = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!fs.existsSync(file)) return false;
  const html = fs.readFileSync(file, 'utf8');
  const needle = new RegExp(`\\bid\\s*=\\s*"${frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
  return needle.test(html);
}

/**
 * Every `data-fact` value rendered on the site, as written in the HTML.
 *
 * ⚠️ WHY THIS IS A GUARD AND NOT A BUILD-TIME SUBSTITUTION. The landing page states counts
 * (directives, adapters, models, glossary). Those are the kind of number that is correct on the day
 * it is typed and quietly wrong six weeks later — and a stale count on a public page is a false
 * claim, which is the failure this project keeps closing elsewhere. Substituting at publish time
 * would make the checked file differ from the committed one; checking instead means the page is
 * always the truth, and a drift FAILS THE BUILD naming the fact and both numbers.
 *
 * Pure: takes the html text and a facts map, so `--self-test` can drive it without disk.
 */
function collectFactValues(html) {
  const out = [];
  const re = /data-fact="([^"]+)"[^>]*>([^<]*)</g;
  let m;
  while ((m = re.exec(html)) !== null) out.push({ key: m[1], raw: String(m[2]).trim() });
  return out;
}

function factsErrors(rel, html, facts) {
  const errors = [];
  for (const { key, raw } of collectFactValues(html)) {
    const fact = facts[key];
    if (!fact) {
      errors.push(`${rel}: data-fact="${key}" is not a key in docs/generated-facts.json`);
      continue;
    }
    const shown = Number(raw.replace(/[^0-9.-]/g, ''));
    if (raw === '' || !Number.isFinite(shown)) {
      errors.push(`${rel}: data-fact="${key}" has no number ("${raw}") — a blank fact reads as zero`);
      continue;
    }
    if (shown !== fact.value) {
      errors.push(
        `${rel}: ${key} shows ${shown} but the generated facts say ${fact.value}` +
          ' — regenerate with `node scripts/docs-facts.cjs --write`, or correct the page',
      );
    }
  }
  return errors;
}

function checkSite() {
  if (!fs.existsSync(SITE)) {
    console.error('[site-links] cannot run: site/ does not exist');
    return 2;
  }
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.html')) files.push(abs);
    }
  })(SITE);

  const errors = [];
  // ⚠️ An unreadable facts file must ERROR, never pass. "Inspected nothing and reported OK" is the
  // exact shape of a guard that is worse than no guard.
  let facts = {};
  const factsPath = path.resolve(__dirname, '..', 'docs', 'generated-facts.json');
  try {
    facts = JSON.parse(fs.readFileSync(factsPath, 'utf8')).facts || {};
  } catch (err) {
    console.error(`[site-links] cannot run: unreadable ${factsPath} — ${err.message}`);
    return 2;
  }
  for (const file of files) {
    const rel = path.relative(SITE, file);
    const html = fs.readFileSync(file, 'utf8');

    // ── Rule: 404.html must not depend on the request path ──
    // GitHub serves it at whatever path failed, so a relative link resolves somewhere that also
    // does not exist. Either a <base> or absolute URLs are required.
    if (path.basename(file) === '404.html' && !/<base\s+href=/i.test(html)) {
      errors.push(`${rel}: 404.html has no <base href> — relative links resolve under the missing path`);
    }

    for (const ref of collectRefs(html, path.dirname(file))) {
      if (ref.kind === 'external') continue;
      if (ref.kind === 'anchor') {
        if (!hasAnchor(file, ref.frag)) errors.push(`${rel}: #${ref.frag} — no such id in this file`);
        continue;
      }
      if (ref.kind === 'absolute' && ref.target === null) {
        errors.push(`${rel}: "${ref.raw}" — absolute path outside ${PAGES_BASE}`);
        continue;
      }
      if (!targetExists(ref.target)) {
        errors.push(`${rel}: "${ref.raw}" — target does not exist`);
        continue;
      }
      if (ref.frag && !hasAnchor(ref.target, ref.frag)) {
        errors.push(`${rel}: "${ref.raw}" — target file has no id="${ref.frag}"`);
      }
    }

    // Numbers must agree with the generated facts (see `factsErrors`).
    errors.push(...factsErrors(rel, html, facts));
  }

  if (errors.length === 0) {
    console.log(`[site-links] ✅ OK — ${files.length} page(s), every local reference resolves`);
    return 0;
  }
  console.log(`[site-links] ❌ ${errors.length} broken reference(s) across ${files.length} page(s):`);
  for (const e of errors) console.log(`  • ${e}`);
  return 1;
}

// ── Self-test: every rule must be able to fail ─────────────────────────────────────────────────

function selfTest() {
  let fail = 0;
  const check = (name, cond) => {
    if (!cond) fail++;
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
  };

  const dir = path.resolve(__dirname, '..', 'logs', '_site-link-fixtures');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'logo.png'), 'x');
  fs.writeFileSync(path.join(dir, 'index.html'), `<h1 id="top">ok</h1><a href="assets/logo.png">ok</a><a href="#top">ok</a>`);
  fs.writeFileSync(path.join(dir, 'broken.html'), `<a href="assets/missing.png">no</a>`);
  fs.writeFileSync(path.join(dir, 'bad-anchor.html'), `<a href="#nope">no</a>`);
  fs.writeFileSync(path.join(dir, '404.html'), `<a href="./">relative</a>`);
  fs.writeFileSync(path.join(dir, 'outside.html'), `<a href="/somewhere-else/x">outside</a>`);

  const good = collectRefs(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), dir);
  check('a valid relative, anchor and existing asset all resolve',
    good.every((r) => r.kind === 'external' || (r.kind === 'anchor' ? hasAnchor(path.join(dir, 'index.html'), r.frag) : targetExists(r.target))));

  const broken = collectRefs(fs.readFileSync(path.join(dir, 'broken.html'), 'utf8'), dir);
  check('a missing asset is DETECTED', broken.some((r) => !targetExists(r.target)));

  check('a missing anchor is DETECTED',
    !hasAnchor(path.join(dir, 'index.html'), 'not-a-real-id'));

  const outside = collectRefs(fs.readFileSync(path.join(dir, 'outside.html'), 'utf8'), dir);
  check('an absolute path outside the Pages base is DETECTED',
    outside.some((r) => r.kind === 'absolute' && r.target === null));

  check('404.html without <base> is DETECTED',
    !/<base\s+href=/i.test(fs.readFileSync(path.join(dir, '404.html'), 'utf8')));
  check('404.html WITH <base> passes',
    /<base\s+href=/i.test('<base href="/Trading-Command-Suite/">'));

  check('external and mailto refs are skipped, never fetched',
    collectRefs('<a href="https://x.test/y">a</a><a href="mailto:a@b.c">b</a>', dir).every((r) => r.kind === 'external'));

  // ── Facts: the numbers on the public page ──
  const facts = { directiveFiles: { value: 94 } };
  check('a fact matching the generated value PASSES',
    factsErrors('p.html', '<span class="fact-value" data-fact="directiveFiles">94</span>', facts).length === 0);
  check('a DRIFTED fact is DETECTED',
    factsErrors('p.html', '<span class="fact-value" data-fact="directiveFiles">95</span>', facts).length === 1);
  check('an unknown fact key is DETECTED',
    factsErrors('p.html', '<span class="fact-value" data-fact="no-such-fact">1</span>', facts).length === 1);
  check('a blank fact value is DETECTED',
    factsErrors('p.html', '<span class="fact-value" data-fact="directiveFiles"></span>', facts).length === 1);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n[site-links] ${fail === 0 ? 'PASSED' : 'FAILED'} — ${fail} failure(s)`);
  return fail === 0 ? 0 : 1;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  process.exit(argv.includes('--self-test') ? selfTest() : checkSite());
}

module.exports = { collectRefs, targetExists, hasAnchor, collectFactValues, factsErrors };
