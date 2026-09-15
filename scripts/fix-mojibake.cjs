#!/usr/bin/env node
/**
 * fix-mojibake.cjs — REVERSE-DECODE repair tool for CP1252/CP850 mojibake
 * =====================================================================
 * Companion to `scripts/validate-text-encoding.cjs` (the guard). The guard says *something is
 * wrong*; this tool says *what it originally was* and repairs it.
 *
 * WHY A REVERSE DECODE, NOT A LOOKUP TABLE
 * ----------------------------------------
 * The obvious fix is a find/replace table (`U+00D4 U+00C7 U+00F6` -> em dash, `U+00C3 U+2014`
 * -> multiply, ...). That is wrong here, and
 * measurably so: `DiagramsPage.jsx` carries ~20 distinct corrupted sequences and at least as
 * many *correct* characters that share their glyphs (a correct em dash sitting next to its
 * corrupted form; a correct middot next to `U+00C2 U+00B7`).
 * A table that is one entry short silently leaves corruption behind, and a table that is one
 * entry too greedy silently destroys correct text. Both failure modes are invisible.
 *
 * THE MECHANIC (this is the whole idea)
 * -------------------------------------
 * The corruption is a *lossless* transformation in one direction:
 *
 *   correct text --[encode UTF-8]--> bytes --[decode CP1252]--> mojibake
 *
 * So it can be run backwards, and the backwards run is SELF-VALIDATING:
 *
 *   mojibake --[encode CP1252]--> bytes --[decode UTF-8]--> original
 *
 * If the CP1252 bytes are not a valid UTF-8 sequence, the candidate was NOT mojibake and is
 * left alone. That is what makes correct typography safe: `—` (U+2014) encodes to the single
 * byte 0x97, which is a UTF-8 *continuation* byte with no lead, so the decode FAILS and the
 * character survives untouched. Same for `·` (0xB7), `×` (0xD7) and `é` (0xE9) in isolation.
 *
 * Two extra rules make it precise:
 *   1. **Strictly shorter.** A repair must consume more characters than it produces
 *      (`U+00C2 U+00B7` is 2->1, a corrupted en dash is 3->1, a corrupted emoji is 4->1).
 *      A 1:1 "repair" is undefined behaviour and is refused.
 *   2. **Longest match first.** Adjacent corruption is decoded greedily, so a corrupted en
 *      dash immediately followed by a correct em dash repairs only the first and leaves the
 *      second intact.
 *
 * Usage (from repo root):
 *   node scripts/fix-mojibake.cjs <file>            # DRY RUN — prints what it would change
 *   node scripts/fix-mojibake.cjs <file> --apply    # write the repair
 *   node scripts/fix-mojibake.cjs <file> --quiet    # only the summary
 *   node scripts/fix-mojibake.cjs --self-test       # prove legitimate text is untouched
 *
 * ⚠️ Always dry-run first and read the table. This tool rewrites source files.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const QUIET = args.includes('--quiet');
const target = args.find((a) => !a.startsWith('--'));

const SELFTEST = args.includes('--self-test');

if (!target && !SELFTEST) {
  console.error('usage: node scripts/fix-mojibake.cjs <file> [--apply] [--quiet] | --self-test');
  process.exit(2);
}

const full = SELFTEST ? null : path.resolve(process.cwd(), target);
if (full && !fs.existsSync(full)) {
  console.error(`not found: ${full}`);
  process.exit(2);
}

/**
 * CP1252 decode table, index = byte.
 *
 * Bytes 0x81, 0x8D, 0x8F, 0x90 and 0x9D are UNASSIGNED in CP1252. Lenient decoders (and
 * Windows' own MultiByteToWideChar in its default mode) pass them through as the matching
 * C1 control code point rather than failing, so they are mapped to themselves here. That
 * matters: the ⚠️ glyph in the diagrams encodes as E2 9A A0 **EF B8 8F**, so 0x8F really does
 * occur in the corrupted file and must survive the round-trip.
 */
const CP1252_TO_UNICODE = (() => {
  const specials = {
    0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020,
    0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
    0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
    0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
    0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
  };
  const table = new Array(256);
  for (let b = 0; b < 256; b++) table[b] = specials[b] ?? b;
  return table;
})();

/** Reverse of the above: Unicode code point -> single CP1252 byte (or undefined). */
const UNICODE_TO_CP1252 = (() => {
  const m = new Map();
  for (let b = 0; b < 256; b++) {
    const cp = CP1252_TO_UNICODE[b];
    if (!m.has(cp)) m.set(cp, b);
  }
  return m;
})();

/** Encode a string to CP1252 bytes, or return null if any character is not representable. */
function cp1252Encode(str) {
  const bytes = [];
  for (const ch of str) {
    if (ch.length > 1) return null; // surrogate pair — not a CP1252 artefact
    const b = UNICODE_TO_CP1252.get(ch.codePointAt(0));
    if (b === undefined) return null;
    bytes.push(b);
  }
  return Buffer.from(bytes);
}

/** Non-ASCII characters are the only candidates — ASCII is identical in both charsets. */
function isCandidate(ch) {
  return ch.codePointAt(0) > 0x7f;
}

const MAX_RUN = 12;

/**
 * Try to reverse-decode the substring starting at `start`.
 * Returns { len, decoded } for the LONGEST successful decode, or null.
 */
function tryDecode(str, start) {
  const remaining = str.length - start;
  const limit = Math.min(MAX_RUN, remaining);
  let upper = 0;
  while (upper < limit && isCandidate(str[start + upper])) upper++;
  for (let len = upper; len >= 2; len--) {
    const sub = str.substr(start, len);
    const bytes = cp1252Encode(sub);
    if (!bytes) continue;
    const decoded = bytes.toString('utf8');
    if (decoded.includes('\uFFFD')) continue; // not valid UTF-8 → not mojibake
    if (decoded.length >= sub.length) continue; // rule 1: a repair must shrink
    if (decoded === sub) continue;
    // Reject any C0 control that could not have been in the original source.
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(decoded)) continue;
    return { len, decoded };
  }
  return null;
}

/**
 * PASS 2 — the BOTCHED ARROW.  (not reverse-decodable; needs an explicit rule)
 * ---------------------------------------------------------------------------
 * 36 occurrences in DiagramsPage.jsx are `-` `>` U+2019 where the original was U+2192 (an
 * arrow). This is NOT the round-trippable corruption, so the algorithm above cannot see it:
 * a lone U+2019 encodes to the single byte 0x92, which is a UTF-8 continuation byte with no
 * lead, so the decode fails and the character looks like ordinary typography.
 *
 * EVIDENCE that U+2192 is the original — from git, not from a guess:
 *   `git show a8e50f8:src/pages/DiagramsPage.jsx` (the earliest committed version) is CLEAN
 *   UTF-8 and contains 26 x U+2192, 0 x U+2019-after-`>`. Intact text in the current file
 *   still reads `providers -> watchlists -> protocols` with U+2192 arrows, i.e. a bare arrow
 *   between spaces. The damaged text reads `providers ->` then U+2019 then `AdapterFactory`.
 *
 * So the lead bytes (U+00E2 U+2020) were removed at some point (by hand or by a partial
 * re-save), leaving the trailing U+2019 behind. Restoring U+2192 makes the damaged lines
 * match the intact convention exactly. The rule is anchored on the literal `-` `>` U+2019
 * trigger and is deliberately narrow: a U+2019 NOT preceded by `>` is left alone, because a
 * genuine possessive apostrophe is indistinguishable from a stripped arrow.
 */
const BOTCHED_ARROW = /->\u2019/g;

/**
 * repair() — reverse-decode every non-ASCII run, then apply the arrow rule.
 * Returns { out, changes, leftovers, arrows }.
 */
function repair(text) {
  const changes = [];
  const leftovers = [];
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (!isCandidate(text[i])) {
      out += text[i];
      i++;
      continue;
    }
    const hit = tryDecode(text, i);
    if (hit) {
      changes.push({ index: i, from: text.substr(i, hit.len), to: hit.decoded });
      out += hit.decoded;
      i += hit.len;
      continue;
    }
    // Gather this whole undecodable non-ASCII run so it can be eyeballed.
    let j = i;
    while (j < text.length && isCandidate(text[j])) j++;
    leftovers.push({ index: i, text: text.slice(i, j) });
    out += text.slice(i, j);
    i = j;
  }
  let arrows = 0;
  out = out.replace(BOTCHED_ARROW, () => {
    arrows++;
    return '\u2192';
  });
  return { out, changes, leftovers, arrows };
}

function cpList(str) {
  return Array.from(str)
    .map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ');
}

if (SELFTEST) {
  /*
   * Acceptance criterion on #815: "Legitimate typography proves untouched — assert with a
   * test". Every character below is CORRECT text that already exists in this codebase. The
   * assertion is that the reverse decode refuses all of them.
   *
   * Written as \uXXXX escapes on purpose: the tool's own source must stay free of literal
   * corrupted characters, or `scripts/validate-text-encoding.cjs` would flag it.
   */
  const LEGIT =
    '\u00B7\u00D7\u2013\u2014\u2018\u2019\u201C\u201D\u2192\u2194\u2193\u0394\u2605\u2606' +
    '\u26A0\uFE0F\u2705\u274C\u{1F534}\u{1F7E2}\u{1F3AF}\u2B50\u00A0\u00E9\u00B0\u00A9\u2022' +
    '\u2026\u2122\u20AC\u2265\u2500\u00AD\uFEFF';
  const rescues = [
    ['\u00C2\u00B7', '\u00B7', 'middot'],
    ['\u00C3\u2014', '\u00D7', 'multiply'],
    ['\u00E2\u20AC\u201C', '\u2013', 'en dash'],
    ['\u00E2\u02C6\u2019', '\u2212', 'minus'],
    ['\u00E2\u2030\u00A5', '\u2265', 'greater-or-equal'],
    ['\u00E2\u0153\u2026', '\u2705', 'white check'],
    ['\u00F0\u0178\u201D\u00B4', '\u{1F534}', 'red circle'],
    ['\u00E2\u0161\u00A0\u00EF\u00B8\u008F', '\u26A0\uFE0F', 'warning + VS16'],
    ['->\u2019', '\u2192', 'botched arrow'],
    // longest-match: corrupted then correct, adjacent, no ASCII between
    ['\u00E2\u20AC\u201C\u2014', '\u2013\u2014', 'corrupt + legit em dash'],
  ];

  let bad = 0;
  const untouched = repair(LEGIT);
  if (untouched.out !== LEGIT || untouched.changes.length !== 0 || untouched.arrows !== 0) {
    bad++;
    console.log('✖ legitimate typography was MODIFIED');
    for (const c of untouched.changes) console.log(`    ${cpList(c.from)} -> ${cpList(c.to)}`);
  }
  for (const [input, want, name] of rescues) {
    const got = repair(input).out;
    if (got !== want) {
      bad++;
      console.log(`✖ ${name}: got ${cpList(got)}, want ${cpList(want)}`);
    }
  }
  console.log(`  legitimate chars held unchanged : ${untouched.out === LEGIT ? 'yes' : 'NO'}`);
  console.log(`  corrupted sequences repaired    : ${rescues.length - bad}/${rescues.length}`);
  console.log(bad === 0 ? '\n✅ self-test PASS\n' : `\n✖ self-test FAIL (${bad})\n`);
  process.exit(bad === 0 ? 0 : 1);
}

const original = fs.readFileSync(full, 'utf8');

/** line/col lookup for reporting */
const lineStarts = [0];
for (let i = 0; i < original.length; i++) if (original[i] === '\n') lineStarts.push(i + 1);
function where(index) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: index - lineStarts[lo] + 1 };
}

const { out, changes, leftovers, arrows } = repair(original);

if (!QUIET) {
  console.log(`\n${path.relative(process.cwd(), full)}`);
  console.log(`  ${changes.length} reverse-decode repair(s), ${arrows} botched arrow(s), ` +
    `${leftovers.length} undecodable non-ASCII run(s)\n`);
  if (changes.length) {
    console.log('  REPAIRS');
    for (const c of changes) {
      const { line } = where(c.index);
      console.log(`   L${String(line).padStart(4)}  ${cpList(c.from)}`);
      console.log(`         -> ${cpList(c.to)}   "${c.to}"`);
    }
    console.log('');
  }
  if (leftovers.length) {
    console.log('  LEFT ALONE (could not be reverse-decoded — review these by hand)');
    for (const l of leftovers) {
      const { line } = where(l.index);
      console.log(`   L${String(line).padStart(4)}  "${l.text}"   ${cpList(l.text)}`);
    }
    console.log('');
  }
}

if (!APPLY) {
  console.log('dry run — nothing written. Re-run with --apply to repair.\n');
  process.exit(0);
}

fs.writeFileSync(full, out, 'utf8');
console.log(
  `✅ applied ${changes.length} reverse-decode repair(s) + ${arrows} arrow repair(s) to ` +
    `${path.relative(process.cwd(), full)}\n`,
);
