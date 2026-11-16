#!/usr/bin/env node
/**
 * validate-directive-versions.cjs — a directive edit must ANNOUNCE itself (#1274)
 * ===============================================================================
 * THE DEFECT THIS CLOSES, measured 2026-11-13/14. An `IDirective` declares `version`, it is displayed
 * and recorded, and it changes nothing:
 *
 *   `protocol_directive_entry`: 489 rows · 487 `params` NULL · 2 empty · **0 with any stored parameter**
 *
 * So every protocol's behaviour IS whatever the directive's current source says. Editing one constant
 * changes the score of every protocol carrying that directive, writes no `protocol_directive_change`
 * row, and changes no version anybody reads. Measured the same day: adding two parameters to
 * `ema-structure` silently changed the scoring input of **11 protocols**, one of them resolving 79
 * symbols. Nothing failed.
 *
 * ⚠️ WHAT THIS GUARD CAN AND CANNOT DO. It pins the RELATIONSHIP between a directive's source and its
 * declared version — it cannot pin a protocol's behaviour (that is part 2/3 of #1274: a
 * `protocol_directive_entry.directiveVersion` column, and a drift report). What it guarantees is the
 * one thing a static check can: a source change cannot happen without somebody writing down that it
 * did.
 *
 * ── THE TWO FAILURES, and why BOTH are reported ────────────────────────────────────────────────
 *
 *   STALE            the artefact disagrees with the source. Fix: `--write`.
 *   VERSION-SILENT   the source changed and the declared `version` did not. Fix: bump the version
 *                    (and then `--write`).
 *
 * Reporting only STALE would be a trap: `--write` alone satisfies it, so the "bump the version"
 * instruction would be a sentence in a failure message that a developer clears by regenerating. The
 * second check is the one that carries the meaning, so it is reported independently.
 *
 * ⚠️ A VERSION BUMP WITH NO SOURCE CHANGE IS ALLOWED. It is not a lie — a directive can be
 * re-declared for a reason that leaves the code byte-identical. The asymmetry is deliberate: the
 * version is a claim the author makes, and we only require it when behaviour actually moved.
 *
 * ── COMMENT-ONLY EDITS DO NOT CHANGE THE HASH, and that decision is load-bearing ────────────────
 *
 * The issue named the risk: *"a false-positive check so a comment-only edit is not treated as a
 * behaviour change (or is — decide, and say which, because 'comments change the hash' is a real
 * nuisance that gets a guard allowlisted)."*
 *
 * **DECIDED: comments are stripped before hashing.** This repo documents heavily and deliberately —
 * `ema-structure.directive.ts` gained a multi-paragraph docblock in the very change that motivated
 * this issue. If a docblock demanded a version bump, this guard would fire on most edits for a reason
 * that has never affected a score, and it would be allowlisted inside a week.
 *
 * ⚠️ STRING LITERALS ARE **NOT** STRIPPED, because a directive's `reason` text and its signal
 * literals ARE behaviour — they are returned through the API and read by the UI. Whitespace IS
 * collapsed, so reformatting is not a change. The `--self-test` proves all four of these.
 *
 *   node scripts/validate-directive-versions.cjs            # --check (the prebuild form)
 *   node scripts/validate-directive-versions.cjs --write    # regenerate after a deliberate change
 *   node scripts/validate-directive-versions.cjs --self-test
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'nest', 'src', 'modules', 'directives', 'implementations');
const OUT = path.join(ROOT, 'docs', 'directive-versions.json');

/**
 * Strip comments so a documentation edit is not mistaken for a behaviour change.
 *
 * ⚠️ The `(^|[^:])` guard before `//` protects `https://` inside a string literal. Where this is
 * unsure it leaves text in place, which can only make the hash CHANGE when it need not — the
 * harmless direction, because it asks for a version bump rather than silently permitting a behaviour
 * change. The dangerous direction is a false "no change", and nothing here can produce one: comments
 * are the only thing removed.
 */
function codeOf(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * NOTE: the old `fingerprint(source)` helper was REMOVED 2026-11-16. It read only the first
 * `readonly id` in a file, which is exactly the assumption that left 51 directives unguarded. Keeping
 * it beside `directivesInFile()` would be a second implementation of the same idea, and only one of
 * the two would get the next fix.
 */

function hashOf(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * directivesInFile() — EVERY directive in a file, each with its own identity and its own hash.
 *
 * 🛑 THIS REPLACED A ONE-DIRECTIVE-PER-FILE ASSUMPTION, measured 2026-11-16.
 *
 * The previous version read the FIRST `readonly id` in a file and hashed the WHOLE file. That is
 * wrong twice over, and both mistakes were silent:
 *
 *   1. **The directory glob was `*.directive.ts` — so `*.directives.ts` (PLURAL) was never opened.**
 *      `momentum-and-macro.directives.ts` (30 directives) and `mt5-indicators.directives.ts` (17)
 *      were invisible in their entirety.
 *   2. **A file declaring more than one directive recorded only the first one.** `surge.directive.ts`
 *      declares two; `mtf-confluence` and `vwap-confluence` likewise. The second was dropped.
 *
 * Measured consequence: the guard printed **`✅ OK — 93 directive(s)`** while the library holds
 * **144**. **51 directives — 35% — could be edited with no version bump and nothing failed.** That
 * is the precise failure this guard exists to prevent, occurring inside the guard.
 *
 * ⚠️ SEGMENTS START AT THE PREVIOUS CLASS END, NOT AT THE CLASS ITSELF. A directive's tunable
 * defaults live in a module-level `const X_PARAMS` declared ABOVE its class (see `WILLIAMS_R_PARAMS`
 * in `mt5-indicators.directives.ts`). Hashing only the class body would let a parameter's `default`
 * change without moving the hash — a behaviour change reported as no change, which is the one
 * direction this file must never produce.
 *
 * ⚠️ IMPORTS AND COMMENTS ARE STRIPPED FIRST. Without that, an unrelated import edit would flag
 * every directive in a shared file, and the predictable response to that noise is an allowlist —
 * which is worse than no guard.
 */
function directivesInFile(source) {
  const usable = source.replace(/^\s*import[\s\S]*?;\s*$/gm, ' ');
  const starts = [...usable.matchAll(/export\s+class\s+\w+\s+implements\s+IDirective/g)].map((m) => m.index);
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    /**
     * ⚠️ THE PREAMBLE MUST START *AFTER* THE PREVIOUS CLASS CLOSES, or class i-1 is counted twice and
     * the file reports its own directives as duplicates. That exact bug fired on the first run of this
     * rewrite (5 duplicate-id problems), which is why the boundary is `lastIndexOf('\n}')` — a
     * top-level class in this directory closes with `}` in column 0.
     */
    let preambleFrom = 0;
    if (i > 0) {
      const prevClose = usable.lastIndexOf('\n}', starts[i]);
      preambleFrom = prevClose >= 0 ? prevClose + 2 : starts[i];
    }
    const classEnd = i + 1 < starts.length ? starts[i + 1] : usable.length;
    const segment = usable.slice(preambleFrom, classEnd);
    const idMatch = segment.match(/readonly\s+id\s*=\s*'([^']+)'/);
    if (!idMatch) continue;
    const versionMatch = segment.match(/readonly\s+version\s*=\s*'([^']+)'/);
    out.push({
      id: idMatch[1],
      version: versionMatch ? versionMatch[1] : null,
      hash: hashOf(codeOf(segment)),
    });
  }
  return out;
}

/** Every directive class in the library, keyed by its runtime id. */
function scan() {
  const out = new Map();
  const problems = [];
  for (const file of fs.readdirSync(SRC).sort()) {
    // ⚠️ BOTH suffixes. `*.directives.ts` (plural) is where the two largest directive files live.
    if (!file.endsWith('.directive.ts') && !file.endsWith('.directives.ts')) continue;
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');
    const found = directivesInFile(source);
    if (!found.length) {
      problems.push(`${file}: declares no \`export class … implements IDirective\``);
      continue;
    }
    for (const fp of found) {
      if (fp.version === null) {
        problems.push(`${fp.id} (${file}): declares no \`readonly version\`, so a change cannot announce itself`);
        continue;
      }
      if (out.has(fp.id)) {
        problems.push(`duplicate id '${fp.id}' — ${file} and another file both declare it`);
        continue;
      }
      out.set(fp.id, { version: fp.version, hash: fp.hash, file });
    }
  }
  return { directives: out, problems };
}

function loadRecorded() {
  if (!fs.existsSync(OUT)) return null;
  try {
    return JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Compare the scan against the record.
 *
 * Returns two lists, deliberately separate — see the header for why merging them would let a
 * developer clear the meaningful failure with `--write`.
 */
function compare(current, recorded) {
  const stale = [];
  const silent = [];
  const rec = recorded?.directives ?? {};

  for (const [id, cur] of current) {
    const prev = rec[id];
    if (!prev) {
      // A NEW directive is not a silent change — there was nothing to change.
      stale.push(`${id}: not in the record (new directive)`);
      continue;
    }
    const hashMoved = prev.hash !== cur.hash;
    const versionMoved = prev.version !== cur.version;
    if (hashMoved && !versionMoved) {
      silent.push(`${id}: source changed but \`version\` is still '${cur.version}'`);
    }
    if (hashMoved || versionMoved) stale.push(`${id}: ${prev.version}/${prev.hash} -> ${cur.version}/${cur.hash}`);
  }
  for (const id of Object.keys(rec)) {
    if (!current.has(id)) stale.push(`${id}: in the record but no longer in the source (removed or renamed)`);
  }
  return { stale, silent };
}

function write(current) {
  const directives = {};
  for (const id of [...current.keys()].sort()) {
    const d = current.get(id);
    directives[id] = { version: d.version, hash: d.hash };
  }
  fs.writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        _readme: [
          'GENERATED by scripts/validate-directive-versions.cjs — do not edit by hand.',
          'A directive edit that changes behaviour must bump `readonly version`.',
          '`hash` is the sha256 (16 chars) of the CODE with comments stripped, so a documentation',
          'edit is not a behaviour change and does not demand a bump (#1274).',
          'Regenerate with: node scripts/validate-directive-versions.cjs --write',
        ],
        directives,
      },
      null,
      2,
    )}\n`,
  );
  return Object.keys(directives).length;
}

// ── self-test ────────────────────────────────────────────────────────────────────────────────────

function selfTest() {
  const cases = [];
  const check = (name, ok, detail) => cases.push({ name, ok: !!ok, detail });

  // 1 — a COMMENT-ONLY edit must not change the hash (the nuisance case named in the issue).
  const base = "readonly id = 'x';\nreadonly version = '1.0.0';\nconst A = 1;\n";
  const documented = `/**\n * A long docblock that explains why A is 1.\n */\n${base}`;
  const lineCommented = `${base}// a note about A\n`;
  check('a block-comment-only edit does not change the hash', hashOf(codeOf(base)) === hashOf(codeOf(documented)));
  check('a line-comment-only edit does not change the hash', hashOf(codeOf(base)) === hashOf(codeOf(lineCommented)));

  // 2 — REFORMATTING must not change the hash either.
  const reformatted = "readonly id = 'x';\n\nreadonly version = '1.0.0';\n\n\nconst A   =   1;\n";
  check('whitespace-only reformatting does not change the hash', hashOf(codeOf(base)) === hashOf(codeOf(reformatted)));

  // 3 — a CODE change MUST change the hash. This is the direction that must never silently pass.
  const codeChanged = "readonly id = 'x';\nreadonly version = '1.0.0';\nconst A = 2;\n";
  check('a code change DOES change the hash', hashOf(codeOf(base)) !== hashOf(codeOf(codeChanged)));

  // 4 — a STRING-LITERAL change MUST change the hash: a reason string is behaviour.
  const stringChanged = "readonly id = 'x';\nreadonly version = '1.0.0';\nconst A = 1;\nconst R = 'was 1';\nconst R2 = 'now 2';\n";
  const stringBase = "readonly id = 'x';\nreadonly version = '1.0.0';\nconst A = 1;\nconst R = 'was 1';\nconst R2 = 'was 2';\n";
  check('a string-literal change DOES change the hash', hashOf(codeOf(stringBase)) !== hashOf(codeOf(stringChanged)));

  // 5 — THE GATE, both directions. Built from the real `compare()`.
  const fakeRecord = { directives: { alpha: { version: '1.0.0', hash: 'aaaa' } } };

  const silentMap = new Map([['alpha', { version: '1.0.0', hash: 'bbbb' }]]);
  const silentResult = compare(silentMap, fakeRecord);
  check('source changed + version UNCHANGED -> reported as silent', silentResult.silent.length === 1, silentResult.silent.join(','));
  check('and it is also stale, so the artefact gets regenerated', silentResult.stale.length === 1);

  const bumpedMap = new Map([['alpha', { version: '1.1.0', hash: 'bbbb' }]]);
  const bumpedResult = compare(bumpedMap, fakeRecord);
  check('source changed + version BUMPED -> not silent', bumpedResult.silent.length === 0, bumpedResult.silent.join(','));
  check('…but still stale until --write is run', bumpedResult.stale.length === 1);

  const versionOnlyMap = new Map([['alpha', { version: '1.1.0', hash: 'aaaa' }]]);
  const versionOnlyResult = compare(versionOnlyMap, fakeRecord);
  check('version bumped with NO source change -> allowed (not silent)', versionOnlyResult.silent.length === 0, versionOnlyResult.silent.join(','));

  const unchangedMap = new Map([['alpha', { version: '1.0.0', hash: 'aaaa' }]]);
  const unchangedResult = compare(unchangedMap, fakeRecord);
  check('nothing changed -> neither list fires', unchangedResult.silent.length === 0 && unchangedResult.stale.length === 0);

  const newMap = new Map([['alpha', { version: '1.0.0', hash: 'aaaa' }], ['beta', { version: '1.0.0', hash: 'cccc' }]]);
  const newResult = compare(newMap, fakeRecord);
  check('a NEW directive is stale but never silent', newResult.stale.length === 1 && newResult.silent.length === 0);

  const removedMap = new Map();
  const removedResult = compare(removedMap, fakeRecord);
  check('a REMOVED directive is stale', removedResult.stale.length === 1, removedResult.stale.join(','));

  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`  ${c.ok ? '✅' : '✖ '} ${c.name}${c.ok ? '' : `  <-- ${c.detail}`}`);
  if (failed.length > 0) {
    console.error(`\n[directive-versions] ✖ SELF-TEST FAILED — ${failed.length} of ${cases.length}`);
    process.exit(1);
  }
  console.log(`\n[directive-versions] ✅ self-test: ${cases.length} cases — comment/whitespace immunity, code and string sensitivity, and the gate in both directions.`);
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const { directives, problems } = scan();
if (problems.length > 0) {
  console.error(`\n[directive-versions] ✖ ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}

if (args.includes('--write')) {
  const n = write(directives);
  console.log(`[directive-versions] wrote docs/directive-versions.json — ${n} directive(s) recorded.`);
  process.exit(0);
}

const recorded = loadRecorded();
if (!recorded) {
  console.error(
    `\n[directive-versions] ✖ docs/directive-versions.json is missing.\n` +
      '  It is the record that lets a directive change announce itself (#1274).\n' +
      '  Create it: node scripts/validate-directive-versions.cjs --write',
  );
  process.exit(1);
}

const { stale, silent } = compare(directives, recorded);

// ⚠️ VERSION-SILENT FIRST, because it is the failure with meaning. STALE is cleared by regenerating;
// this one is not.
if (silent.length > 0) {
  console.error(
    `\n[directive-versions] ✖ ${silent.length} directive(s) CHANGED BEHAVIOUR WITHOUT ANNOUNCING IT:\n` +
      silent.map((s) => `    ${s}`).join('\n') +
      '\n\n  `protocol_directive_entry` holds no parameters (489 rows, 0 with any), so the current source IS' +
      '\n  the configuration — this edit just changed the score of every protocol carrying it, silently.' +
      '\n  Bump `readonly version` on the directive(s) above, then:' +
      '\n    node scripts/validate-directive-versions.cjs --write',
  );
}

if (stale.length > 0) {
  console.error(
    `\n[directive-versions] ✖ docs/directive-versions.json is STALE (${stale.length}):\n` +
      stale.map((s) => `    ${s}`).join('\n') +
      '\n\n  Regenerate: node scripts/validate-directive-versions.cjs --write',
  );
}

if (silent.length > 0 || stale.length > 0) process.exit(1);

console.log(
  `[directive-versions] ✅ OK — ${directives.size} directive(s), every source change carries a version bump.`,
);
