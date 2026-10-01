/**
 * Canary for audit-trade-pnl-attribution.cjs.
 *
 * A guard that has never been observed to fail is a decoration. This breaks the ONE line the whole
 * detector rests on (`allSame`), runs the self-test, then restores the file BYTE-FOR-BYTE and proves
 * the restore with a hash. A canary that leaves the tree modified is worse than no canary.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const FILE = path.join(__dirname, 'audit-trade-pnl-attribution.cjs');
const ORIGINAL = fs.readFileSync(FILE, 'utf8');
const HASH_BEFORE = crypto.createHash('sha256').update(ORIGINAL).digest('hex');

const TARGET = 'const allSame = values.length > 1 && values.every((v) => v === values[0]);';
if (!ORIGINAL.includes(TARGET)) {
  console.log('CANARY INVALID — the line to break was not found, so nothing was proven.');
  console.log(`  looked for: ${TARGET}`);
  process.exit(2);
}

let restored = false;
const restore = () => {
  if (restored) return;
  fs.writeFileSync(FILE, ORIGINAL, 'utf8');
  restored = true;
};

try {
  // ── DIRECTION 1: break the detector, the self-test must FAIL ──
  fs.writeFileSync(FILE, ORIGINAL.replace(TARGET, 'const allSame = false;'), 'utf8');
  let failedExit = 0;
  try {
    execFileSync('node', [FILE, '--self-test'], { stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    failedExit = e.status ?? 1;
  }
  restore();

  // ── DIRECTION 2: restored, the self-test must PASS ──
  let passExit = 0;
  try {
    execFileSync('node', [FILE, '--self-test'], { stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    passExit = e.status ?? 1;
  }

  const HASH_AFTER = crypto.createHash('sha256').update(fs.readFileSync(FILE, 'utf8')).digest('hex');

  console.log(`direction 1 (detector broken)  exit=${failedExit}  ${failedExit !== 0 ? 'FAILED as required' : 'STILL PASSED — NOT A GUARD'}`);
  console.log(`direction 2 (restored)         exit=${passExit}  ${passExit === 0 ? 'passed as required' : 'STILL FAILING — broken tree'}`);
  console.log(`restore byte-for-byte          ${HASH_AFTER === HASH_BEFORE ? 'verified' : 'MISMATCH — TREE IS MODIFIED'}`);

  const ok = failedExit !== 0 && passExit === 0 && HASH_AFTER === HASH_BEFORE;
  console.log(ok ? '\nCANARY VALID — the detector is a guard, in both directions, and the tree is clean.' : '\nCANARY FAILED');
  process.exit(ok ? 0 : 1);
} catch (err) {
  restore();
  console.error(`CANARY ERROR: ${err.message}`);
  process.exit(2);
}
