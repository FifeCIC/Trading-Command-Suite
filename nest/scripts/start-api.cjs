#!/usr/bin/env node
/**
 * start-api.cjs — start the API, or refuse with the RIGHT instruction. Never destroys dist/ (#968).
 * =================================================================================================
 *
 * THE DEFECT THIS REPLACES
 * ------------------------
 * `"start": "nest start"` could never work here, and failed destructively:
 *
 *   1. `nest start` looks for `nest/dist/main.js`.
 *   2. `tsconfig.build.json` emits to `nest/dist/src/main.js` — one directory deeper.
 *   3. So the entry point is never found.
 *   4. ⚠️ In failing, the CLI DELETED `dist/` entirely. Measured 2026-09-23: `Test-Path nest/dist`
 *      returned False immediately after. A repo built and running a minute earlier had no build
 *      output at all.
 *
 * The error it printed was `Cannot find module '...\dist\main'` — which reads as a broken install.
 * The obvious next instinct is to reinstall `node_modules` or run `prisma db push`, and **`db push`
 * is destructive here** (#769). The wording actively invited the damaging response.
 *
 * WHAT THIS DOES INSTEAD
 * ----------------------
 *   • Starts the REAL entry point (`dist/src/main.js`) when it exists.
 *   • REFUSES, naming `npm run build:api`, when it does not — instead of a MODULE_NOT_FOUND that
 *     misdirects. Same shape as `build-preflight.cjs`, which already refuses to build when the API
 *     holds the query-engine DLL rather than emitting an EPERM that reads like a corrupt install.
 *   • Touches nothing on disk. No delete, ever.
 *
 * Usage (from nest/):  node scripts/start-api.cjs [--self-test]
 * Exit: the child's exit code, or 1 when it refuses.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const NEST_ROOT = path.resolve(__dirname, '..');
/** ⚠️ `dist/src/main.js`, NOT `dist/main.js`. The `src` segment is the whole bug. */
const ENTRY = path.join(NEST_ROOT, 'dist', 'src', 'main.js');

/**
 * preflight(entryExists) — PURE, so both directions are testable without touching a real build.
 *
 * @returns {{ ok: boolean, message?: string }}
 *
 * The refusal must NAME THE FIX. A failure that reports the mechanism instead of the remedy is how
 * `nest start` sent an agent toward reinstalling node_modules and toward `db push`.
 */
function preflight(entryExists) {
  if (entryExists) return { ok: true };
  return {
    ok: false,
    message:
      `No build to start: ${path.relative(NEST_ROOT, ENTRY)} does not exist.\n\n` +
      '  Build and start it with:\n' +
      '    npm --prefix nest run build:api\n\n' +
      '  ⚠️ Do NOT run `npm run start` expecting it to build — it never did. This script starts an\n' +
      '     EXISTING build, and nothing here deletes anything.\n' +
      '  ⚠️ Do NOT reinstall node_modules, and do NOT run `prisma db push` — that is destructive in\n' +
      '     this repo (#769) and neither is the problem.\n',
  };
}

function selfTest() {
  const bad = [];

  // Direction 1 — a MISSING build must refuse, and the message must name the fix.
  const missing = preflight(false);
  if (missing.ok) bad.push('1 a missing build must NOT start');
  if (!/build:api/.test(missing.message || '')) {
    bad.push('2 the refusal must NAME `build:api` — a failure that reports the mechanism instead of\n' +
              '      the remedy is the original defect (`MODULE_NOT_FOUND` sent readers to node_modules)');
  }
  // Direction 3 — and it must warn off the two damaging instincts explicitly.
  if (!/db push/.test(missing.message || '')) bad.push('3 the refusal must warn against `db push`');
  // Direction 4 — an EXISTING build must start, or the guard is just "everything refuses".
  if (!preflight(true).ok) bad.push('4 an existing build must be allowed to start');

  if (bad.length) {
    console.error(`\n❌ self-test: ${bad.length} case(s) FAILED:`);
    for (const b of bad) console.error(`   ${b}`);
    return 1;
  }
  console.log('✅ self-test: 4 cases — a missing build REFUSES and the message names `build:api` and warns');
  console.log('   against `db push`; an existing build is allowed to start.');
  return 0;
}

function main() {
  if (process.argv.slice(2).includes('--self-test')) process.exit(selfTest());

  const check = preflight(fs.existsSync(ENTRY));
  if (!check.ok) {
    console.error(`\n❌ ${check.message}`);
    process.exit(1);
  }

  // ⚠️ `stdio: 'inherit'` so the API's logs go straight to the caller's terminal, and the exit code
  // is forwarded. This replaces the process rather than detaching it: `build:api` is the path that
  // starts it in the background, and this one is for a foreground start.
  const child = spawn(process.execPath, [ENTRY], { stdio: 'inherit', cwd: NEST_ROOT });
  child.on('exit', (code) => process.exit(code ?? 0));

  // ⚠️ FORWARD SIGNALS, OR KILLING THE WRAPPER ORPHANS THE API.
  //
  // A terminal Ctrl-C reaches both processes (they share the terminal), so that case was always
  // fine. But `Stop-Process` on THIS script leaves the child serving — observed during the #968
  // verification, where the spawned API outlived its wrapper and kept port 3201. An orphaned API is
  // not broken (it is the API), but it is untidy and it makes "who started this?" unanswerable.
  //
  // So the wrapper relays the signals it CAN see, and exits with the child's code.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      if (!child.killed) child.kill(sig);
    });
  }
  // If the child dies on its own, do not linger waiting for a signal that will never come.
  child.on('close', (code) => process.exit(code ?? 0));
}

main();
