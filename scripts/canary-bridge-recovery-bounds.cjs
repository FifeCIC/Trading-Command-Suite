/**
 * Canary for validate-bridge-recovery-bounds.cjs.
 *
 * ⚠️ It breaks BOTH invariants, in sequence, and proves the guard fires for the RIGHT REASON each
 * time — a canary that only checks the exit code cannot tell "the guard caught my edit" from "the
 * guard was already failing". It restores byte-for-byte and verifies the restore by hash: a canary
 * that leaves the tree modified is worse than no canary.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE = path.join(ROOT, 'scripts', 'mt5-bridge', 'mt5_bridge_v2.py');
const RECOVERY = path.join(ROOT, 'nest', 'src', 'modules', 'providers', 'mt5', 'mt5-session-recovery.service.ts');
const GUARD = path.join(__dirname, 'validate-bridge-recovery-bounds.cjs');

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f, 'utf8')).digest('hex');
const ORIGINAL = {
  bridge: fs.readFileSync(BRIDGE, 'utf8'),
  recovery: fs.readFileSync(RECOVERY, 'utf8'),
};
const HASH = { bridge: sha(BRIDGE), recovery: sha(RECOVERY) };

let restored = false;
const restore = () => {
  // ⚠️ NO EARLY-RETURN GUARD HERE, AND THAT IS A FIX. The first version of this canary had
  // `if (restored) return;` — so the SECOND restore (after modifying a second file) was a NO-OP,
  // the two-direction run left `mt5-session-recovery.service.ts` flipped to `enabled: true`, and the
  // canary reported its own damage as a FAILED direction 3. **It modified the tree it was measuring.**
  // Restoring is idempotent; making it "run once" only ever skips a restore that was needed.
  fs.writeFileSync(BRIDGE, ORIGINAL.bridge, 'utf8');
  fs.writeFileSync(RECOVERY, ORIGINAL.recovery, 'utf8');
  restored = true;
};

const runGuard = () => {
  try {
    const out = execFileSync('node', [GUARD], { stdio: 'pipe', encoding: 'utf8' });
    return { code: 0, out: String(out) };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
};

try {
  // ── direction 1: a bridge call loses its timeout ──────────────────────────────────────────
  const TIMEOUT_ARG = 'timeout=MT5_INIT_TIMEOUT_MS';
  if (!ORIGINAL.bridge.includes(TIMEOUT_ARG)) {
    console.log('CANARY INVALID — no timeout= to remove, so nothing was proven.');
    process.exit(2);
  }
  // Remove it from ONE call site only (the first occurrence).
  fs.writeFileSync(BRIDGE, ORIGINAL.bridge.replace(TIMEOUT_ARG, ''), 'utf8');
  const d1 = runGuard();
  restore();

  // ── direction 2: the unattended reconnect is re-armed ─────────────────────────────────────
  const OFF = 'enabled: false,';
  if (!ORIGINAL.recovery.includes(OFF)) {
    console.log('CANARY INVALID — the reconnect default is not the shape this expects.');
    process.exit(2);
  }
  fs.writeFileSync(RECOVERY, ORIGINAL.recovery.replace(OFF, 'enabled: true,'), 'utf8');
  const d2 = runGuard();
  restore();

  // ── direction 3: restored, the guard must PASS ────────────────────────────────────────────
  const d3 = runGuard();
  const hashAfter = { bridge: sha(BRIDGE), recovery: sha(RECOVERY) };

  const ok1 = d1.code !== 0 && d1.out.includes('no timeout=');
  const ok2 = d2.code !== 0 && /unattended reconnect defaults ON/.test(d2.out);
  const ok3 = d3.code === 0;
  const okHash = hashAfter.bridge === HASH.bridge && hashAfter.recovery === HASH.recovery;

  console.log(`direction 1 (timeout removed)   exit=${d1.code}  ${ok1 ? 'FAILED and NAMED the unbounded call' : 'WRONG — see output'}`);
  console.log(`direction 2 (reconnect re-armed) exit=${d2.code}  ${ok2 ? 'FAILED and NAMED the re-armed default' : 'WRONG — see output'}`);
  console.log(`direction 3 (restored)           exit=${d3.code}  ${ok3 ? 'passed as required' : 'STILL FAILING'}`);
  console.log(`restore byte-for-byte (2 files)  ${okHash ? 'verified' : 'MISMATCH — TREE IS MODIFIED'}`);

  const ok = ok1 && ok2 && ok3 && okHash;
  if (!ok) {
    console.log('\n--- direction 1 output ---\n' + d1.out.split('\n').slice(0, 6).join('\n'));
    console.log('\n--- direction 2 output ---\n' + d2.out.split('\n').slice(0, 6).join('\n'));
  }
  console.log(ok ? '\nCANARY VALID' : '\nCANARY FAILED');
  process.exit(ok ? 0 : 1);
} catch (err) {
  restore();
  console.error(`CANARY ERROR: ${err.message}`);
  process.exit(2);
}
