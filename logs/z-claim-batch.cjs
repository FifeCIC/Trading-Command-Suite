/**
 * Claim the 20-issue batch as ONE agent, so no other agent collides with this work.
 *
 * ⚠️ The repo's own claim convention is a comment containing `🤖 Claimed by` — the documented
 * pre-work check is:
 *
 *   gh issue view N --json comments --jq '[.comments[].body] | any(contains("🤖 Claimed by"))'
 *
 * So the marker has to appear in the BODY of a comment on EACH issue. Claiming only once, on a
 * tracker issue, would not be visible to an agent checking a specific issue — which is the whole
 * point of the convention.
 *
 * The list is stated in every claim so a reader can see the batch and its boundary, not just one
 * issue and a promise.
 */
const { execFileSync } = require('child_process');

const BATCH = [
  995, 996, 998, 999, 1000, 1008, 1013, 1014, 1015, 1030,
  1033, 1035, 1036, 1037, 1038, 1041, 1042, 1043, 987, 976,
];

const AGENT = 'primary';
const STAMP = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const listText = BATCH.map((n) => `#${n}`).join(', ');

const bodyFor = (n) =>
  [
    `🤖 Claimed by **${AGENT}** — started work on ${STAMP}`,
    '',
    'This issue is part of a **20-issue batch** claimed together so no other agent collides with it.',
    'The full batch: ' + listText,
    '',
    '⚠️ **Please do not start work on any of these while the claim stands.** The claim is replaced by a',
    'pre-close checklist comment when the issue closes, per the repo convention — so a claim still',
    'present means the work is still in flight, not abandoned.',
    '',
    `Claimed in a single batch deliberately: claiming ${BATCH.length} issues one at a time leaves a window`,
    'where two agents read the same "unclaimed" result and both start. This issue is #' + n + '.',
  ].join('\n');

let claimed = 0;
let failed = [];

for (const n of BATCH) {
  try {
    // ⚠️ Idempotent on purpose: re-running must not stack duplicate claims, so an existing claim by
    // this agent is treated as already claimed rather than re-posted.
    const existing = execFileSync(
      'gh',
      ['issue', 'view', String(n), '--repo', 'FifeCIC/Trading-Command-Suite', '--json', 'comments'],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    const comments = JSON.parse(existing).comments || [];
    if (comments.some((c) => String(c.body || '').includes(`🤖 Claimed by **${AGENT}**`))) {
      console.log(`  = #${n} already claimed by ${AGENT}`);
      claimed++;
      continue;
    }
    if (comments.some((c) => String(c.body || '').includes('🤖 Claimed by'))) {
      console.log(`  ! #${n} ALREADY CLAIMED BY SOMEONE ELSE — leaving it alone`);
      failed.push(n);
      continue;
    }

    execFileSync(
      'gh',
      ['issue', 'comment', String(n), '--repo', 'FifeCIC/Trading-Command-Suite', '--body', bodyFor(n)],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    console.log(`  ✓ #${n} claimed`);
    claimed++;
  } catch (e) {
    console.log(`  ✗ #${n} FAILED: ${String(e.message).slice(0, 120)}`);
    failed.push(n);
  }
}

console.log(`\n=== ${claimed}/${BATCH.length} claimed; ${failed.length} not ===`);
if (failed.length) console.log('  not claimed: ' + failed.map((n) => '#' + n).join(', '));
