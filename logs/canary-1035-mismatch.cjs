/**
 * TEMP — canary the #1035 mismatch-refusal tests in BOTH directions, then restore byte-for-byte.
 *
 * ⚠️ Targets are written WITHOUT trailing newlines: this repo checks out CRLF, so a target ending in
 * '\n' matches nothing. That exact mistake was made once already in the #1036 canary; the script
 * refused to report rather than claiming a false result, which is why it cost one run and not a
 * wrong conclusion.
 */
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const BRIDGE = 'scripts/mt5-bridge/mt5_bridge_v2.py';
const original = fs.readFileSync(BRIDGE, 'utf8');
const hashOf = (s) => crypto.createHash('sha256').update(s).digest('hex');
const originalHash = hashOf(original);
console.log(`bridge hash: ${originalHash}`);

function runTests() {
  try {
    execFileSync('python', ['scripts/mt5-bridge/test_credential_binding.py'], { stdio: 'pipe' });
    return { ok: true, out: '' };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const CANARIES = [
  {
    name: 'the refusal never fires (mismatch ignored)',
    from: '    if credential_mismatch is None:\n        return None',
    to: '    if True:\n        return None',
    expect: 'test_a_mismatch_produces_a_refusal',
  },
  {
    name: 'the refusal returns 200 instead of 409',
    from: '        409,',
    to: '        200,',
    expect: 'test_the_status_is_NOT_200_or_the_manager_overwrites_it',
  },
  {
    name: 'POST /reconnect stops consulting the refusal',
    from: '                    refusal = account_mismatch_refusal(state, detail)',
    to: '                    refusal = None',
    expect: 'test_both_connect_routes_consult_the_refusal',
  },
];

let failures = 0;
for (const c of CANARIES) {
  // The first canary's target is multi-line, so normalise the file and target to LF for the match,
  // then write back the ORIGINAL line endings by replacing on the original string.
  const lfOriginal = original.replace(/\r\n/g, '\n');
  const lfFrom = c.from.replace(/\r\n/g, '\n');
  const occurrences = lfOriginal.split(lfFrom).length - 1;
  if (occurrences !== 1) {
    console.error(`CANARY INVALID — target occurs ${occurrences}x (need exactly 1): ${c.name}`);
    failures++;
    continue;
  }
  const mutatedLf = lfOriginal.replace(lfFrom, c.to);
  // Preserve the file's CRLF convention rather than silently converting the whole file.
  const mutated = original.includes('\r\n') ? mutatedLf.replace(/\n/g, '\r\n') : mutatedLf;
  fs.writeFileSync(BRIDGE, mutated, 'utf8');
  if (fs.readFileSync(BRIDGE, 'utf8') === original) {
    console.error(`CANARY INVALID — the edit did not change the file: ${c.name}`);
    failures++;
  } else {
    const r = runTests();
    if (r.ok) {
      console.error(`✗ CANARY MISSED — tests still passed after: ${c.name}`);
      failures++;
    } else if (!r.out.includes(c.expect)) {
      console.error(`✗ CANARY MISSED — something failed, but not ${c.expect}: ${c.name}`);
      failures++;
    } else {
      console.log(`✓ CANARY FIRED — ${c.expect} failed as required after: ${c.name}`);
    }
  }
  fs.writeFileSync(BRIDGE, original, 'utf8');
  if (hashOf(fs.readFileSync(BRIDGE, 'utf8')) !== originalHash) {
    console.error('🛑 RESTORE FAILED — not byte-identical. Stopping.');
    process.exit(2);
  }
}

fs.writeFileSync(BRIDGE, original, 'utf8');
const restored = hashOf(fs.readFileSync(BRIDGE, 'utf8'));
const final = runTests();
console.log(`\nrestored byte-for-byte: ${restored === originalHash}`);
console.log(`tests green after restore: ${final.ok}`);
if (restored !== originalHash || !final.ok || failures) {
  console.error(`\n${failures} canary problem(s).`);
  process.exit(1);
}
console.log('\nAll canaries fired and the tree is clean.');
