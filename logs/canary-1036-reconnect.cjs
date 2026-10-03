/**
 * TEMP — canary the #1036 reconnect-outcome tests in BOTH directions, then restore byte-for-byte.
 *
 * The rule this serves: "a guard that has never been observed to fail is a decoration." The mutation
 * must also be PROVEN to have landed — a canary that silently misses its target and reports a
 * working guard as broken is worse than no canary.
 */
const fs = require('fs');
const { execFileSync } = require('child_process');

const BRIDGE = 'scripts/mt5-bridge/mt5_bridge_v2.py';
const original = fs.readFileSync(BRIDGE, 'utf8');
const hashOf = (s) => require('crypto').createHash('sha256').update(s).digest('hex');
const originalHash = hashOf(original);
console.log(`bridge hash: ${originalHash}`);

function runTests() {
  try {
    execFileSync('python', ['scripts/mt5-bridge/test_connection_watchdog.py'], { stdio: 'pipe' });
    return { ok: true, out: '' };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const CANARIES = [
  {
    // Line-ending agnostic on purpose: this repo checks files out as CRLF, so a target ending in
    // '\n' never matches. The first version of this script did exactly that and matched NOTHING —
    // and reported CANARY INVALID rather than a false MISSED, which is why the mistake cost one
    // run instead of a wrong conclusion.
    name: 'the FAILURE path stops setting sessionLeftDown',
    from: "_RECONNECT_STATE['sessionLeftDown'] = True",
    to: "_RECONNECT_STATE['sessionLeftDown'] = False",
    expect: 'test_failed_reconnect_records_that_the_session_was_left_down',
  },
  {
    name: 'the SUCCESS path stops CLEARING sessionLeftDown',
    from: "_RECONNECT_STATE['sessionLeftDown'] = False",
    to: "_RECONNECT_STATE['sessionLeftDown'] = True",
    expect: 'test_successful_reconnect_clears_session_left_down',
  },
];

/** How many times a target occurs — an ambiguous target is a broken canary, not a passing one. */
function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

let failures = 0;
for (const c of CANARIES) {
  // The FIRST canary's `from` is the `= True` form and the SECOND's is `= False`. Counting against
  // the ORIGINAL source means the first replacement cannot make the second look ambiguous.
  const occurrences = countOccurrences(original, c.from);
  if (occurrences !== 1) {
    console.error(`CANARY INVALID — target occurs ${occurrences}x (need exactly 1), refusing to report a result:\n  ${c.from}`);
    failures++;
    continue;
  }
  fs.writeFileSync(BRIDGE, original.replace(c.from, c.to), 'utf8');
  const mutated = fs.readFileSync(BRIDGE, 'utf8');
  if (mutated === original) {
    console.error(`CANARY INVALID — the edit did not change the file: ${c.name}`);
    failures++;
  } else {
    const r = runTests();
    const named = r.out.includes(c.expect);
    if (r.ok) {
      console.error(`✗ CANARY MISSED — tests still passed after: ${c.name}`);
      failures++;
    } else if (!named) {
      console.error(`✗ CANARY MISSED — something failed, but not ${c.expect}: ${c.name}`);
      failures++;
    } else {
      console.log(`✓ CANARY FIRED — ${c.expect} failed as required after: ${c.name}`);
    }
  }
  // Restore and verify THIS restore before moving on.
  fs.writeFileSync(BRIDGE, original, 'utf8');
  if (hashOf(fs.readFileSync(BRIDGE, 'utf8')) !== originalHash) {
    console.error('🛑 RESTORE FAILED — the bridge is NOT byte-identical. Stopping.');
    process.exit(2);
  }
}

// Final restore check + green run.
fs.writeFileSync(BRIDGE, original, 'utf8');
const restored = hashOf(fs.readFileSync(BRIDGE, 'utf8'));
const final = runTests();
console.log(`\nrestored byte-for-byte: ${restored === originalHash}`);
console.log(`tests green after restore: ${final.ok}`);
if (restored !== originalHash || !final.ok || failures) {
  console.error(`\n${failures} canary problem(s) — see above.`);
  process.exit(1);
}
console.log('\nAll canaries fired and the tree is clean.');
