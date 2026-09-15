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
 *
 * Usage:
 *   node scripts/validate-notices.cjs            # gate (exit 1 on a problem)
 *   node scripts/validate-notices.cjs --list     # print the catalogue
 *   node scripts/validate-notices.cjs --md       # markdown catalogue on stdout (for docs)
 *   node scripts/validate-notices.cjs --self-test
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const REPO_ROOT = path.resolve(__dirname, '..');
const REGISTRY = path.join(REPO_ROOT, 'src', 'core', 'notices', 'registry.js');

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
const SKIP_FILES = new Set([REGISTRY, path.join(REPO_ROOT, 'scripts', 'validate-notices.cjs')]);

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
    let body;
    try {
      body = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const hits = body.match(CODE_IN_TEXT);
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

async function loadRegistry() {
  if (!fs.existsSync(REGISTRY)) {
    throw new Error(`registry not found: ${path.relative(REPO_ROOT, REGISTRY)}`);
  }
  return import(pathToFileURL(REGISTRY).href);
}

function toMarkdown(list) {
  const rows = list.map(
    (n) =>
      `| \`${n.code}\` | ${n.severity} | ${n.area} | ${n.title} | ${n.message} | ${n.action || ''} | ${
        n.external ? `${n.external.system} ${n.external.code}` : ''
      } | ${(n.refs || []).join(' ')} |`,
  );
  return [
    '| Code | Severity | Area | Title | Message | Action | External | Refs |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
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
    console.log();
    if (failed) {
      console.log(`FAILED (${failed})`);
      process.exit(1);
    }
    console.log('OK - self-test passed');
    process.exit(0);
  }

  // ── Catalogue output modes ────────────────────────────────────────────
  if (process.argv.includes('--list') || process.argv.includes('--md')) {
    const list = listNotices().sort((a, b) => a.code.localeCompare(b.code));
    if (process.argv.includes('--md')) {
      console.log(toMarkdown(list));
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
  } catch (e) {
    // An exception here is a defect in THIS validator, not in the registry — say so, so it is not
    // mistaken for a real failure of the code under test.
    console.error(`\n[notices] ✖ the validator crashed: ${e.stack}\n  This is a bug in scripts/validate-notices.cjs, not in the registry.\n`);
    process.exit(1);
  }

  console.log(
    `[notices] ${result.codes.length} registered code(s), ${result.filesScanned} file(s) scanned, ` +
      `${result.serverCatalogue} declared as backend-emittable`,
  );

  if (result.warnings.length) {
    console.log(`[notices] ℹ ${result.warnings.length} warning(s):`);
    for (const w of result.warnings) console.log(w);
  }
  if (result.unused.length) {
    console.log(`[notices] ℹ registered but not referenced yet (callers not migrated): ${result.unused.join(', ')}`);
  }

  if (result.errors.length === 0 && result.unknownReferences.length === 0) {
    console.log('\n[notices] ✅ OK — every code is well-formed and every referenced code is registered\n');
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
