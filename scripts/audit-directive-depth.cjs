/**
 * audit-directive-depth.cjs — M1 (#1166) evidence extractor. REV 3.
 *
 * ── THE TWO EARLIER REVISIONS WERE BOTH WRONG, IN OPPOSITE DIRECTIONS ───────────────────────────
 *
 * REV 1 scanned per FILE. `momentum-and-macro.directives.ts` and `mt5-indicators.directives.ts` each
 * declare MANY directives, so every constant in the file was attributed to one directive: it reported
 * `moving-averages` with 73 "score mappings" and `williams-r` with 98, both of which were the whole
 * file's contents. It also counted `score: 0, confidence: …` return literals as formulas.
 *
 * REV 2 split per CLASS, which fixed the formulas but LOST THE CONSTANTS — `RSI_PERIOD = 14` is
 * MODULE level, declared before the first class, so splitting on class boundaries threw it away. It
 * reported **1 tuning constant in the entire codebase**.
 *
 * REV 3 combines both, and the distinction is the lesson:
 *   • tuning constants are FILE-scoped (module level) — extract per file, and flag the row when the
 *     file declares more than one directive so a reader knows the attribution is file-wide;
 *   • score calibrations are CLASS-scoped — extract per class body.
 *
 * ── A THIRD CORRECTION, ON THE COUNT ITSELF ─────────────────────────────────────────────────────
 * There are **161 directives in 113 files**. The earlier headline "113 directives" was a FILE count;
 * `validate-directive-capabilities` in `prebuild` reports **161 directives** independently, which is
 * what confirms it. Any document quoting 113 as a directive count is wrong.
 *
 * ⚠️ `MIN_BARS` is excluded: it is derived (`RSI_PERIOD + SWING_LOOKBACK * 3 + 2`), so counting it
 * double-counts the knob that produced it. It is still recorded, because it is what silently changes
 * when a period does.
 *
 * ── REV 4: `headroom` COUNTS UNEXPOSED KNOBS ONLY (#1165, measured 2026-11-01) ─────────────────
 * REV 3 counted every tuning constant, so once a constant became a parameter default the directive's
 * headroom went UP — `volume-confirmation` climbed to the top of the table immediately after all
 * three of its constants were exposed as parameters. A ranking that recommends parameterising what
 * is already parameterised is the same defect as ranking an UNREGISTERED directive first (#1169):
 * plausible, and wrong, with no error behind it. A constant counts toward `headroom` only if it does
 * not appear as a parameter `default:` in the same file; the `p` column shows how many are exposed.
 *
 * Usage (repo root):  node logs/audit-directive-depth.cjs
 * Emits:              logs/directive-audit.json  |  prints summary + the high-headroom rows
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'nest', 'src', 'modules', 'directives', 'implementations');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.includes('spec'));

const NAMED_CONST = /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*([^;\n]+);/gm;
const TUNING_WORD = /(PERIOD|LOOKBACK|LEN|LENGTH|WINDOW|THRESHOLD|SMOOTH|MULTIPLIER|RATIO|SCALE|CUTOFF|LAG|LEVEL)/;
const SCORE_ASSIGN = /\bscore\s*=\s*([^;\n]+)/g;

const isFormula = (expr) =>
  /[a-zA-Z_]/.test(expr) && /\d/.test(expr) && /[-+*/]/.test(expr) && !/confidence|reason|signalClass/.test(expr);

const rows = [];

// ── REGISTRATION ────────────────────────────────────────────────────────────────────────────────
// ⚠️ MEASURED 2026-11-01: the top two rows by headroom (`price-time-gap`, `candle-pressure`) were
// never registered, so they could not score. A headroom ranking that ignores registration is a
// plausible number with no error behind it — this repo's signature failure.
//
// Registration = a `register(this.x)` call in `directives.module.ts`, resolved through its constructor
// parameter to the DECLARED class name (that resolves an aliased import, which a name search cannot).
// `/api/directives` is NOT a registration check: it lists the registry after DB overlay.
//
// ⚠️ THE RULE LIVES IN `scripts/lib/directive-registry.cjs`. It was four copies before; one of them
// tested class-name presence (matching the IMPORT line) and reported OK on a broken tree.
const { registeredClassNames } = require('./lib/directive-registry.cjs');
const MODULE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'nest', 'src', 'modules', 'directives', 'directives.module.ts'),
  'utf8',
);
const _registeredClasses = registeredClassNames(MODULE_SRC);
const isRegistered = (className) => _registeredClasses.has(className);
for (const f of files) {
  const whole = fs.readFileSync(path.join(DIR, f), 'utf8');

  // ── FILE SCOPE: module-level tuning constants ──
  const tuning = [];
  let minBarsExpr = null;
  for (const m of whole.matchAll(NAMED_CONST)) {
    const name = m[1];
    const value = m[2].trim();
    if (/^MIN_BARS$/.test(name)) { minBarsExpr = value; continue; }
    if (!TUNING_WORD.test(name)) continue;
    tuning.push({ name, value });
  }

  // ── CLASS SCOPE: each directive class body, with its own calibrations ──
  const starts = [];
  const re = /export\s+class\s+(\w+)[\s\S]*?implements\s+IDirective/g;
  for (const m of whole.matchAll(re)) starts.push({ name: m[1], at: m.index });
  if (!starts.length) continue; // a shared helper file — skip rather than mis-attribute

  const classBodies = starts.map((s, i) => whole.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : whole.length));
  const sharedFile = classBodies.length > 1;

  for (let ci = 0; ci < classBodies.length; ci++) {
    const src = classBodies[ci];
    const className = starts[ci].name;
    const id = (/readonly id = '([^']+)'/.exec(src) || [])[1];
    if (!id) continue;

    const formulas = [];
    for (const m of src.matchAll(SCORE_ASSIGN)) {
      const expr = m[1].trim();
      if (isFormula(expr)) formulas.push(expr);
    }
    const distinct = [...new Set(formulas)];

    // ── EXPOSED vs REMAINING headroom (#1165, measured 2026-11-01) ──────────────────────────────
    // ⚠️ THE RANKING WAS RECOMMENDING WORK ALREADY DONE. `tuningCount` counts every module-level
    // tuning constant, but since parameterisation lands, those constants BECOME the declared
    // parameter defaults (`default: GAP_LOOKBACK`) — so a parameterised directive's headroom went
    // UP, and `volume-confirmation` rose to the top of the table immediately after all three of its
    // constants were exposed as parameters. A number that recommends parameterising what is already
    // parameterised is the same failure as ranking an unregistered directive top (#1169): plausible,
    // and wrong, with no error behind it.
    //
    // A constant is EXPOSED when it appears as a parameter `default:` in the same file. Anything
    // else is genuinely unturned, and `headroom` now counts only those.
    const exposed = tuning.filter((t) => new RegExp(`default:\\s*${t.name}\\b`).test(whole));
    const unexposed = tuning.filter((t) => !exposed.includes(t));

    rows.push({
      id,
      file: f,
      sharedFile,
      category: (/readonly category = '([^']+)'/.exec(src) || [])[1] ?? '?',
      maxScore: Number((/readonly maxScore = ([\d.]+)/.exec(src) || [])[1] ?? NaN),
      version: (/readonly version = '([^']+)'/.exec(src) || [])[1] ?? null,
      minBars: (/readonly minBars = \{([^}]+)\}/.exec(src) || [])[1]?.trim() ?? null,
      minBarsExpr,
      readsConfig: /input\.(config|params|options)\b/.test(src),
      tuning,
      tuningCount: tuning.length,
      exposedCount: exposed.length,
      unexposedKinds: unexposed.map((t) => t.name),
      scoreFormulas: distinct.slice(0, 5),
      formulaCount: distinct.length,
      className,
      headroom: unexposed.length + distinct.length,
      registered: isRegistered(className),
    });
  }
}

rows.sort((a, b) => b.headroom - a.headroom);

const totals = {
  directives: rows.length,
  files: new Set(rows.map((r) => r.file)).size,
  withConfig: rows.filter((r) => r.readsConfig).length,
  knobs: rows.reduce((a, r) => a + r.tuningCount, 0),
  // REV 4 — the split that makes `headroom` honest. `exposed` knobs are ALREADY tunable; only
  // `unexposed` ones are work.
  exposed: rows.reduce((a, r) => a + r.exposedCount, 0),
  unexposed: rows.reduce((a, r) => a + (r.tuningCount - r.exposedCount), 0),
  formulas: rows.reduce((a, r) => a + r.formulaCount, 0),
  multiDirectiveFiles: [...new Set(rows.filter((r) => r.sharedFile).map((r) => r.file))],
  unregistered: rows.filter((r) => !r.registered).length,
};

console.log(`directives: ${totals.directives}  (across ${totals.files} files)`);
console.log(`files declaring >1 directive (constant attribution is file-wide there): ${totals.multiDirectiveFiles.length}`);
console.log(`read any per-instance config: ${totals.withConfig}`);
console.log(`tuning constants (MIN_BARS excluded): ${totals.knobs}  — ${totals.exposed} exposed as parameters, ${totals.unexposed} unturned`);
console.log(`distinct hardcoded score calibrations: ${totals.formulas}`);
console.log(`UNREGISTERED (declared but never instantiated - can never score): ${totals.unregistered}`);

const high = rows.filter((r) => r.headroom >= 4);
const mid = rows.filter((r) => r.headroom >= 1 && r.headroom < 4);
const low = rows.filter((r) => r.headroom === 0);
console.log(`\nHIGH (4+): ${high.length}   MID (1-3): ${mid.length}   NONE (0): ${low.length}`);

console.log('\nid                          cat        max  knobs  expo  calib  headroom  reg  shared');
for (const r of high.slice(0, 24)) {
  console.log(
    `${r.id.padEnd(27)} ${String(r.category).padEnd(10)} ${String(r.maxScore).padStart(4)} ` +
    `${String(r.tuningCount).padStart(6)} ${String(r.exposedCount).padStart(5)} ${String(r.formulaCount).padStart(6)} ${String(r.headroom).padStart(9)}  ${r.registered ? 'y' : 'NO'}   ${r.sharedFile ? 'yes' : ''}`,
  );
}

// ⚠️ Written to `logs/`, NOT next to this script. This script moved from `logs/` to `scripts/` when it
// became a referenced tool, and `__dirname` silently followed it — putting a generated 78 KB JSON into
// a tracked source directory. `logs/` is gitignored, which is the right home for an output artefact.
const auditDir = path.join(__dirname, '..', 'logs');
fs.mkdirSync(auditDir, { recursive: true });
const out = path.join(auditDir, 'directive-audit.json');
fs.writeFileSync(out, `${JSON.stringify({ generatedAt: new Date().toISOString(), totals, rows }, null, 2)}\n`);
console.log(`\nwrote ${out}`);
