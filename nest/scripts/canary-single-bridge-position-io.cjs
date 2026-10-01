/**
 * Canary for the #1033 rule — proves `NO_ARG_SERVICE_GETPOSITIONS` fires on the REAL tree, not just
 * on a synthetic string.
 *
 * ⚠️ The self-test proves the rule matches a fixture. This proves it fires on the file it is meant to
 * protect, and that the restore is byte-for-byte — a canary that leaves the tree modified is worse
 * than no canary.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TARGET = path.join(ROOT, 'nest', 'src', 'modules', 'trading', 'trade-history.controller.ts');
const GUARD = path.join(ROOT, 'nest', 'scripts', 'validate-single-bridge-position-io.cjs');

const ORIGINAL = fs.readFileSync(TARGET, 'utf8');
const HASH_BEFORE = crypto.createHash('sha256').update(ORIGINAL).digest('hex');

// A line that must be caught: the exact name #1033 removed.
const PLANT = '        const planted = await this.mt5.getPositions();\n';
const ANCHOR = '  @Get(\'weekend-checklist\')';
if (!ORIGINAL.includes(ANCHOR)) {
  console.log('CANARY INVALID — anchor not found, so nothing was proven.');
  process.exit(2);
}

let restored = false;
const restore = () => {
  if (restored) return;
  fs.writeFileSync(TARGET, ORIGINAL, 'utf8');
  restored = true;
};

const runGuard = () => {
  try {
    execFileSync('node', [GUARD], { stdio: 'pipe', encoding: 'utf8' });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
};

try {
  // ── DIRECTION 1: plant the defect, the guard must FAIL ──
  fs.writeFileSync(TARGET, ORIGINAL.replace(ANCHOR, PLANT + ANCHOR), 'utf8');
  const plantedExit = runGuard();
  const plantedOut = (() => {
    try { return execFileSync('node', [GUARD], { stdio: 'pipe', encoding: 'utf8' }); }
    catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
  })();
  restore();

  // ── DIRECTION 2: restored, the guard must PASS ──
  const cleanExit = runGuard();
  const HASH_AFTER = crypto.createHash('sha256').update(fs.readFileSync(TARGET, 'utf8')).digest('hex');

  console.log(`direction 1 (defect planted)  exit=${plantedExit}  ${plantedExit !== 0 ? 'FAILED as required' : 'STILL PASSED — NOT A GUARD'}`);
  console.log(`  named the planted line:     ${plantedOut.includes('broker-less') ? 'yes' : 'NO — fired for another reason'}`);
  console.log(`direction 2 (restored)        exit=${cleanExit}  ${cleanExit === 0 ? 'passed as required' : 'STILL FAILING'}`);
  console.log(`restore byte-for-byte         ${HASH_AFTER === HASH_BEFORE ? 'verified' : 'MISMATCH — TREE IS MODIFIED'}`);

  const ok = plantedExit !== 0 && cleanExit === 0 && HASH_AFTER === HASH_BEFORE;
  console.log(ok ? '\nCANARY VALID' : '\nCANARY FAILED');
  process.exit(ok ? 0 : 1);
} catch (err) {
  restore();
  console.error(`CANARY ERROR: ${err.message}`);
  process.exit(2);
}
