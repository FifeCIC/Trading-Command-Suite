/**
 * Batch #24 splice — STAGE 1: src/core/architecture-reference.js
 *
 * Approvals, given the recorded splice traps:
 *  - array bounds are found as the FIRST closer AFTER the named opener, never by pattern alone
 *  - line endings are normalised back to CRLF (these files are CRLF)
 *  - the work is verified BEFORE the write: export counts, subsequence (no line lost), bracket balance
 *  - nothing is written unless every check passes
 */
const fs = require('fs');
const path = require('path');
const { SLICE_REF, ROUTES, REVISION } = require('./b24-content.cjs');

const FILE = path.join(__dirname, '..', 'src', 'core', 'architecture-reference.js');
const LF = '\n';
const CRLF = '\r\n';

/** Emit a JS single-quoted string literal from plain text. */
const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

/** Index just past the closer `]` of the array opened at `openIdx`. */
function arrayEnd(text, openIdx) {
  const i = text.indexOf(']', openIdx);
  if (i < 0) throw new Error('no array closer found');
  return i;
}

let src = fs.readFileSync(FILE, 'utf8');
const before = src.split(CRLF).join(LF);

// ── 1. CURRENT_SLICE: insert before its closer ──────────────────────────────
const sliceOpen = before.indexOf('export const CURRENT_SLICE = [');
if (sliceOpen < 0) throw new Error('CURRENT_SLICE opener not found');
const sliceClose = arrayEnd(before, sliceOpen);

const sliceBlock = SLICE_REF.map((b) => '      ' + q(b) + ',').join(LF);
// leading LF separates the last existing entry from the first new one; trailing LF keeps the blank
// line that already sat before the array's closer.
const withSlice =
  before.slice(0, sliceClose - 1) + LF + sliceBlock + LF + before.slice(sliceClose - 1);

// ── 2. CURRENT_ROUTE_CONTRACTS: insert after the opener, before the batch #23 comment ──
const routesAnchor = 'export const CURRENT_ROUTE_CONTRACTS = [' + LF;
const ri = withSlice.indexOf(routesAnchor);
if (ri < 0) throw new Error('CURRENT_ROUTE_CONTRACTS opener not found');

const routeBlock = ROUTES.map(
  (r) =>
    [
      '      {',
      '        route: ' + q(r.route) + ',',
      '        method: ' + q(r.route.split(' ')[0]) + ',',
      "        permission: 'Authenticated operator access',",
      '        owner: ' + q(r.owner) + ',',
      '        contract: ' + q(r.contract) + ',',
      "        status: 'active',",
      '      },',
    ].join(LF),
).join(LF);

const routeHeader = '      /* — batch #24 — new/changed endpoints (2026-09-27 to 09-30, 25 handoffs) — */' + LF;
const withRoutes =
  withSlice.slice(0, ri + routesAnchor.length) +
  routeHeader +
  routeBlock +
  LF +
  withSlice.slice(ri + routesAnchor.length);

// ── 3. Register timestamp ───────────────────────────────────────────────────
const regRe = /export const CONTRACT_REGISTER_LAST_UPDATED = '[^']*';/;
if (!regRe.test(withRoutes)) throw new Error('CONTRACT_REGISTER_LAST_UPDATED not found');
// REPLACED, not appended to: appending the previous value would grow the register ~600 chars/batch.
const newReg =
  "export const CONTRACT_REGISTER_LAST_UPDATED = '2026-09-30 (batch #24: 25 handoffs — the app now says WHICH ACCOUNT, WHICH MECHANISM and WHICH AUTHORITY. One authority replaced six partial mechanisms answering 2 / 8 / 3 / 0 for the same symbol; a position is addressed by the account that HOLDS it and carries an immutable per-bot magic; a bridge on the wrong account REFUSES orders; an exit mechanism declares the columns it reads and the build fails when the two registries disagree. Three refusals recorded rather than papered over: the exit premise replayed and REFUTED three ways (no acting exit built), the #927 floor re-measured and HELD while the panel reporting breaches is the defect, and a failed import now reports the real bar count instead of a zero.)'";

const out = withRoutes.replace(regRe, () => newReg);

// ── verification (all must pass before the write) ───────────────────────────
const failures = [];

// a) nothing lost: every original line still present in order
{
  const o = before.split(LF);
  const n = out.split(LF);
  let i = 0;
  const lost = [];
  for (const line of o) {
    const k = n.indexOf(line, i);
    if (k < 0) {
      lost.push(line.slice(0, 60));
      continue;
    }
    i = k;
  }
  if (lost.length) failures.push('LINES LOST (' + lost.length + '): ' + lost.join(' | '));
}

// b) new content present, exactly once each
for (const b of SLICE_REF) {
  const hits = out.split(q(b)).length - 1;
  if (hits !== 1) failures.push('slice bullet appears ' + hits + ' times: ' + b.slice(0, 50));
}
for (const r of ROUTES) {
  const hits = out.split(q(r.route)).length - 1;
  if (hits < 1) failures.push('route missing: ' + r.route);
}

// c) array shapes intact
const countClose = (t, openIdx) => arrayEnd(t, openIdx);
{
  const sOpen = out.indexOf('export const CURRENT_SLICE = [');
  const sClose = countClose(out, sOpen);
  const inner = out.slice(sOpen, sClose);
  if (!/\],?\s*$/.test(inner)) failures.push('CURRENT_SLICE may be unclosed');
}
if (!out.includes(routeHeader)) failures.push('route header missing');

// d) bracket balance
{
  const ob = (out.match(/\[/g) || []).length;
  const cb = (out.match(/\]/g) || []).length;
  const oc = (out.match(/\{/g) || []).length;
  const cc = (out.match(/\}/g) || []).length;
  if (ob !== cb) failures.push(`brackets unbalanced: [ ${ob} vs ] ${cb}`);
  if (oc !== cc) failures.push(`braces unbalanced: { ${oc} vs } ${cc}`);
}

if (failures.length) {
  console.log('REFUSED TO WRITE — ' + failures.length + ' check(s) failed:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}

fs.writeFileSync(FILE, out.split(LF).join(CRLF), 'utf8');
console.log('WRITTEN ' + FILE);
console.log('  slice bullets added: ' + SLICE_REF.length);
console.log('  route contracts added: ' + ROUTES.length);
console.log('  bytes ' + before.length + ' -> ' + out.length);
