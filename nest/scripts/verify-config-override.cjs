#!/usr/bin/env node
// verify-config-override.cjs — one-off check that a protocol directive maxScore
// override flows into BOTH the scoring engine and the registry (issue #609/#637).
const BASE = 'http://localhost:3201';

async function j(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

(async () => {
  // 1. Set a large override.
  await j('PATCH', '/api/scoring/protocols/xau-speed-v1/directive-config', {
    directiveId: 'speed-momentum', config: { maxScore: 500 },
  });

  // 2. Score path — check the directive's maxScore in the breakout.
  const score = await j('GET', '/api/scoring/gated/XAUUSD?protocol=xau-speed-v1');
  const smBreakout = (score.breakouts?.technical ?? []).find(b => b.directiveId === 'speed-momentum');
  console.log('scoring: speed-momentum maxScore =', smBreakout?.maxScore, smBreakout?.maxScore === 500 ? 'PASS' : 'FAIL');

  // 3. Registry path — check the protocol total + directive maxScore.
  const reg = await j('GET', '/api/scoring/gated/protocols');
  const proto = reg.protocols?.find(p => p.id === 'xau-speed-v1');
  const smDir = proto?.groups?.flatMap(g => g.directives).find(d => d.id === 'speed-momentum');
  console.log('registry: speed-momentum maxScore =', smDir?.maxScore, smDir?.maxScore === 500 ? 'PASS' : 'FAIL');
  console.log('registry: xau-speed-v1 total maxScore =', proto?.maxScore);

  // 4. Reset.
  await j('DELETE', '/api/scoring/protocols/xau-speed-v1/directive-config/speed-momentum');
  const regAfter = await j('GET', '/api/scoring/gated/protocols');
  const protoAfter = regAfter.protocols?.find(p => p.id === 'xau-speed-v1');
  const smAfter = protoAfter?.groups?.flatMap(g => g.directives).find(d => d.id === 'speed-momentum');
  console.log('after reset: speed-momentum maxScore =', smAfter?.maxScore, smAfter?.maxScore === 120 ? 'PASS' : 'FAIL');
})();
