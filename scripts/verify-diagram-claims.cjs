#!/usr/bin/env node
/**
 * verify-diagram-claims.cjs — run the DiagramsPage claim assertions from the terminal.
 *
 * Same registry as the page (`src/core/diagram-claims.js`), same evaluator — this is the
 * CLI face of the prototype so the checks are usable by an agent or a script, not only by
 * someone looking at the page.
 *
 * ⚠️  EXIT CODES ARE DELIBERATELY THREE-VALUED:
 *       0  every registered claim passed
 *       1  at least one claim CONFLICTS with the running system
 *       2  CANNOT VERIFY — the API is unreachable, so nothing was checked
 *
 *     Exit 2 exists because a verifier that cannot read its input must ERROR, never pass.
 *     An empty result set is information; a failure is a third thing; they must never
 *     render the same.
 *
 * 🛑 NOT WIRED INTO `prebuild`, ON PURPOSE.
 *     It needs the live API. A build gate that fails when the API happens to be down is an
 *     INTERMITTENT guard — it produces false positives, gets allowlisted, and an allowlisted
 *     guard is worse than none because it consumes attention and covers nothing. Run it on
 *     demand, or from a workflow that has started the stack first.
 *
 * Usage:
 *   node scripts/verify-diagram-claims.cjs              # all diagrams with claims
 *   node scripts/verify-diagram-claims.cjs signal-state-machine
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const API = process.env.TCS_API || 'http://localhost:3201';
const PAGE = path.join(ROOT, 'src', 'pages', 'DiagramsPage.jsx');

async function getJson(apiPath) {
  const res = await fetch(`${API}${apiPath}`, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} from ${apiPath}`);
    err.__http = res.status;
    throw err;
  }
  return JSON.parse(text);
}

/**
 * Pull each diagram's mermaid source out of the JSX.
 * Matches  id: '<id>'  ...  code: `...`  and is tolerant of the fields between them.
 * Returns a map id -> source (null when the shape is not recognised, which the report
 * surfaces rather than hiding).
 */
function readDiagramSources() {
  const text = fs.readFileSync(PAGE, 'utf8');
  const out = {};
  const idRe = /id:\s*'([^']+)'/g;
  let m;
  while ((m = idRe.exec(text)) !== null) {
    const id = m[1];
    const tail = text.slice(m.index, m.index + 60000);
    const codeMatch = tail.match(/code:\s*`([\s\S]*?)`/);
    if (codeMatch) out[id] = codeMatch[1];
  }
  return out;
}

(async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'src', 'core', 'diagram-claims.js')).href);
  const { DIAGRAM_CLAIMS, evaluateClaims, summarise } = mod;

  const only = process.argv[2];
  const ids = Object.keys(DIAGRAM_CLAIMS).filter((id) => !only || id === only);
  if (!ids.length) {
    console.log(`[diagram-claims] no claims registered for "${only}"`);
    process.exit(0);
  }

  // Probe reachability FIRST, so an unreachable API is a clear CANNOT VERIFY (2) and never
  // gets misreported as a conflict (1).
  try {
    await getJson('/api/health');
  } catch (e) {
    console.log(`[diagram-claims] CANNOT VERIFY — the API at ${API} did not answer (${e.message}).`);
    console.log('[diagram-claims] Nothing was checked. This is NOT a pass.');
    process.exit(2);
  }

  const sources = readDiagramSources();
  let conflicts = 0;
  let checked = 0;
  let passed = 0;

  for (const id of ids) {
    const source = sources[id];
    if (!source) {
      console.log(`\n### ${id}`);
      console.log('  ⚠️  could not read this diagram\'s mermaid source — claims NOT checked (this is not a pass)');
      conflicts++;
      continue;
    }

    const results = await evaluateClaims(id, source, getJson);
    const s = summarise(results);
    checked += s.checked;
    passed += s.passed;
    conflicts += s.failed;

    console.log(`\n### ${id}   — ${s.passed}/${s.checked} claim(s) verified, ${s.failed} conflict(s)`);
    for (const r of results) {
      const mark = r.ok === true ? '✅' : r.ok === false ? '🛑' : '·';
      console.log(`  ${mark} [${r.node}] ${r.says}`);
      console.log(`       diagram says: ${JSON.stringify(r.expect)}`);
      if (r.ok === false) {
        console.log(`       live value:   ${JSON.stringify(r.actual)}   ${r.error ? `— ${r.error}` : ''}`);
      } else if (r.ok === null) {
        console.log(`       not verified: ${r.error || 'no probe'}`);
      }
    }
  }

  console.log('\n' + '─'.repeat(72));
  console.log(`[diagram-claims] ${passed}/${checked} registered claim(s) agree with the running system; ${conflicts} conflict(s).`);
  if (conflicts) {
    console.log('[diagram-claims] A conflict means the DIAGRAM is wrong (or the code changed deliberately).');
    console.log('                Fix the diagram, or fix the code — do NOT relax `expect`, which turns');
    console.log('                the probe into a rubber stamp.');
  }
  console.log('');
  process.exit(conflicts ? 1 : 0);
})().catch((e) => {
  console.error(`[diagram-claims] runner error: ${e.message}`);
  process.exit(2);
});
