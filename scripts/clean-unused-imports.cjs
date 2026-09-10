#!/usr/bin/env node
/**
 * clean-unused-imports.cjs — remove UNREFERENCED imports and dead import names.
 * ===========================================================================
 * Why this exists
 * ---------------
 * `npm run lint` reported 421 problems, most of them `no-unused-vars` from import
 * statements nobody uses (`src/App.jsx` alone had 105). That noise hides real
 * errors: a `require()` in an ESM module (`nav-tree.js`) sat in the same list for
 * months and would have thrown `ReferenceError` on first call, and an unused
 * import was silently pulling an 8 kB stylesheet into the bundle for a page no
 * route could reach (#752).
 *
 * Doing this by hand across 84 files is slow and error-prone. This does it in
 * one pass, mechanically, with the conservative rules below.
 *
 * Usage
 * -----
 *   node scripts/clean-unused-imports.cjs src/App.jsx              # dry run
 *   node scripts/clean-unused-imports.cjs src/App.jsx --apply      # write
 *   node scripts/clean-unused-imports.cjs src --apply --quiet      # whole tree
 *
 * Safety rules (do not "simplify" these away)
 * ------------------------------------------
 *  1. A name counts as USED if it appears anywhere outside an import line —
 *     including inside strings and comments. Erroring toward keeping an import is
 *     deliberate: a false "unused" verdict deletes working code.
 *  2. Bare side-effect imports (`import './x.css'`) and any import whose source
 *     ends in `.css` are NEVER touched — those exist for their side effect, not
 *     for a binding. Removing one would change rendering, not just tidy it.
 *  3. Multi-line import blocks are skipped, not rewritten (the author's layout is
 *     left alone; those names are simply not pruned this pass).
 *  4. Namespace imports (`import * as x`) are skipped.
 *  5. Nothing outside import statements is modified.
 *
 * ALWAYS verify a run with:
 *   npm --prefix <root> run lint      # no NEW no-undef errors (= nothing broke)
 *   npm --prefix <root> run build
 *   load a few routes in the browser  # rendering, not just compilation
 */
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const quiet = args.includes('--quiet');
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('usage: node scripts/clean-unused-imports.cjs <file-or-dir> [--apply] [--quiet]');
  process.exit(2);
}

const IMPORT_LINE = /^\s*import\b/;
// import <default>, { named } from 'source'
const SINGLE = /^(\s*import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?)\{([^}]*)\}(\s*from\s*['"]([^'"]+)['"];?\s*)$/;
const DEFAULT_ONLY = /^\s*import\s+([A-Za-z_$][\w$]*)\s*from\s*['"]([^'"]+)['"];?\s*$/;

function collectFiles(p, out = []) {
  const stat = fs.statSync(p);
  if (stat.isFile()) { out.push(p); return out; }
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const child = path.join(p, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
      collectFiles(child, out);
    } else if (/\.(jsx?|mjs|cjs)$/.test(e.name)) out.push(child);
  }
  return out;
}

function cleanFile(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const body = lines.filter((l) => !IMPORT_LINE.test(l)).join('\n');
  const uses = (n) => (body.match(new RegExp(`(?<![\\w$])${n.replace(/\$/g, '\\$')}(?![\\w$])`, 'g')) || []).length;

  const removed = [];
  const pruned = [];
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!IMPORT_LINE.test(line)) { out.push(line); continue; }

    // Rule 3 + 5: multi-line blocks and anything that is not a plain statement.
    const named = line.match(SINGLE);
    const dfltOnly = line.match(DEFAULT_ONLY);

    if (named) {
      const [, head, dflt, inner, tail, source] = named;
      if (/\.css$/.test(source)) { out.push(line); continue; }        // Rule 2
      const specs = inner.split(',').map((s) => s.trim()).filter(Boolean);
      const keep = specs.filter((s) => uses(s.split(/\s+as\s+/).pop().trim()) > 0);
      const drop = specs.filter((s) => !keep.includes(s));
      if (!drop.length) { out.push(line); continue; }

      if (!keep.length && !dflt) { removed.push({ line: i + 1, text: line.trim() }); continue; }
      if (!keep.length) {
        out.push(`import ${dflt} from '${source}';`);
        pruned.push({ line: i + 1, drop: drop.join(', '), kept: dflt });
        continue;
      }
      out.push(`${head}{ ${keep.join(', ')} }${tail}`);
      pruned.push({ line: i + 1, drop: drop.join(', '), kept: keep.join(', ') });
      continue;
    }

    if (dfltOnly) {
      const [, name, source] = dfltOnly;
      if (/\.css$/.test(source)) { out.push(line); continue; }         // Rule 2
      if (uses(name) === 0) { removed.push({ line: i + 1, text: line.trim() }); continue; }
    }

    out.push(line);                                                    // bare / namespace / unparsed
  }

  if (!removed.length && !pruned.length) return null;
  if (apply) fs.writeFileSync(file, out.join('\n'), 'utf8');
  return { file, removed, pruned };
}

const files = collectFiles(target);
let touched = 0;
let statements = 0;
let names = 0;

for (const file of files) {
  const result = cleanFile(file);
  if (!result) continue;
  touched += 1;
  statements += result.removed.length;
  names += result.pruned.length;
  if (!quiet) {
    console.log(`\n${path.relative(process.cwd(), result.file)}`);
    result.removed.forEach((r) => console.log(`  remove  L${r.line}  ${r.text}`));
    result.pruned.forEach((p) => console.log(`  prune   L${p.line}  drop ${p.drop}  keep ${p.kept}`));
  }
}

console.log(`\nfiles scanned : ${files.length}`);
console.log(`files changed : ${touched}`);
console.log(`statements    : ${statements} removed entirely`);
console.log(`names pruned  : ${names} removed from shared statements`);
console.log(apply ? '\nAPPLIED' : '\nDRY RUN — pass --apply to write');
