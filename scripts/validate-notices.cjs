#!/usr/bin/env node
/**
 * validate-notices.cjs — the notice-registry gate
 * ==============================================
 * Created 2026-09-15 with `src/core/notices/registry.js`.
 *
 * The registry only works if it is the SINGLE source of truth. That breaks the moment somebody
 * emits a code that was never registered, or registers one that is malformed — so both are checked
 * here, and this runs in the backend `prebuild` alongside the other contract gates.
 *
 * WHAT IT CHECKS
 * --------------
 *   1. Every code matches `TCS-<AREA>-<NNN>` and its AREA segment agrees with the entry's `area`.
 *   2. `severity` is one of the declared severities.
 *   3. `title` and `message` exist and are non-empty.
 *   4. Every `{placeholder}` used in title/message/cause/action is declared in `params`.
 *   5. No `params` entry is declared twice.
 *   6. **Every `TCS-…` literal found anywhere in the codebase is registered.**
 *   7. (report only) codes registered but not referenced anywhere — usually a sign the caller was
 *      never migrated, so it is worth seeing rather than failing on.
 *   8. **#826 Phase 1 — the backend catalogue agrees with this registry.** The NestJS side cannot
 *      import the registry (the two roots share no build), so it mirrors a *subset* of it in
 *      `nest/src/common/notices/notice-catalogue.ts` for the two things only the server can know:
 *      the HTTP status, and the log severity. This gate is what stops that mirror drifting — and
 *      what forces a code the backend EMITS to be declared there.
 *   9. **#826 Phase 6 — the published catalogue is not stale.** `docs/NOTICE-CODES.md` is generated
 *      from the registry and compared byte-for-byte, so a published code reference cannot rot.
 *  10. **#826 Phase 6 — locale bundles are structurally sound.** Every translated code must exist,
 *      must not rename itself, and must not use a placeholder its code does not declare.
 *
 * Usage:
 *   node scripts/validate-notices.cjs            # gate (exit 1 on a problem)
 *   node scripts/validate-notices.cjs --list     # print the catalogue
 *   node scripts/validate-notices.cjs --md       # the catalogue as a markdown document on stdout
 *   node scripts/validate-notices.cjs --md --out=docs/NOTICE-CODES.md   # write it (UTF-8, correct)
 *   node scripts/validate-notices.cjs --self-test
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const REPO_ROOT = path.resolve(__dirname, '..');
const REGISTRY = path.join(REPO_ROOT, 'src', 'core', 'notices', 'registry.js');
/** Locale bundles, if any. Registered translations live here so the gate can check they stay valid. */
const LOCALES_DIR = path.join(REPO_ROOT, 'src', 'core', 'notices', 'locales');
/**
 * The PUBLISHED catalogue (category C, reference). Generated, and drift-checked — see
 * buildCatalogueDoc(). It is also excluded from the reference scan below: it mentions every code,
 * so counting it would make the "registered but not referenced" report always say zero.
 */
const CATALOGUE_DOC = path.join(REPO_ROOT, 'docs', 'NOTICE-CODES.md');

/**
 * #826 Phase 5 — the RATCHET on raw error rendering in the UI.
 *
 * WHAT IT MEASURES
 * ----------------
 * A "raw error render" is a place where a user is shown an error whose only identity is its wording:
 * `error.message`, `err.message`, `{error}`. Those are the sites where the status, the code and the
 * remedy have all been discarded — the defect #824 exposed, where the user was shown the broker's
 * bare sentence "Unsupported filling mode".
 *
 * WHY A RATCHET RATHER THAN A RULE
 * --------------------------------
 * 19 files cannot be migrated in one honest pass, and a rule that fails on all 19 would be switched
 * off — this repo has already measured that (a guard that fires on correct behaviour gets disabled).
 * So the remaining count is DECLARED in `scripts/notice-ui-surfaces.json`, and:
 *
 *   - a file that GROWS                     → fails (regression)
 *   - a file that SHRINKS                   → also fails, until the number is lowered
 *   - a new file with raw renders           → fails (migrate it, or declare it deliberately)
 *
 * The shrink rule looks pedantic and is the important one: without it the declared number becomes a
 * claim nobody re-checks, which is exactly how #638's ticked-but-unverified checkbox happened.
 *
 * ⚠️ COMMENTS ARE STRIPPED BEFORE COUNTING. The comment explaining a migration naturally mentions
 * `error.message`; counting those would mean the number could never fall, and would let an agent
 * "fix" the metric with a comment. Full-line `//` and all block comments are removed — a trailing
 * inline `//` is not, a documented limit.
 */
const UI_ALLOWANCE_FILE = path.join(__dirname, 'notice-ui-surfaces.json');
const UI_SCAN_ROOT = path.join(REPO_ROOT, 'src');
/** The notices machinery itself handles raw messages — it is the thing doing the converting. */
const UI_SKIP_PREFIX = [path.join(UI_SCAN_ROOT, 'core', 'notices')];
/**
 * ⚠️ THE PROXY IS `…message`, AND ONLY THAT. An earlier version also counted `{error}`, which matched
 * `notice={error}` — the CORRECT migrated form — so it flagged good code as bad and would have been
 * switched off within a week. The defensible definition of the defect is narrower and truer:
 * extracting `.message` from an error is the moment its code, status and remedy are discarded.
 *
 * ⚠️ LIMIT: it cannot see an error STRING passed as a child (`<p>{message}</p>`), because by then the
 * provenance is invisible. This makes Phase 5 measurable and monotonic; it is not a detector.
 */
const RAW_ERROR_PATTERNS = [/(\b(error|err|e)\??\.message\b)/g];

/** Remove block comments and full-line `//` comments, so a comment cannot move the number. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

/** Count raw error renders per UI file. Map of repo-relative path -> count, entries with 0 omitted. */
function scanUiSurfaces() {
  const files = [];
  walk(UI_SCAN_ROOT, files);
  const counts = new Map();

  for (const full of files) {
    const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
    if (!/\.(jsx|js)$/.test(rel)) continue;
    if (rel.endsWith('.test.js')) continue;
    if (UI_SKIP_PREFIX.some((p) => full.startsWith(p))) continue;

    let body;
    try {
      body = stripComments(fs.readFileSync(full, 'utf8'));
    } catch {
      continue;
    }
    let hits = 0;
    for (const pattern of RAW_ERROR_PATTERNS) hits += (body.match(pattern) || []).length;
    if (hits > 0) counts.set(rel, hits);
  }

  return counts;
}

/**
 * Compare the live count against the declared allowance. Pure, so `--self-test` can prove it fails
 * in both directions on fixtures rather than asserting on the real tree and hoping.
 */
function validateUiAllowance(actual, allowance) {
  const errors = [];
  let remaining = 0;

  for (const [file, count] of actual) {
    remaining += count;
    const declared = allowance[file];
    if (declared === undefined) {
      errors.push(
        `  UI: ${file} renders ${count} raw error(s) and is not declared — migrate it, or add it to scripts/notice-ui-surfaces.json`,
      );
    } else if (count > declared) {
      errors.push(`  UI: ${file} went from ${declared} to ${count} raw error render(s) — regression`);
    } else if (count < declared) {
      errors.push(
        `  UI: ${file} is down to ${count} from ${declared} raw error render(s) — record it: node scripts/validate-notices.cjs --update-allowance`,
      );
    }
  }

  for (const [file, declared] of Object.entries(allowance)) {
    if (!actual.has(file)) {
      errors.push(
        `  UI: ${file} no longer renders any raw error — remove its entry (${declared}) with --update-allowance`,
      );
    }
  }

  return { errors, remaining };
}

function readUiAllowance() {
  if (!fs.existsSync(UI_ALLOWANCE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(UI_ALLOWANCE_FILE, 'utf8')).files ?? {};
  } catch {
    return {};
  }
}

const SCAN_ROOTS = ['src', 'nest/src', 'nest/scripts', 'scripts', '.github', 'docs'];
const SCAN_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.md', '.py', '.ps1']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', 'backups', 'logs', 'data']);

/**
 * Files excluded from the reference scan.
 *
 *   - the registry itself: it is where codes are DEFINED, so every code would trivially "resolve"
 *   - this validator: its `--self-test` fixtures must be deliberately malformed, and its examples
 *     are illustrative. Neither is a real caller.
 *
 * ⚠️ Excluding it means a genuine unregistered reference inside this file would slip through. That
 * is an accepted trade: this is tooling, not application code, and the alternative is putting
 * throwaway `TCS-TEST-*` codes in the production registry.
 */
const SKIP_FILES = new Set([
  REGISTRY,
  path.join(REPO_ROOT, 'scripts', 'validate-notices.cjs'),
  CATALOGUE_DOC,
]);

/** Matches a notice code in source text. Kept in sync with CODE_PATTERN in the registry. */
const CODE_IN_TEXT = /\bTCS-[A-Z]{2,6}-\d{3}\b/g;

/**
 * Pure validation of a registry map — takes the map as an argument so `--self-test` can feed it
 * deliberately broken fixtures instead of asserting on the real file and hoping.
 */
function validateNotices(map, severities, codePattern) {
  const errors = [];
  const warnings = [];
  const codes = Object.keys(map || {});

  for (const code of codes) {
    const def = map[code];
    const at = `  ${code}`;

    const m = codePattern.exec(code);
    if (!m) {
      errors.push(`${at}: does not match TCS-<AREA>-<NNN>`);
    } else if (def.area !== m[1]) {
      errors.push(`${at}: area '${def.area}' does not match the code segment '${m[1]}'`);
    }

    if (!severities.includes(def.severity)) {
      errors.push(`${at}: severity '${def.severity}' is not one of ${severities.join(', ')}`);
    }
    for (const field of ['title', 'message']) {
      if (typeof def[field] !== 'string' || def[field].trim() === '') {
        errors.push(`${at}: '${field}' is required and must be a non-empty string`);
      }
    }

    const declared = Array.isArray(def.params) ? def.params : [];
    if (!Array.isArray(def.params)) {
      errors.push(`${at}: 'params' must be an array (use [] when there are none)`);
    }
    const dupes = declared.filter((p, i) => declared.indexOf(p) !== i);
    if (dupes.length) errors.push(`${at}: duplicate params: ${[...new Set(dupes)].join(', ')}`);

    const used = new Set();
    for (const field of ['title', 'message', 'cause', 'action']) {
      const text = def[field];
      if (typeof text !== 'string') continue;
      for (const hit of text.matchAll(/\{(\w+)\}/g)) used.add(hit[1]);
    }

    for (const u of used) {
      if (!declared.includes(u)) errors.push(`${at}: placeholder {${u}} is used but not declared in params`);
    }
    for (const d of declared) {
      // Warn, not fail: a param may legitimately be declared for a locale that uses it.
      if (!used.has(d)) warnings.push(`${at}: param '${d}' is declared but never used`);
    }
  }

  return { errors, warnings, codes };
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (SCAN_EXTS.has(path.extname(e.name).toLowerCase())) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

/** Every registered code that appears somewhere other than the registry itself. */
function findReferences(files, skipFiles) {
  const referenced = new Map(); // code -> [relative paths]
  for (const full of files) {
    if (skipFiles.has(full)) continue;
    // ⚠️ Locale bundles are excluded for the same reason the registry is: they MENTION every code
    // they translate, so counting them would report codes as "referenced" that no caller emits yet —
    // the report exists to show migration progress, and a translation is not a caller. An
    // unregistered code inside a bundle is caught by validateLocaleBundle() instead, which reports
    // it with the locale that got it wrong.
    if (full.startsWith(LOCALES_DIR)) continue;
    let body;
    try {
      body = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }    const hits = body.match(CODE_IN_TEXT);
    if (!hits) continue;
    const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
    for (const code of new Set(hits)) {
      if (!referenced.has(code)) referenced.set(code, []);
      referenced.get(code).push(rel);
    }
  }
  return referenced;
}

/**
 * The backend's mirror of a SUBSET of this registry (#826 Phase 1).
 *
 * ⚠️ It is parsed with a regex, not a TypeScript parser: this gate runs in `prebuild` where no TS
 * toolchain is guaranteed, and the file's own header declares that one entry lives on one line in a
 * fixed shape for exactly this reason. If that shape is broken the parse yields ZERO entries, which
 * is reported as an error below — so a reformat can never silently switch this check off.
 */
const SERVER_CATALOGUE = path.join(
  REPO_ROOT,
  'nest',
  'src',
  'common',
  'notices',
  'notice-catalogue.ts',
);
const CATALOGUE_ENTRY = /'(TCS-[A-Z]{2,6}-\d{3})':\s*\{\s*httpStatus:\s*(\d+),\s*severity:\s*'([a-z]+)'/g;

function parseServerCatalogue(source) {
  const entries = new Map();
  for (const m of source.matchAll(CATALOGUE_ENTRY)) {
    entries.set(m[1], { httpStatus: Number(m[2]), severity: m[3] });
  }
  return entries;
}

/**
 * Cross-language parity. The two roots share no build, so the CODE LIST is the interface: if the
 * backend can emit a code the registry does not define, the user gets an unexplainable message —
 * which is exactly the defect #826 exists to remove.
 */
function validateServerCatalogue(source, notices, severities) {
  const errors = [];
  const entries = parseServerCatalogue(source);

  if (entries.size === 0) {
    return {
      errors: [
        '  server catalogue: no entries parsed from nest/src/common/notices/notice-catalogue.ts — ' +
          'the file has been reformatted out of the one-entry-per-line shape this gate reads, which ' +
          'would silently disable the cross-language check',
      ],
      entries,
    };
  }

  for (const [code, entry] of entries) {
    const def = notices[code];
    if (!def) {
      errors.push(`  ${code}: declared in the server catalogue but NOT registered in the registry`);
      continue;
    }
    if (!severities.includes(entry.severity)) {
      errors.push(`  ${code}: server severity '${entry.severity}' is not a valid severity`);
    } else if (entry.severity !== def.severity) {
      errors.push(
        `  ${code}: severity disagrees — registry '${def.severity}', server '${entry.severity}'`,
      );
    }
  }

  return { errors, entries };
}

/**
 * validateLocaleBundle() — structural checks on a translation.
 *
 * A translation is a second copy of the wording, which in this repo is the classic failure: the
 * second copy rots. Three things can silently break it, and all three are checked here:
 *
 *   1. a code that is not registered in English (the translator worked from an older list);
 *   2. a placeholder the translation uses that the code does not declare — the message would render
 *      `{symbol}` literally to a user, in a language they may not read well enough to report it;
 *   3. a translated CODE — impossible to write by accident, but the codes are the one thing that
 *      must never differ between languages, so it is asserted rather than assumed.
 *
 * Missing fields are NOT an error: a partial translation falls back per field to English (see
 * wordingFor() in the registry), which is what makes a locale shipable incrementally.
 */
function validateLocaleBundle(locale, bundle, notices) {
  const errors = [];
  let fallbacks = 0;

  if (!bundle || typeof bundle !== 'object') {
    return { errors: [`  locale '${locale}': bundle is not an object`], count: 0, fallbacks: 0 };
  }

  const entries = Object.entries(bundle);
  if (entries.length === 0) errors.push(`  locale '${locale}': bundle declares no codes`);

  for (const [code, fields] of entries) {
    const def = notices[code];
    if (!def) {
      errors.push(`  locale '${locale}': ${code} is not registered`);
      continue;
    }
    if (fields && typeof fields.code === 'string' && fields.code !== code) {
      errors.push(`  locale '${locale}': ${code} declares code '${fields.code}' — codes never translate`);
    }

    const declared = Array.isArray(def.params) ? def.params : [];
    const used = new Set();
    for (const field of ['title', 'message', 'cause', 'action']) {
      const text = fields?.[field];
      if (typeof text !== 'string') {
        // ⚠️ COUNTED, NOT WARNED. A partial locale is the DESIGN (fields fall back to English one at
        // a time so a locale is shipable incrementally). 22 individual warnings for a 12-code bundle
        // is how a warnings section becomes something people scroll past.
        if (typeof def[field] === 'string') fallbacks++;
        continue;
      }
      for (const hit of text.matchAll(/\{(\w+)\}/g)) used.add(hit[1]);
    }
    for (const u of used) {
      if (!declared.includes(u)) {
        errors.push(`  locale '${locale}': ${code} uses {${u}}, which ${code} does not declare`);
      }
    }
  }

  return { errors, count: entries.length, fallbacks };
}

/**
 * buildCatalogueDoc() — the human catalogue, generated.
 *
 * WHY IT IS GENERATED RATHER THAN WRITTEN
 * ---------------------------------------
 * A hand-written catalogue is a second copy of the registry, and the second copy is always the one
 * that rots (#826's whole premise: ~130 call sites each holding their own copy of a message). Here
 * the registry is the source and this is a rendering of it — so `--check` can prove the published
 * document matches the code, and a build fails if someone edits the doc instead of the registry.
 *
 * ⚠️ The output must be DETERMINISTIC (sorted, and carrying no timestamp) or the drift check would
 * fail on every run. That is also why the header has no `Last updated` date: a generated file's
 * history is its git log, and a date would make the content irreproducible.
 */
function buildCatalogueDoc(list, areas, severities) {
  const sorted = [...list].sort((a, b) => a.code.localeCompare(b.code));
  // Counted by walking the declared severity order, not by object keys: the output has to be
  // deterministic, or the drift check below would fire on ordering alone.
  const tally = {};
  for (const n of sorted) tally[n.severity] = (tally[n.severity] || 0) + 1;
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');

  const out = [];
  out.push('# Notice codes — the catalogue');
  out.push('');
  out.push('**Status:** active');
  out.push('**Category:** C (reference)');
  out.push('**Created:** 2026-09-15');
  out.push('**Last updated:** generated — see `git log docs/NOTICE-CODES.md`');
  out.push('**Owner:** generated — do NOT edit by hand');
  out.push('');
  out.push(
    '> Generated from `src/core/notices/registry.js` by ' +
      '`node scripts/validate-notices.cjs --md --out=docs/NOTICE-CODES.md`.',
  );
  out.push(
    '> Editing this file changes nothing: the backend `prebuild` fails if it does not match the registry.',
  );
  out.push('');
  out.push('## Why codes exist');
  out.push('');
  out.push(
    'The **code** identifies a condition and never changes. The **wording** explains it and may be ' +
      'reworded or translated at any time. Before this, the identity of a message *was* its wording — ' +
      'so a log line, a UI card, a test and a GitHub issue could not be correlated, and fixing a typo ' +
      'orphaned every reference to it. Same principle as Windows `HRESULT`, PostgreSQL `SQLSTATE` and ' +
      'the MetaTrader retcodes this app already consumes.',
  );
  out.push('');
  out.push('**Reporting a problem:** quote the code shown in the message. It is greppable here, in the API log and in the issue tracker.');
  out.push('');
  out.push('**Adding a code:** add the entry to the registry, emit it at the call site, then run the gate. Retire codes; never renumber one — renumbering is the same defect as rewording.');
  out.push('');
  out.push('## Index');
  out.push('');
  out.push(`| Code | Severity | Area | Title |`);
  out.push('|---|---|---|---|');
  for (const n of sorted) out.push(`| \`${n.code}\` | ${n.severity} | ${n.area} | ${esc(n.title)} |`);
  out.push('');
  out.push(
    `**${sorted.length} codes** — ` +
      severities
        .filter((s) => tally[s])
        .map((s) => `${tally[s]} ${s}`)
        .join(', ') +
      '.',
  );
  out.push('');
  out.push('## Codes by area');
  out.push('');

  for (const [area, label] of Object.entries(areas)) {
    const group = sorted.filter((n) => n.area === area);
    if (!group.length) continue;
    out.push(`### ${area} — ${label}`);
    out.push('');
    for (const n of group) {
      out.push(`#### \`${n.code}\` — ${n.title}`);
      out.push('');
      out.push(`- **Severity:** ${n.severity}`);
      out.push(`- **Message:** ${n.message}`);
      if (n.cause) out.push(`- **Cause:** ${n.cause}`);
      if (n.action) out.push(`- **Action:** ${n.action}`);
      const params = n.params || [];
      out.push(
        `- **Params:** ${params.length ? params.map((p) => `\`${p}\``).join(', ') : '*none*'}`,
      );
      // The call form IS the example: derived from `params`, so it cannot drift, and it shows a
      // caller exactly what to pass without inventing a reading this catalogue cannot verify.
      out.push(
        `- **Call:** \`notice('${n.code}'${params.length ? `, { ${params.join(', ')} }` : ''})\``,
      );
      if (n.external) {
        out.push(
          `- **External:** ${n.external.system} ${n.external.code ?? ''}${n.external.name ? ` (${n.external.name})` : ''}`,
        );
      }
      out.push(`- **Related:** ${(n.refs || []).length ? (n.refs || []).join(', ') : '*none*'}`);
      out.push('');
    }
  }

  return out.join('\n').replace(/\n+$/, '\n');
}

/**
 * Prove the published catalogue matches the registry.
 *
 * A published document that is silently out of date is worse than none — it looks like provenance.
 * Regeneration is one command, so staleness is always a mistake rather than a constraint.
 */
function checkCatalogueDoc(expected) {
  if (!fs.existsSync(CATALOGUE_DOC)) {
    return [`  docs/NOTICE-CODES.md is missing — run: node scripts/validate-notices.cjs --md --out=docs/NOTICE-CODES.md`];
  }
  const actual = fs.readFileSync(CATALOGUE_DOC, 'utf8').replace(/\r\n/g, '\n');
  if (actual !== expected) {
    return [
      '  docs/NOTICE-CODES.md is out of date — regenerate it: ' +
        'node scripts/validate-notices.cjs --md --out=docs/NOTICE-CODES.md',
    ];
  }
  return [];
}

async function loadRegistry() {
  if (!fs.existsSync(REGISTRY)) {
    throw new Error(`registry not found: ${path.relative(REPO_ROOT, REGISTRY)}`);
  }
  return import(pathToFileURL(REGISTRY).href);
}

/**
 * Load a locale bundle for structural checking. Bundles are plain ESM default-exporting an object
 * of `code -> { title?, message?, cause?, action? }`, so plain Node can import them exactly as the
 * browser does — no build step, no parser, and the gate checks the real artefact.
 */
async function loadLocaleBundle(file) {
  const mod = await import(pathToFileURL(file).href);
  return mod.default ?? mod.messages ?? mod;
}

(async () => {
  let mod;
  try {
    mod = await loadRegistry();
  } catch (e) {
    console.error(`\n[notices] ✖ could not load the registry: ${e.message}\n`);
    process.exit(1);
  }

  const { NOTICES, SEVERITIES, AREAS, CODE_PATTERN, listNotices } = mod;

  // ── --self-test: prove the checker rejects bad input, on fixtures ──────
  if (process.argv.includes('--self-test')) {
    const good = {
      'TCS-TEST-001': {
        severity: 'info',
        area: 'TEST',
        title: 'ok {thing}',
        message: 'body',
        params: ['thing'],
      },
    };
    const bad = {
      'NOT-A-CODE': { severity: 'info', area: 'TEST', title: 't', message: 'm', params: [] },
      'TCS-TEST-002': { severity: 'nope', area: 'OTHER', title: 't', message: 'm', params: [] },
      'TCS-TEST-003': { severity: 'info', area: 'TEST', title: '', message: 'm', params: [] },
      'TCS-TEST-004': { severity: 'info', area: 'TEST', title: 't', message: 'uses {missing}', params: [] },
      'TCS-TEST-005': { severity: 'info', area: 'TEST', title: 't', message: 'm', params: ['a', 'a'] },
    };
    const sev = ['critical', 'error', 'warning', 'info', 'success'];
    const pat = /^TCS-([A-Z]{2,6})-(\d{3})$/;

    const g = validateNotices(good, sev, new RegExp(pat));
    const b = validateNotices(bad, sev, new RegExp(pat));

    let failed = 0;
    const expect = (label, cond) => {
      console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
      if (!cond) failed++;
    };
    console.log('validate-notices self-test');
    expect('clean fixture produces no errors', g.errors.length === 0);
    const joined = b.errors.join('\n');
    expect('rejects a malformed code', /does not match/.test(joined));
    expect('rejects an unknown severity', /severity 'nope'/.test(joined));
    expect('rejects a missing title', /'title' is required/.test(joined));
    expect('rejects an undeclared placeholder', /placeholder \{missing\}/.test(joined));
    expect('rejects duplicate params', /duplicate params/.test(joined));
    expect('flags area/segment mismatch', /does not match the code segment/.test(joined));

    // ── locale bundle checks ──────────────────────────────────────────
    const locGood = { 'TCS-TEST-001': { title: 'ok {thing}', message: 'body' } };
    const locBad = {
      'TCS-TEST-999': { title: 'unknown code' },
      'TCS-TEST-001': { message: 'uses {nope}' },
    };
    expect(
      'locale: a partial bundle is accepted (missing fields fall back to English)',
      validateLocaleBundle('xx', locGood, good).errors.length === 0,
    );
    const lj = validateLocaleBundle('xx', locBad, good).errors.join('\n');
    expect('locale: rejects a code the registry does not define', /not registered/.test(lj));
    expect('locale: rejects a placeholder the code does not declare', /does not declare/.test(lj));

    // ── the Phase 5 ratchet ─────────────────────────────────
    const ui = (actual, allowed) => validateUiAllowance(new Map(actual), allowed);
    expect('UI ratchet: an undeclared file fails', ui([['a.jsx', 1]], {}).errors.length === 1);
    expect('UI ratchet: growth fails', /regression/.test(ui([['a.jsx', 2]], { 'a.jsx': 1 }).errors.join()));
    expect(
      'UI ratchet: shrinkage fails until it is recorded',
      /record it/.test(ui([['a.jsx', 1]], { 'a.jsx': 2 }).errors.join()),
    );
    expect(
      'UI ratchet: a stale entry fails',
      /no longer renders/.test(ui([], { 'a.jsx': 1 }).errors.join()),
    );
    expect('UI ratchet: matching counts are silent', ui([['a.jsx', 2]], { 'a.jsx': 2 }).errors.length === 0);
    expect('UI ratchet: comments are not counted', stripComments('// error.message\n/* e.message */\n').trim() === '');
    console.log();
    if (failed) {
      console.log(`FAILED (${failed})`);
      process.exit(1);
    }
    console.log('OK - self-test passed');
    process.exit(0);
  }

  // ── --update-allowance: record the Phase 5 ratchet ────────────────────
  if (process.argv.includes('--update-allowance')) {
    const actual = scanUiSurfaces();
    const previous = readUiAllowance();
    const files = Object.fromEntries([...actual.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    const total = Object.values(files).reduce((a, b) => a + b, 0);
    const before = Object.values(previous).reduce((a, b) => a + b, 0);

    // ⚠️ Notes are PRESERVED across an update. They record why an entry will never be migrated
    // (`{severity, message}` data, an error boundary, API warning objects) so the next agent does not
    // re-litigate it — losing them here would be the same defect as a claim nobody re-checks.
    let notes = {};
    try {
      notes = JSON.parse(fs.readFileSync(UI_ALLOWANCE_FILE, 'utf8')).notes ?? {};
    } catch {
      notes = {};
    }
    for (const key of Object.keys(notes)) {
      if (!files[key]) delete notes[key];
    }

    fs.writeFileSync(
      UI_ALLOWANCE_FILE,
      JSON.stringify(
        {
          note:
            'Raw error renders left in the UI (#826 Phase 5). This number may only go DOWN: raising it ' +
            'is a regression and the gate fails on it. Lower it with: node scripts/validate-notices.cjs --update-allowance',
          total,
          files,
          notes,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );

    console.log(
      `[notices] UI allowance recorded: ${before} -> ${total} raw error render(s) across ${Object.keys(files).length} file(s)`,
    );
    process.exit(0);
  }

  // ── Catalogue output modes ────────────────────────────────────────────
  if (process.argv.includes('--list') || process.argv.includes('--md')) {
    const list = listNotices().sort((a, b) => a.code.localeCompare(b.code));
    const outArg = process.argv.find((a) => a.startsWith('--out='));
    if (process.argv.includes('--md')) {
      const doc = buildCatalogueDoc(list, AREAS, SEVERITIES);
      if (outArg) {
        // Written with fs, not shell redirection: PowerShell re-encodes stdout and turns every em
        // dash in the catalogue into mojibake (#815 is the issue that cost us a day for this).
        fs.writeFileSync(path.resolve(REPO_ROOT, outArg.slice('--out='.length)), doc, 'utf8');
        console.log(`wrote ${outArg.slice('--out='.length)} — ${list.length} code(s)`);
      } else {
        process.stdout.write(doc);
      }
    } else {
      for (const n of list) {
        console.log(`${n.code}  ${String(n.severity).padEnd(8)} ${n.title}`);
      }
      console.log(`\n${list.length} registered notice(s); areas: ${Object.keys(AREAS).join(', ')}`);
    }
    process.exit(0);
  }

  // ── The gate ──────────────────────────────────────────────────────────
  let result;
  try {
    result = validateNotices(NOTICES, SEVERITIES, new RegExp(CODE_PATTERN));

    const files = [];
    for (const r of SCAN_ROOTS) {
      const full = path.join(REPO_ROOT, r);
      if (fs.existsSync(full)) walk(full, files);
    }
    result.filesScanned = files.length;

    const referenced = findReferences(files, SKIP_FILES);
    result.unknownReferences = [...referenced.entries()].filter(([code]) => !NOTICES[code]);
    result.unused = result.codes.filter((code) => !referenced.has(code));

    // ── #826 Phase 1 — the server catalogue must agree with this registry ────
    const catalogueRel = path.relative(REPO_ROOT, SERVER_CATALOGUE).split(path.sep).join('/');
    let serverEntries = new Map();
    if (!fs.existsSync(SERVER_CATALOGUE)) {
      result.errors.push(
        `  server catalogue missing: ${catalogueRel} — the backend has no way to map a code to an HTTP status`,
      );
    } else {
      const server = validateServerCatalogue(
        fs.readFileSync(SERVER_CATALOGUE, 'utf8'),
        NOTICES,
        SEVERITIES,
      );
      serverEntries = server.entries;
      result.errors.push(...server.errors);
    }
    result.serverCatalogue = serverEntries.size;

    // The reverse direction: a code the BACKEND emits that it never declared. Without a declaration
    // it still serialises, but with no agreed status — so this is a failure, not a warning.
    const backendCodes = new Set();
    for (const [code, where] of referenced) {
      const inBackend = where.some(
        (p) => p.startsWith('nest/src/') && !p.endsWith('.spec.ts') && p !== catalogueRel,
      );
      if (inBackend) backendCodes.add(code);
    }
    for (const code of backendCodes) {
      if (!serverEntries.has(code)) {
        result.errors.push(
          `  ${code}: emitted by the backend but missing from the server catalogue — add its httpStatus + severity to ${catalogueRel}`,
        );
      }
    }

    // ── the PUBLISHED catalogue must match the registry ────────────────
    // A published document that is silently stale is worse than none: it looks like provenance.
    result.errors.push(...checkCatalogueDoc(buildCatalogueDoc(listNotices(), AREAS, SEVERITIES)));

    // ── locale bundles (#826 Phase 6) ────────────────────────────────
    result.locales = [];
    if (fs.existsSync(LOCALES_DIR)) {
      const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.js'));
      for (const f of files) {
        const locale = path.basename(f, '.js');
        const bundle = await loadLocaleBundle(path.join(LOCALES_DIR, f));
        const checked = validateLocaleBundle(locale, bundle, NOTICES);
        result.errors.push(...checked.errors);
        result.locales.push(`${locale}:${checked.count}${checked.fallbacks ? ` (+${checked.fallbacks} fields in English)` : ''}`);
      }
    }

    // ── #826 Phase 5 — raw error renders in the UI (the ratchet) ────────────
    const uiActual = scanUiSurfaces();
    const ui = validateUiAllowance(uiActual, readUiAllowance());
    result.errors.push(...ui.errors);
    result.uiRemaining = ui.remaining;
    result.uiFiles = uiActual.size;
  } catch (e) {
    // An exception here is a defect in THIS validator, not in the registry — say so, so it is not
    // mistaken for a real failure of the code under test.
    console.error(`\n[notices] ✖ the validator crashed: ${e.stack}\n  This is a bug in scripts/validate-notices.cjs, not in the registry.\n`);
    process.exit(1);
  }

  console.log(
    `[notices] ${result.codes.length} registered code(s), ${result.filesScanned} file(s) scanned, ` +
      `${result.serverCatalogue} declared as backend-emittable` +
      (result.locales?.length ? `, locales: ${result.locales.join(' ')}` : '') +
      (result.uiRemaining !== undefined
        ? `, UI: ${result.uiRemaining} raw error render(s) left in ${result.uiFiles} file(s)`
        : ''),
  );

  if (result.warnings.length) {
    console.log(`[notices] ℹ ${result.warnings.length} warning(s):`);
    for (const w of result.warnings) console.log(w);
  }
  if (result.unused.length) {
    console.log(`[notices] ℹ registered but not referenced yet (callers not migrated): ${result.unused.join(', ')}`);
  }

  if (result.errors.length === 0 && result.unknownReferences.length === 0) {
    console.log('\n[notices] ✅ OK — every code is well-formed and every referenced code is registered');
    console.log('[notices]    behaviour checks (rendering, locales): npm run test:notices\n');
    process.exit(0);
  }

  console.error(`\n[notices] ✖ ${result.errors.length + result.unknownReferences.length} problem(s):\n`);
  for (const e of result.errors) console.error(`  ✖ ${e.trim()}`);
  for (const [code, where] of result.unknownReferences) {
    console.error(`  ✖ ${code} is used but NOT registered — used in: ${[...new Set(where)].join(', ')}`);
  }
  console.error(
    '\n  Codes are the stable identity of a message; wording may change, codes must not.\n' +
      '  Register the code in src/core/notices/registry.js, or correct the caller.\n' +
      '  Catalogue:  node scripts/validate-notices.cjs --list\n',
  );
  process.exit(1);
})();
