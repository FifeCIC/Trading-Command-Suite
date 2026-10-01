/**
 * TEMPORARY triage — issues CREATED in the last N days, with the fields that decide whether each is
 * workable without a human decision. Deleted once it has served its purpose.
 *
 * ⚠️ Uses the search API with `created:>=DATE`, because `gh issue list` returns issues by UPDATED
 * date — which is why an earlier attempt surfaced #372 and #960 (old issues, recently touched) and
 * would have produced a wrong work list.
 */
const { execFileSync } = require('child_process');

const DAYS = Number(process.argv[2] || 5);
const SINCE = new Date(Date.now() - (DAYS - 1) * 86400000).toISOString().slice(0, 10);

const out = execFileSync('gh', [
  'issue', 'list', '--repo', 'FifeCIC/Trading-Command-Suite',
  '--state', 'open', '--limit', '400',
  '--search', `created:>=${SINCE}`,
  '--json', 'number,title,createdAt,labels,body',
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const issues = JSON.parse(out).sort((a, b) => a.number - b.number);

const labelNames = (i) => (i.labels || []).map((l) => l.name);

/** A maths change carries the repo's own A/B requirement. */
const MATHS = /maths change|A\/B (copy|test|comparison)|copied configuration|A\/B system/i;
/** Body explicitly says planning only / no code. */
const PLANNING_ONLY = /planning only|no code written|this is a design|discussion:/i;
/** Body asks the owner a question the agent cannot settle by measuring. */
const ASKS_OWNER = /owner (decision|call|direction|input|ruling)|needs? (an? )?(owner|human)|which .{0,30}should (we|you)|prefer\?|decide(d)? (which|whether|between)/i;

const rows = issues.map((i) => {
  const L = labelNames(i);
  const body = i.body || '';
  return {
    n: i.number,
    title: i.title,
    at: i.createdAt.slice(0, 10),
    labels: L,
    pro: L.includes('requires:pro'),
    maths: MATHS.test(body),
    planning: PLANNING_ONLY.test(body),
    asks: ASKS_OWNER.test(body),
    closedBy: /closes? #\d+/i.test(body),
    len: body.length,
  };
});

console.log(`=== ${rows.length} OPEN issues created since ${SINCE} (last ${DAYS} days) ===\n`);
console.log(`  startable now         : ${rows.filter((r) => !r.asks && !r.planning).length}`);
console.log(`  planning-only/design  : ${rows.filter((r) => r.planning).length}`);
console.log(`  may ask the owner     : ${rows.filter((r) => r.asks).length}`);
console.log(`  carrying the maths rule: ${rows.filter((r) => r.maths).length}`);
console.log('');

console.log('=== THE WORK LIST, oldest first ===\n');
for (const r of rows) {
  const f = [r.pro ? 'pro' : '', r.maths ? 'MATHS' : '', r.planning ? 'PLAN' : '', r.asks ? 'ASK' : '']
    .filter(Boolean).join(' ');
  console.log(`  #${String(r.n).padEnd(5)} ${r.at}  ${f.padEnd(12)} ${r.title.slice(0, 74)}`);
}

const ask = rows.filter((r) => r.asks);
if (ask.length) {
  console.log('\n=== ASK-flavoured — read before starting ===\n');
  ask.forEach((r) => console.log(`  #${r.n}  ${r.title.slice(0, 80)}`));
}

console.log('\n=== labels on this batch ===');
const hist = {};
for (const r of rows) for (const l of r.labels) hist[l] = (hist[l] || 0) + 1;
Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));
