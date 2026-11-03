/**
 * gen-directive-capabilities.cjs — which directives can NEVER express a direction?
 *
 * ⚠️ WHY THIS IS GENERATED AND NOT DECLARED. `rawMax` (the SIGNAL divisor) is the sum of every
 * direction-eligible directive's `maxScore`. A directive that can only ever return
 * `signalClass: 'neutral'` can never add to the numerator, so its capacity is denominator weight
 * that nothing can earn — measured at 31% of `xau-speed-m15`'s divisor and 58% of `vix-spike-v1`'s
 * (#1131). To REPORT that share the engine needs the set of such directives.
 *
 * The obvious shortcut — adding `canExpressDirection: false` to 43 classes — is a DECLARATION, and
 * `protocol-gating.service.ts` already records why declarations must not decide capacity: #761 tried
 * a `directionBias` test and reverted it after measuring that declarations understate reality
 * (`macd-crossover` declares neutral, emits direction 5,252 times).
 *
 * So the set is derived from the SOURCE, and this script is the guard that keeps the derivation
 * honest:
 *   • a class is NEUTRAL-ONLY only if it contains no 'bullish'/'bearish' literal AND every
 *     `signalClass:` assignment in it is a literal (or a ternary of literals) — an assignment from
 *     a variable or a call makes the class INDETERMINATE and it is treated as direction-capable,
 *     because "cannot judge" must never be silently read as "neutral"
 *   • `--check` fails the build when the generated file disagrees with the source
 *   • `--self-test` proves all three classifications can actually be produced
 *
 * ⚠️ This is a STRUCTURAL claim about the code, not an outcome claim about the market. It is
 * cross-checked empirically by `logs/measure-neutral-outcomes.cjs`, which replays recorded ticks
 * and reports any directive in the set that ever emitted a direction (measured 2026-10-20:
 * 5 of 43 observed, 21,605 readings, 0 false positives).
 *
 *   node scripts/gen-directive-capabilities.cjs --write | --check | --self-test
 */
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'nest', 'src', 'modules', 'directives', 'implementations');
const OUT = path.join(__dirname, '..', 'nest', 'src', 'modules', 'directives', 'directive-capabilities.generated.ts');

const LITERAL = /^'(bullish|bearish|neutral)'$/;
const DIRECTION_LITERAL = /'(bullish|bearish)'/;

/**
 * External FACTORS a directive can read on its own. Two directives reading the same one are
 * measuring the same thing twice inside any protocol that carries both (measured 2026-11-02:
 * `dxy-regime` and `gold-macro-correlation` both compute `mapRange(input.dxyValue, …)` and returned
 * 38/125 and 38/100 on the same tick).
 *
 * Kept in step with `EXCLUSIVE_INPUT_FIELDS` in `nest/scripts/directive-guard.cjs` — the guard warns
 * about the pairing, this file publishes which directives are in it.
 */
const EXCLUSIVE_INPUTS = ['dxyValue', 'eurusdValue', 'news'];

/**
 * The DIRECTION a directive can actually express, taken from the literals in its own source.
 *
 * ⚠️ This is the fact `directionBias` only CLAIMS. Measured 2026-11-02: 5 directives declare one
 * bias and emit the opposite, and 5 declare `neutral` while emitting only one side. `directionBias`
 * is user-visible (rendered by `DirectivesManagerPage` and `DirectiveViewerPage`), so the
 * disagreement was a displayed lie. This map is derived from code, so it cannot drift.
 *
 *   'both'          emits bullish AND bearish — usable in either direction
 *   'bullish-only'  contributes nothing to a SHORT_ONLY protocol
 *   'bearish-only'  contributes nothing to a LONG_ONLY protocol
 *   'none'          can never carry direction at all
 *   'indeterminate' signalClass from a variable/call — "cannot judge", never read as 'none'
 */
function directionOf(body, classification) {
  if (classification === 'indeterminate') return 'indeterminate';
  // Same rule as `classifyClass`: a literal inside a comment is a claim ABOUT the code, not the
  // code. Measured 2026-11-03 — `mfi-overbought` was reported `both` because its doc quoted `mfi`.
  const code = stripComments(body);
  const bull = /'bullish'|"bullish"/.test(code);
  const bear = /'bearish'|"bearish"/.test(code);
  if (bull && bear) return 'both';
  if (bull) return 'bullish-only';
  if (bear) return 'bearish-only';
  return 'none';
}

/**
 * Strip comments before scanning for literals.
 *
 * ⚠️ ADDED 2026-11-03 after the map said `mfi-overbought` was `both` when it emits ONLY bearish.
 * The cause was documentation: its class comment explains the mirror by quoting `mfi`'s branch
 * (`total >= 60 ? 'bullish' : 'neutral'`), and the scanner matched that quoted literal as if the
 * class could emit it.
 *
 * That is the WORST direction for this error to point. The scanner is deliberately conservative for
 * NEUTRAL-ONLY (a literal in a reason string marks a class direction-capable rather than over-claim
 * the neutral set), but here the same conservatism made a ONE-SIDED class look TWO-SIDED — so
 * inclusion arithmetic would count its 105 as earnable in a LONG_ONLY protocol, which is exactly the
 * dead capacity this map exists to expose.
 *
 * A comment is a claim ABOUT code, never code. Strip it before judging the code.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/**
 * Classify one `@Injectable()` block. Exported shape is intentionally plain so `--self-test` can
 * feed it synthetic source without touching the filesystem.
 */
function classifyClass(body) {
  // ⚠️ COMMENTS ARE STRIPPED FIRST (2026-11-03). A class comment that QUOTES another directive's
  // literal must not make this class look like it emits it — see `stripComments()`. Measured: the
  // unstripped scan called `mfi-overbought` (bearish only) a `both` directive because its
  // documentation explained the mirror by quoting `mfi`'s bullish branch.
  body = stripComments(body);
  // Order matters. A direction literal ANYWHERE decides it: `signalClass: up ? 'bearish' : 'neutral'`
  // has an identifier condition, so testing "is every assignment literal?" first would file a
  // direction-emitting class as indeterminate. Conservative in the safe direction too — the word
  // appearing in a reason string marks the class direction-capable, which under-claims the neutral
  // set rather than over-claiming it.
  if (DIRECTION_LITERAL.test(body)) return 'directional';
  const signalClassValues = [...body.matchAll(/signalClass\s*:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
  const nonLiteral = signalClassValues.filter((v) => !LITERAL.test(v));
  if (nonLiteral.length > 0) return 'indeterminate';
  return 'neutral-only';
}

function scan(dir = SRC) {
  const sets = { 'neutral-only': [], directional: [], indeterminate: [] };
  /** id -> { direction, sharedInputs } — the per-directive facts the views display. */
  const detail = {};
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const part of src.split(/(?=@Injectable\(\))/)) {
      const id = part.match(/readonly\s+id\s*=\s*['"]([a-z0-9-]+)['"]/)?.[1];
      if (!id) continue;
      const classification = classifyClass(part);
      sets[classification].push(id);
      detail[id] = {
        direction: directionOf(part, classification),
        // Reads of an external factor this directive can use entirely on its own. Detected the same
        // way the guard does it, so the published list and the warning cannot disagree. Comments are
        // stripped so documentation that MENTIONS a factor does not register as reading it.
        sharedInputs: EXCLUSIVE_INPUTS.filter((f) =>
          new RegExp(`input\\.${f}\\b|\\(input as any\\)\\.${f}\\b`).test(stripComments(part)),
        ),
      };
    }
  }
  for (const k of Object.keys(sets)) sets[k].sort();
  return { ...sets, detail };
}

function render(sets) {
  const total = sets['neutral-only'].length + sets.directional.length + sets.indeterminate.length;
  const list = sets['neutral-only'].map((id) => `  '${id}',`).join('\n');
  const countBy = (dir) => Object.values(sets.detail).filter((d) => d.direction === dir).length;
  return `/**
 * AUTO-GENERATED by scripts/gen-directive-capabilities.cjs — DO NOT EDIT BY HAND.
 * Regenerate: node scripts/gen-directive-capabilities.cjs --write
 *
 * \`NEUTRAL_ONLY_DIRECTIVES\` is the set of directives whose class contains no 'bullish'/'bearish'
 * literal and whose every \`signalClass\` assignment is a literal, so it cannot emit a direction in
 * any market. Their \`maxScore\` is denominator weight the numerator can never earn (#1131).
 *
 * ⚠️ This is REPORTING ONLY. Nothing classifies on it — \`protocol-gating\` still divides by
 * \`configuredSignalMax\`. Excluding this capacity from the divisor without re-baselining the entry
 * and strong thresholds would multiply signal labels (measured: 1,397 of 5,873 recorded ticks would
 * cross a threshold they do not cross today). See issue #1131 before using it to change maths.
 *
 * INDETERMINATE classes (a \`signalClass\` assigned from a variable or call) are NOT listed and are
 * treated as direction-capable: "cannot judge" must never be silently read as "neutral".
 *
 * Scanner: ${total} directive(s) — ${sets['neutral-only'].length} neutral-only, ${sets.directional.length} directional, ${sets.indeterminate.length} indeterminate.
 */
export const NEUTRAL_ONLY_DIRECTIVES: ReadonlySet<string> = new Set<string>([
${list}
]);

export const DIRECTIVE_CAPABILITY_COUNTS = {
  total: ${total},
  neutralOnly: ${sets['neutral-only'].length},
  directional: ${sets.directional.length},
  indeterminate: ${sets.indeterminate.length},
  both: ${countBy('both')},
  bullishOnly: ${countBy('bullish-only')},
  bearishOnly: ${countBy('bearish-only')},
  neither: ${countBy('none')},
} as const;

/**
 * Per-directive DIRECTION, derived from each class's own source literals.
 *
 * \`direction\` answers the question a composer actually has: *can this directive contribute to the
 * side I am building for?* A \`bullish-only\` directive inside a SHORT_ONLY protocol is capacity that
 * can never be earned, and until now nothing said so — \`directionBias\` is a declaration, and
 * measured on 2026-11-02 ten directives declared something their code does not do.
 *
 * \`sharedInputs\` names external factors the directive reads entirely on its own (\`dxyValue\`,
 * \`eurusdValue\`, \`news\`). Two directives listing the same factor measure it TWICE in any protocol
 * carrying both — a composition fact, not a fault, but it has to be a decision.
 *
 * ⚠️ 'indeterminate' is NOT 'none'. A class that assigns \`signalClass\` from a variable cannot be
 * judged statically, and reading that as "no direction" would silently write off real capacity.
 */
export const DIRECTIVE_DIRECTION: Readonly<Record<string, {
  direction: 'both' | 'bullish-only' | 'bearish-only' | 'none' | 'indeterminate';
  sharedInputs: readonly string[];
}>> = {
${Object.keys(sets.detail).sort().map((id) => {
  const d = sets.detail[id];
  const inputs = d.sharedInputs.length ? `[${d.sharedInputs.map((s) => `'${s}'`).join(', ')}]` : '[]';
  return `  '${id}': { direction: '${d.direction}', sharedInputs: ${inputs} },`;
}).join('\n')}
} as const;
`;
}

function main() {
  const mode = process.argv[2];
  if (mode === '--self-test') {
    const cases = [
      ['neutral-only', "readonly id='a';\ncalculate(){ return { signalClass: 'neutral', score: 1 }; }"],
      ['directional', "readonly id='b';\ncalculate(){ return { signalClass: 'bullish', score: 1 }; }"],
      ['directional', "readonly id='c';\ncalculate(){ return { signalClass: up ? 'bearish' : 'neutral', score: 1 }; }"],
      ['indeterminate', "readonly id='d';\ncalculate(){ return { signalClass: trend, score: 1 }; }"],
      ['indeterminate', "readonly id='e';\ncalculate(){ return { signalClass: this.pick(), score: 1 }; }"],
    ];
    let failures = 0;
    for (const [expected, body] of cases) {
      const actual = classifyClass(body);
      const ok = actual === expected;
      if (!ok) failures++;
      console.log(`  ${ok ? '✔' : '✖'} expected ${expected.padEnd(13)} got ${actual.padEnd(13)} — ${body.split('\n')[1].trim()}`);
    }

    // `directionOf` — the fact the views display. Every outcome must be reachable, and
    // 'indeterminate' must never collapse into 'none' (that would write off real capacity).
    const dirCases = [
      ['both', 'signalClass: up ? \'bullish\' : \'bearish\'', 'directional'],
      ['bullish-only', "signalClass: total >= 60 ? 'bullish' : 'neutral'", 'directional'],
      ['bearish-only', "signalClass: total <= 35 ? 'bearish' : 'neutral'", 'directional'],
      ['none', "signalClass: 'neutral'", 'neutral-only'],
      ['indeterminate', 'signalClass: trend', 'indeterminate'],
    ];
    for (const [expected, body, classification] of dirCases) {
      const actual = directionOf(body, classification);
      const ok = actual === expected;
      if (!ok) failures++;
      console.log(`  ${ok ? '✔' : '✖'} direction ${expected.padEnd(14)} got ${actual.padEnd(14)} — ${body}`);
    }
    // Comments must not decide a class's direction. Measured 2026-11-03: `mfi-overbought` (bearish
    // only) was reported `both` because its doc quoted `mfi`'s bullish branch.
    const quoted = `/**\n * mirror of mfi, which does total >= 60 ? 'bullish' : 'neutral'\n */\nexport class X { signalClass: total >= 60 ? 'bearish' : 'neutral' }`;
    if (directionOf(quoted, 'directional') !== 'bearish-only') {
      failures++;
      console.log('  ✖ a BULLISH literal inside a comment must not make a class two-sided');
    }
    if (classifyClass(`/** mentions 'bullish' only in prose */\nexport class Y { return { signalClass: 'neutral' } }`) !== 'neutral-only') {
      failures++;
      console.log('  ✖ a direction word inside a comment must not mark a neutral class directional');
    }

    // Ternary form is the one an anchored regex missed in the guard (2026-11-02).
    if (directionOf("signalClass = s >= 65 ? 'bullish' : s <= 35 ? 'bearish' : 'neutral'", 'directional') !== 'both') {
      failures++;
      console.log('  ✖ a ternary assignment must still be seen as BOTH directions');
    }
    // The scanner must also be able to FAIL, not just run: an empty directory would report zero
    // directives and look identical to a clean pass if the guard did not check the count.
    if (render(scan()) === '') failures++;
    console.log(failures === 0
      ? `[directive-capabilities] ✅ self-test passed (${cases.length} classifications)`
      : `[directive-capabilities] ✖ self-test FAILED (${failures})`);
    process.exit(failures === 0 ? 0 : 1);
  }

  const sets = scan();
  const total = sets['neutral-only'].length + sets.directional.length + sets.indeterminate.length;
  if (total === 0) {
    console.error('[directive-capabilities] ✖ scanned 0 directives — refusing to write an empty set');
    process.exit(1);
  }
  const out = render(sets);

  if (mode === '--write') {
    fs.writeFileSync(OUT, out, 'utf8');
    console.log(`[directive-capabilities] wrote ${path.relative(path.join(__dirname, '..'), OUT)}`);
    console.log(`   ${total} directive(s): ${sets['neutral-only'].length} neutral-only · `
      + `${sets.directional.length} directional · ${sets.indeterminate.length} indeterminate`);
    if (sets.indeterminate.length) {
      console.log(`   indeterminate (treated as direction-capable): ${sets.indeterminate.join(', ')}`);
    }
    process.exit(0);
  }

  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== out) {
    console.error('[directive-capabilities] ✖ OUT OF DATE — regenerate: node scripts/gen-directive-capabilities.cjs --write');
    const before = new Set([...current.matchAll(/^ {2}'([a-z0-9-]+)',$/gm)].map((m) => m[1]));
    for (const id of sets['neutral-only']) if (!before.has(id)) console.error(`    + ${id} <-- now neutral-only`);
    for (const id of before) if (!sets['neutral-only'].includes(id)) console.error(`    - ${id} <-- no longer neutral-only`);
    process.exit(1);
  }
  console.log(`[directive-capabilities] ✅ OK — ${total} directives, `
    + `${sets['neutral-only'].length} neutral-only, generated file current`);
}

main();
