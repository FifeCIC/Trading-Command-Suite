/**
 * canary-1035-mapping.cjs — prove the #1035 spec can FAIL, then restore byte-for-byte.
 *
 * ⚠️ A guard that has never been observed to fail is a decoration. The spec passes; this proves it
 * passes because the mapping EXISTS, not because it never runs.
 *
 * Procedure: neutralise the two mapping lines in `getAllBrokerHealths()` → the spec MUST fail →
 * restore → the spec MUST pass → verify the file is byte-identical to what we started with.
 *
 * ⚠️ RESTORE IS IN A `finally`, so no exit path can leave the shared source file modified. The
 * SHA-256 is checked afterwards, because "I put it back" is a claim and a hash is evidence.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SERVICE = path.resolve(__dirname, '..', 'nest', 'src', 'modules', 'providers', 'mt5', 'mt5-connection-manager.service.ts');
const SPEC = 'src/modules/providers/mt5/mt5-broker-health-credential.spec.ts';
const NEST = path.resolve(__dirname, '..', 'nest');

const original = fs.readFileSync(SERVICE, 'utf8');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const originalHash = sha(original);

const runSpec = () => {
  const r = spawnSync('npx', ['jest', '--silent', SPEC], { cwd: NEST, encoding: 'utf8', shell: true });
  return r.status;
};

// The exact two lines that carry the fields from the bridge into the API's surface.
const TARGET = "          credentialMismatch: data?.credentialMismatch ?? null,\n          orderReady: data?.orderReady ?? null,";
const CRLF_TARGET = TARGET.replace(/\n/g, '\r\n');

let result = { before: null, after: null, restored: false, hashOk: false };

const beforeStatus = runSpec();
result.before = beforeStatus;
console.log(`[canary] spec WITH the mapping present → exit ${beforeStatus} (expected 0)`);
if (beforeStatus !== 0) {
  console.error('❌ CANARY INVALID: the spec does not pass to begin with — nothing to prove');
  process.exit(1);
}

try {
  const useCRLF = original.includes(CRLF_TARGET);
  const target = useCRLF ? CRLF_TARGET : TARGET;
  const nl = useCRLF ? '\r\n' : '\n';

  // Count first: if the anchor is missing or ambiguous, refuse rather than write a no-op edit and
  // then report a guard as broken that was actually never touched.
  const hits = original.split(target).length - 1;
  if (hits !== 1) {
    console.error(`❌ CANARY REFUSED: the mapping anchor appears ${hits}× (expected exactly 1) — cannot make the edit`);
    process.exit(1);
  }

  const neutered = original.replace(
    target,
    ['          // CANARY: deliberately removed to prove the spec can fail',
      '          // credentialMismatch: data?.credentialMismatch ?? null,',
      '          // orderReady: data?.orderReady ?? null,'].join(nl),
  );
  fs.writeFileSync(SERVICE, neutered, 'utf8');

  // ⚠️ Prove the EDIT landed before trusting the failure it produces.
  const written = fs.readFileSync(SERVICE, 'utf8');
  if (written === original || !written.includes('CANARY: deliberately removed')) {
    console.error('❌ CANARY INVALID: the edit did not land — refusing to interpret the next result');
    process.exit(1);
  }
  console.log('[canary] edit verified present in the file (not just "the command exited 0")');

  const broken = runSpec();
  result.after = broken;
  console.log(`[canary] spec WITHOUT the mapping → exit ${broken} (expected NON-zero)`);
  if (broken === 0) {
    console.error('❌ CANARY FAILED: the spec passed with the mapping removed — it does not test what it claims');
    process.exitCode = 1;
  }
} finally {
  fs.writeFileSync(SERVICE, original, 'utf8');
  const restored = fs.readFileSync(SERVICE, 'utf8');
  result.hashOk = sha(restored) === originalHash;
  result.restored = restored === original;
  console.log(`\n[canary] restored byte-for-byte: ${result.restored}  (sha256 ${sha(restored)} vs ${originalHash})`);
  if (!result.hashOk) {
    console.error('❌ CANARY INVALID: the source file was NOT restored — fix by hand before continuing');
    process.exitCode = 1;
  }
}

const finalStatus = runSpec();
console.log(`[canary] spec AFTER restore → exit ${finalStatus} (expected 0)`);
if (finalStatus !== 0) {
  console.error('❌ CANARY FAILED: the spec does not pass after restore');
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  console.log('\n✅ CANARY PASSED — the spec was observed to FAIL without the mapping, and to PASS with it.');
}
