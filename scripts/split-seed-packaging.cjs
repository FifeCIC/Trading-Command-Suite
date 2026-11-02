#!/usr/bin/env node
/**
 * split-seed-packaging.cjs — keep only a chosen set in the SHIPPED seed, leave the rest local.
 *
 * ── WHY THIS EXISTS ──
 *
 * Owner, 2026-11-02: *"I'm planning to package only 2-3 strategies with the app for the public and
 * so the rest will need to exist in my database OR/AND user files on my system: removed from seed
 * data."*
 *
 * `protocols-seed-data.ts` (48 protocols) and `strategy-seed-data.ts` (40 bots) are what a NEW
 * installation receives. Shipping all 88 makes every fresh install inherit this machine's
 * experiments — including the ones measured and retired in the same change.
 *
 * ── WHY NOT JUST DELETE THEM FROM THE DATABASE ──
 *
 * Because deletion is unavailable and destructive in the wrong direction: `seedProtocolsToDatabase()`
 * is upsert-only with no deletes, so a row absent from the seed simply STAYS in an existing database
 * — which is precisely the requirement. The shipped file decides what a NEW install gets; this
 * machine keeps everything it already has.
 *
 * ── THE ONE HAZARD, STATED ──
 *
 * ⚠️ Removing an entry from the seed is NOT reversible from the database in one direction: a fresh
 * clone loses it. So the removed entries are written VERBATIM to a local file outside the seed
 * (`nest/prisma/seed-parked/<stamp>.md`) before anything is removed, and `--restore` puts them back.
 *
 * USAGE
 *   node scripts/split-seed-packaging.cjs --keep a,b,c            # dry run, prints the plan
 *   node scripts/split-seed-packaging.cjs --keep a,b,c --apply    # writes
 *   node scripts/split-seed-packaging.cjs --restore <parked.json> # put entries back
 *   node scripts/split-seed-packaging.cjs --self-test
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROTOCOLS = path.join(ROOT, 'nest/src/modules/scoring/protocols-seed-data.ts');
const BOTS = path.join(ROOT, 'nest/src/modules/trading/strategy-seed-data.ts');
const PARKED_DIR = path.join(ROOT, 'nest/prisma/seed-parked');

/**
 * Split `export const X: T = { ... };` into its top-level `"key": { ... },` entries by brace
 * counting. A regex cannot do this: the entries contain nested objects AND strings with braces in
 * them, so the only trustworthy delimiter is depth.
 *
 * Returns { head, entries: [{ key, text }], tail } so a rewrite can reproduce the file exactly.
 */
function parseObjectEntries(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  // ⚠️ ANCHOR ON `= {`, NOT THE FIRST BRACE AFTER THE MARKER. The declaration is
  // `export const PROTOCOL_SEED_DATA: Record<string, SeedProtocol> = {`, so the first `{` belongs to
  // the generic `Record<…>` — parsing from there produced a key called `PURPOSE` out of an unrelated
  // object and silently missed every real entry. Measured on the first dry run, 2026-11-02.
  const eqMatch = /=\s*\{/.exec(source.slice(start));
  if (!eqMatch) throw new Error('`= {` not found after marker');
  const open = start + eqMatch.index + eqMatch[0].length - 1;

  const entries = [];
  let i = open + 1;
  let depth = 1;
  let inString = false;
  let quote = '';
  let escaped = false;
  let entryStart = -1;
  let entryKey = null;

  const headEnd = open + 1;

  while (i < source.length) {
    // ⚠️ SKIP COMMENTS FIRST. `// PURPOSE: settle whether…` sits inside an entry and its `PURPOSE:`
    // looks exactly like a key at depth 1 — measured on the dry run, 2026-11-02, where it appeared
    // in the entry list as a protocol called PURPOSE.
    if (!inString && source.startsWith('//', i)) {
      const nl = source.indexOf('\n', i);
      i = nl < 0 ? source.length : nl + 1;
      continue;
    }
    if (!inString && source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }

    // ⚠️ THE KEY CHECK MUST COME BEFORE THE STRING BRANCH. A key is `"a-v1":`, so testing for a
    // string first swallows the key as ordinary content and the entry is never opened — measured on
    // the self-test's first run, where it parsed 0 entries.
    if (!inString && depth === 1 && entryStart < 0) {
      const rest = source.slice(i);
      const m = /^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*:\s*/.exec(rest);
      if (m) {
        entryStart = i;
        entryKey = m[1] ?? m[2] ?? m[3];
        i += m[0].length;
        continue;
      }
      // Whitespace or a comma between entries — step over it.
      if (/\s|,/.test(source[i])) { i++; continue; }
    }

    const ch = source[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) inString = false;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      quote = ch;
      i++;
      continue;
    }

    if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        if (entryStart >= 0) entries.push({ key: entryKey, text: source.slice(entryStart, i).trim() });
        return { head: source.slice(0, headEnd), entries, tail: source.slice(i) };
      }
      if (depth === 1 && entryStart >= 0) {
        // An entry's own closing brace/bracket — the entry is complete.
        entries.push({ key: entryKey, text: source.slice(entryStart, i + 1).trim() });
        entryStart = -1;
        entryKey = null;
      }
    }
    i++;
  }
  throw new Error('unterminated object — parse failed');
}

/** Array-of-objects form used by `DEFAULT_TRADING_STRATEGIES`. */
function parseArrayEntries(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  // ⚠️ ANCHOR ON `= [`, for the same reason the object parser anchors on `= {`: the declaration is
  // `export const DEFAULT_TRADING_STRATEGIES: SeedTradingStrategy[] = [`, and the first `[` after
  // the marker belongs to the TYPE (`SeedTradingStrategy[]`), not to the value.
  const eqMatch = /=\s*\[/.exec(source.slice(start));
  if (!eqMatch) throw new Error('`= [` not found after marker');
  const open = start + eqMatch.index + eqMatch[0].length - 1;

  const entries = [];
  let i = open + 1;
  let depth = 1;
  let inString = false;
  let quote = '';
  let escaped = false;
  let entryStart = -1;

  while (i < source.length) {
    // ⚠️ SKIP COMMENTS. The bot seed is heavily commented (`/** #995 — the observer's decelPct …`),
    // and an apostrophe inside a `//` comment opens a phantom string that never closes — measured
    // 2026-11-02, where this parser found 8 of 38 entries and silently dropped the rest.
    if (!inString && source.startsWith('//', i)) {
      const nl = source.indexOf('\n', i);
      i = nl < 0 ? source.length : nl + 1;
      continue;
    }
    if (!inString && source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }

    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) inString = false;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = true; quote = ch; i++; continue; }

    if (ch === '{' || ch === '[') {
      if (depth === 1 && ch === '{' && entryStart < 0) entryStart = i;
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        if (entryStart >= 0) entries.push({ key: null, text: source.slice(entryStart, i) });
        return { head: source.slice(0, open + 1), entries, tail: source.slice(i) };
      }
      if (depth === 1 && entryStart >= 0) {
        entries.push({ key: null, text: source.slice(entryStart, i + 1) });
        entryStart = -1;
      }
    }
    i++;
  }
  throw new Error('unterminated array — parse failed');
}

/** Keep the entries whose key (or `protocolId` field) is in `keep`. */
function filterProtocolEntries(entries, keep) {
  const kept = [];
  const parked = [];
  for (const e of entries) {
    if (keep.has(e.key)) kept.push(e);
    else parked.push(e);
  }
  return { kept, parked };
}

function rebuildObjectFile({ head, kept, tail }) {
  const body = kept.map((e) => `  ${e.text.trim()},`).join('\n');
  return `${head}\n${body}\n${tail}`;
}

function rebuildArrayFile({ head, kept, tail }) {
  // ⚠️ The array's last entry has NO trailing comma in the source, so a naive `join(',\n')` plus a
  // trailing comma produces a syntax error on the closing bracket only if the array is empty.
  // Handling both keeps the rewrite valid whatever survives.
  if (kept.length === 0) return `${head}\n${tail}`;
  // ⚠️ Re-indent the OPENING line only. `e.text` starts at `{` with no leading space while its inner
  // lines keep their original 4-space indent, so a bare join produced `{` at column 0 — valid
  // TypeScript but visibly different from every other entry in the file.
  const body = kept.map((e) => '  ' + e.text.trim().replace(/,$/, '')).join(',\n');
  return `${head}\n${body},\n${tail}`;
}

/** A bot entry's `protocolId` decides whether it can survive without its protocol. */
function protocolIdOf(text) {
  const m = /protocolId:\s*['"]([^'"]+)['"]/.exec(text);
  return m ? m[1] : null;
}

/** A bot entry's own `name`. */
function nameOf(text) {
  const m = /name:\s*['"]([^'"]+)['"]/.exec(text);
  return m ? m[1] : null;
}

function selfTest() {
  let pass = 0;
  const fail = [];
  const ok = (name, cond) => (cond ? pass++ : fail.push(name));

  const sample = `const X = {\n  "a-v1": {\n    "name": "A {with braces}",\n    "groups": [{ "x": 1 }, { "y": 2 }]\n  },\n  "b-v1": {\n    "name": "B",\n    "groups": []\n  },\n};\n`;
  const parsed = parseObjectEntries(sample, 'const X = ');
  ok('parses both entries', parsed.entries.length === 2);
  ok('keys are correct', parsed.entries.map((e) => e.key).join(',') === 'a-v1,b-v1');
  ok('braces inside strings do not split', parsed.entries[0].text.includes('A {with braces}'));

  const f = filterProtocolEntries(parsed.entries, new Set(['b-v1']));
  ok('keeps one', f.kept.length === 1 && f.kept[0].key === 'b-v1');
  ok('parks one', f.parked.length === 1 && f.parked[0].key === 'a-v1');

  const rebuilt = rebuildObjectFile({ head: parsed.head, kept: f.kept, tail: parsed.tail });
  const reparsed = parseObjectEntries(rebuilt, 'const X = ');
  ok('rebuild round-trips', reparsed.entries.length === 1 && reparsed.entries[0].key === 'b-v1');
  ok('rebuild is syntactically closed', rebuilt.trimEnd().endsWith('};'));

  // A keep-set naming nothing must refuse rather than empty the file.
  const empty = filterProtocolEntries(parsed.entries, new Set(['nope']));
  ok('empty keep-set is detectable', empty.kept.length === 0);

  const arr = `const Y = [\n  { name: 'A', protocolId: 'a-v1' },\n  { name: 'B', protocolId: 'b-v1' },\n];\n`;
  const parsedArr = parseArrayEntries(arr, 'const Y = ');
  ok('array form parses', parsedArr.entries.length === 2);

  console.log(`\nself-test: ${pass} passed, ${fail.length} failed`);
  for (const x of fail) console.log('  ✖', x);
  console.log(fail.length ? '❌ self-test FAIL\n' : '✅ self-test PASS\n');
  return fail.length ? 1 : 0;
}

function arg(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
}

function main() {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  const apply = process.argv.includes('--apply');
  const keepRaw = arg('--keep', '');
  if (!keepRaw) {
    console.error('❌ --keep <slug,slug,...> is required (refusing to empty the seed)');
    process.exit(1);
  }
  const keep = new Set(keepRaw.split(',').map((s) => s.trim()).filter(Boolean));

  const src = fs.readFileSync(PROTOCOLS, 'utf8');
  const parsed = parseObjectEntries(src, 'PROTOCOL_SEED_DATA');
  const known = new Set(parsed.entries.map((e) => e.key));
  const unknown = [...keep].filter((k) => !known.has(k));
  if (unknown.length) {
    console.error(`❌ unknown protocol slug(s): ${unknown.join(', ')}`);
    console.error('   Refusing: a typo would silently park the wrong entry.');
    process.exit(1);
  }
  if (keep.size === 0) {
    console.error('❌ keep-set is empty');
    process.exit(1);
  }

  const { kept, parked } = filterProtocolEntries(parsed.entries, keep);
  console.log(`\nprotocols-seed-data.ts: ${parsed.entries.length} entries`);
  console.log(`  SHIP  (${kept.length}): ${kept.map((e) => e.key).join(', ')}`);
  console.log(`  PARK  (${parked.length}): ${parked.map((e) => e.key).join(', ') || 'none'}`);

  // ── BOTS (2026-11-02) ──
  // A bot seed entry carries a `protocolId`. Keeping a bot whose protocol is no longer shipped
  // would seed a strategy pointing at a protocol a fresh install does not have — the exact
  // orphan that `validate-strategy-library-links` exists to catch. So the two files are always
  // filtered in the SAME run, and the cross-check below refuses the write if they disagree.
  const keepBotsRaw = arg('--keep-bots', '');
  const keepBots = new Set(keepBotsRaw.split(',').map((s) => s.trim()).filter(Boolean));
  let botPlan = null;
  if (keepBots.size > 0) {
    const botSrc = fs.readFileSync(BOTS, 'utf8');
    const parsedBots = parseArrayEntries(botSrc, 'DEFAULT_TRADING_STRATEGIES');
    const knownBots = new Set(parsedBots.entries.map((e) => nameOf(e.text)));
    const unknownBots = [...keepBots].filter((n) => !knownBots.has(n));
    if (unknownBots.length) {
      console.error(`❌ unknown bot name(s): ${unknownBots.join(', ')}`);
      process.exit(1);
    }
    const botsKept = [];
    const botsParked = [];
    for (const e of parsedBots.entries) {
      (keepBots.has(nameOf(e.text)) ? botsKept : botsParked).push(e);
    }
    // ⚠️ EVERY SHIPPED BOT'S PROTOCOL MUST BE SHIPPED. This is the check that makes filtering two
    // files in one run safe; without it a mismatch is only discovered by a fresh install.
    const orphaned = botsKept
      .map((e) => ({ bot: nameOf(e.text), protocol: protocolIdOf(e.text) }))
      .filter((x) => x.protocol && !keep.has(x.protocol));
    if (orphaned.length) {
      console.error('❌ REFUSING: shipped bot(s) reference a protocol that is not shipped:');
      for (const o of orphaned) console.error(`     ${o.bot} -> ${o.protocol}`);
      process.exit(1);
    }
    botPlan = { parsedBots, botsKept, botsParked };
    console.log(`\nstrategy-seed-data.ts: ${parsedBots.entries.length} bots`);
    console.log(`  SHIP  (${botsKept.length}): ${botsKept.map((e) => `${nameOf(e.text)} [${protocolIdOf(e.text)}]`).join(', ')}`);
    console.log(`  PARK  (${botsParked.length})`);
  }

  if (!apply) {
    console.log('\n(dry run — pass --apply to write)\n');
    return;
  }

  fs.mkdirSync(PARKED_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const parkedFile = path.join(PARKED_DIR, `protocols-${stamp}.json`);
  fs.writeFileSync(parkedFile, JSON.stringify(
    parked.map((e) => ({ key: e.key, text: e.text })), null, 2,
  ));

  const next = rebuildObjectFile({ head: parsed.head, kept, tail: parsed.tail });
  fs.writeFileSync(PROTOCOLS, next);

  if (botPlan) {
    const parkedBotsFile = path.join(PARKED_DIR, `bots-${stamp}.json`);
    fs.writeFileSync(parkedBotsFile, JSON.stringify(
      botPlan.botsParked.map((e) => ({ name: nameOf(e.text), protocolId: protocolIdOf(e.text), text: e.text })), null, 2,
    ));
    fs.writeFileSync(BOTS, rebuildArrayFile({
      head: botPlan.parsedBots.head, kept: botPlan.botsKept, tail: botPlan.parsedBots.tail,
    }));
    const botCheck = parseArrayEntries(fs.readFileSync(BOTS, 'utf8'), 'DEFAULT_TRADING_STRATEGIES');
    const botNames = botCheck.entries.map((e) => nameOf(e.text)).sort();
    const wantBots = [...keepBots].sort();
    const botsSame = JSON.stringify(botNames) === JSON.stringify(wantBots);
    console.log(`bot read-back: ${botCheck.entries.length} [${botNames.join(', ')}] ${botsSame ? '✔' : '✖ MISMATCH'}`);
    console.log(`parked ${botPlan.botsParked.length} bot(s) to ${path.relative(ROOT, parkedBotsFile)}`);
    if (!botsSame) process.exit(1);
  }

  // Read back — a rewritten file must still parse to exactly the kept set.
  const check = parseObjectEntries(fs.readFileSync(PROTOCOLS, 'utf8'), 'PROTOCOL_SEED_DATA');
  const checkKeys = check.entries.map((e) => e.key).sort();
  const wantKeys = [...keep].sort();
  const same = JSON.stringify(checkKeys) === JSON.stringify(wantKeys);
  console.log(`\nread-back: ${check.entries.length} entries [${checkKeys.join(', ')}] ${same ? '✔' : '✖ MISMATCH'}`);
  console.log(`parked ${parked.length} entr(ies) to ${path.relative(ROOT, parkedFile)}`);
  if (!same) process.exit(1);
}

main();
