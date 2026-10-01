/**
 * Claim/OVERRIDE the last four issues as `primary`, per the owner's direction.
 *
 * ⚠️ #1000, #1014 and #1033 carry ANOTHER AGENT'S CLAIM. `decision-authority.instructions.md` is
 * explicit that an override is NOT a deletion — the primary must record WHAT it replaced, because
 * the other agent's reasoning was probably locally correct and losing it is how the same ground
 * gets re-covered. So the comment names the override, the authority for it, and tells the other
 * agent to stand down rather than leaving them building on a file the primary is about to change.
 */
const { execFileSync } = require('child_process');

const OVERRIDE = [1000, 1014, 1033];
const RETRY = [987];

const AGENT = 'primary';
const STAMP = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const BATCH = [
  995, 996, 998, 999, 1000, 1008, 1013, 1014, 1015, 1030,
  1033, 1035, 1036, 1037, 1038, 1041, 1042, 1043, 987, 976,
];

const bodyFor = (n, overriding) => {
  const lines = [
    `🤖 Claimed by **${AGENT}** — started work on ${STAMP}`,
    '',
  ];
  if (overriding) {
    lines.push(
      '### ⚠️ OVERRIDE — this issue carried another agent\'s claim',
      '',
      '**Authority:** the project owner, 2026-10-01: *"You are the primary agent - you can claim any',
      'issue and over-ride all other agents."* `primary` is the arbiter and may take any issue.',
      '',
      '**What this replaces:** an earlier `🤖 Claimed by` comment from another agent. That claim is',
      '**superseded, not disputed** — this is a scheduling decision, not a judgement that their',
      'approach was wrong. Their reasoning is preserved in the issue comments and in the code, and',
      'it will be read before anything is changed.',
      '',
      '**Stand down, please.** Do not continue work on this issue while this claim stands — the',
      'primary is editing the same files, and two agents on one file is how a verified change',
      'becomes an unverified one. **Reply here if you have work in flight** (uncommitted edits, a',
      'branch, or a partial fix) so it can be folded in rather than raced. That is the one thing',
      'an override must not do: discard work it did not know about.',
      '',
    );
  }
  lines.push(
    `This issue is part of a **20-issue batch** claimed together so no other agent collides with it.`,
    'The full batch: ' + BATCH.map((x) => `#${x}`).join(', '),
    '',
    'The claim is replaced by a pre-close checklist comment when the issue closes, per the repo',
    'convention — so a claim still present means the work is still in flight, not abandoned.',
    '',
    `Claimed in a single batch deliberately: claiming 20 issues one at a time leaves a window where`,
    `two agents read the same "unclaimed" result and both start. This issue is #${n}.`,
  );
  return lines.join('\n');
};

async function claim(n, overriding) {
  const existing = execFileSync(
    'gh', ['issue', 'view', String(n), '--repo', 'FifeCIC/Trading-Command-Suite', '--json', 'comments'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  const comments = JSON.parse(existing).comments || [];
  if (comments.some((c) => String(c.body || '').includes(`🤖 Claimed by **${AGENT}**`))) {
    console.log(`  = #${n} already claimed by ${AGENT}`);
    return true;
  }
  execFileSync(
    'gh', ['issue', 'comment', String(n), '--repo', 'FifeCIC/Trading-Command-Suite', '--body', bodyFor(n, overriding)],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  console.log(`  ✓ #${n} claimed${overriding ? ' (OVERRIDE)' : ''}`);
  return true;
}

(async () => {
  let ok = 0;
  const failed = [];
  for (const n of OVERRIDE) {
    try { if (await claim(n, true)) ok++; } catch (e) { console.log(`  ✗ #${n}: ${String(e.message).slice(0, 100)}`); failed.push(n); }
  }
  for (const n of RETRY) {
    try { if (await claim(n, false)) ok++; } catch (e) { console.log(`  ✗ #${n}: ${String(e.message).slice(0, 100)}`); failed.push(n); }
  }
  console.log(`\n=== ${ok}/4 claimed ===`);
  if (failed.length) console.log('  failed: ' + failed.map((n) => '#' + n).join(', '));
})();
