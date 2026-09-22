#!/usr/bin/env node
/**
 * audit-outcome-recording.cjs — the filtered-rate check for #825.
 * ================================================================
 *
 * ⚠️ WHY THIS EXISTS. `directiveoutcome` was, before #825, a SAMPLE rather than a record:
 * a 5-minute dedup window against a ~2-minute scoring cadence dropped ~3 of every 4 passes,
 * silently — at DEBUG, with merged counters, returning 0 which is indistinguishable from a
 * quiet market. Every accuracy figure computed from that table inherited the empty denominator,
 * and NOTHING failed.
 *
 * The recorder now dedups by IDENTITY (strategyId::directiveId::symbol::predictedAt), so
 * duplicate-identity drops should trend to ~0 — a drop means the recorder saw a REPLAY of the
 * same pass. This check asserts that shape against the LIVE process and fails loudly when it
 * stops holding.
 *
 * ONE question, asked of the LIVE API:
 *
 *     GET /api/scoring/accuracy  →  .recording.identityDropRatePct ≤ threshold?
 *
 * Usage:
 *   node nest/scripts/audit-outcome-recording.cjs                 # default ≤10%, localhost:3201
 *   node nest/scripts/audit-outcome-recording.cjs --max-drop-rate=5 --url=http://host/api/...
 *
 * Exit codes: 0 = healthy · 1 = FAILED (or unreadable — a check that cannot read its input
 * must ERROR, never pass).
 */
'use strict';

const http = require('http');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`unparseable response: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};

(async () => {
  const maxRate = Number(arg('max-drop-rate', '10'));
  const url = arg('url', 'http://localhost:3201/api/scoring/accuracy?days=1');

  const res = await fetchJson(url);
  const r = res && res.recording;
  if (!r) {
    console.error('❌ FAIL — the accuracy payload carries no `recording` block.');
    console.error('   The recorder has no visible stats, which is the defect this check exists for (#825).');
    process.exit(1);
  }

  console.log('audit-outcome-recording (#825)\n');
  console.log(`  recorded                    : ${r.recorded}`);
  console.log(`  duplicate identity skipped  : ${r.duplicateIdentitySkipped}`);
  console.log(`  zero-score skipped (benign) : ${r.zeroScoreSkipped}`);
  console.log(`  identity drop rate          : ${r.identityDropRatePct}%  (threshold ${maxRate}%)`);
  console.log(`  identity memory size        : ${r.identityMemorySize}`);

  if (r.recorded === 0 && r.duplicateIdentitySkipped === 0) {
    console.error('\n❌ FAIL — nothing recorded AND nothing skipped since this API start.');
    console.error('   Two readings, both worth a look: the recorder has not run since a restart, or the');
    console.error('   scoring pipeline is silent. A recorder that never runs must not pass an audit.');
    process.exit(1);
  }

  if (r.identityDropRatePct > maxRate) {
    console.error(`\n❌ FAIL — identity drop rate ${r.identityDropRatePct}% exceeds ${maxRate}%.`);
    console.error('   Replays are outnumbering real observations — the sample is being thinned again.');
    process.exit(1);
  }

  console.log(`\n✅ OK — identity drop rate ${r.identityDropRatePct}% ≤ ${maxRate}%; sample is a record, not a sample.`);
})().catch((err) => {
  console.error(`\n❌ FAIL — cannot read the recording stats: ${err.message}`);
  console.error('   A check that cannot read its input must ERROR, never pass.');
  process.exit(1);
});
