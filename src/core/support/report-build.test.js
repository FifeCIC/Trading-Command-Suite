/**
 * report-build.test.js — guards for the support report builder (#1248).
 *
 * ⚠️ WHY THIS EXISTS. Every failure mode here is SILENT and produces a report that
 * looks fine:
 *   1. an empty error list from a capture layer that never installed reads as
 *      "nothing went wrong" — the exact opposite of the truth;
 *   2. bodies leak in when the user never opted in;
 *   3. a body carries a credential and it goes into a public issue;
 *   4. a system snapshot that failed to collect renders as a healthy blank.
 * None of these throws. Each is asserted here in the direction that would fail.
 *
 * ⚠️ NOT COVERED, deliberately: `report-buffers.js`. It patches `window.fetch` and
 * `console.error`, so it needs a DOM and a live page; a node test would have to
 * fabricate the very thing it is meant to observe. Its behaviour was measured in the
 * browser instead, and both directions are recorded in the issue.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSupportReport, scrubSecrets } from './report-build.js';

const baseContext = { route: '/trading/x', appVersion: '0.158.0' };

test('an empty list from an ACTIVE capture says nothing happened', () => {
  const { markdown } = buildSupportReport({ context: baseContext, captureActive: true });
  assert.match(markdown, /None recorded since page load/);
  assert.doesNotMatch(markdown, /cannot judge/);
});

test('an empty list from an INACTIVE capture says cannot judge, never "none"', () => {
  const { markdown } = buildSupportReport({ context: baseContext, captureActive: false });
  assert.match(markdown, /cannot judge/);
  assert.doesNotMatch(markdown, /None recorded since page load/);
});

test('response bodies are excluded unless the user opted in', () => {
  const requests = [{ at: 't', method: 'GET', path: '/api/portfolio', status: 500, ms: 12, body: '{"balance":1}' }];
  const excluded = buildSupportReport({ context: baseContext, requests, includeBodies: false });
  assert.doesNotMatch(excluded.markdown, /"balance":1/);
  assert.equal(excluded.json.requests[0].body, undefined);
  assert.match(excluded.markdown, /Response bodies were not included/);

  const included = buildSupportReport({ context: baseContext, requests, includeBodies: true });
  assert.match(included.markdown, /"balance": 1/);
  assert.equal(included.json.requests[0].body.includes('balance'), true);
});

test('a secret-shaped key is redacted AND named in the report', () => {
  const requests = [{
    at: 't', method: 'POST', path: '/api/settings', status: 400, ms: 8,
    body: '{"brokerPassword":"hunter2","apiKey":"abc123","balance":48213.55}',
  }];
  const { markdown, json } = buildSupportReport({ context: baseContext, requests, includeBodies: true });
  assert.doesNotMatch(markdown, /hunter2/);
  assert.doesNotMatch(markdown, /abc123/);
  assert.match(markdown, /48213\.55/, 'the number we actually need must survive');
  assert.match(markdown, /Redacted before sending/);
  assert.deepEqual(json.redactedKeys.sort(), ['apiKey', 'brokerPassword']);
});

test('scrubSecrets walks nested structures and arrays', () => {
  const redactedKeys = [];
  const out = scrubSecrets({ a: [{ token: 'x', ok: 1 }] }, redactedKeys);
  assert.equal(out.a[0].token, '[redacted]');
  assert.equal(out.a[0].ok, 1);
  assert.deepEqual(redactedKeys, ['token']);
});

test('a body that is not JSON is kept verbatim, not silently dropped', () => {
  const requests = [{ at: 't', method: 'GET', path: '/api/x', status: 500, ms: 3, body: 'Internal Server Error' }];
  const { markdown } = buildSupportReport({ context: baseContext, requests, includeBodies: true });
  assert.match(markdown, /Internal Server Error/);
});

test('a failed system snapshot says so instead of rendering blank', () => {
  const { markdown } = buildSupportReport({ context: baseContext, system: { error: 'timeout after 5s' } });
  assert.match(markdown, /Could not collect: timeout after 5s/);
});

test('the report always carries the route and version', () => {
  const { markdown } = buildSupportReport({ context: { route: '/a/b', appVersion: '9.9.9' } });
  assert.match(markdown, /\/a\/b/);
  assert.match(markdown, /9\.9\.9/);
});
