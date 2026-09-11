#!/usr/bin/env node
/**
 * Build preflight — refuse to start `prisma generate` while the API holds its engine DLL.
 * =====================================================================================
 *
 * THE PROBLEM
 * -----------
 * `nest run build` starts with `prebuild`, which runs `prisma generate`. That step
 * REPLACES `node_modules/.prisma/client/query_engine-windows.dll.node` by writing a
 * temp file and RENAMING it over the old one.
 *
 * On Windows a loaded DLL cannot be renamed over. The API (`nest/dist/src/main.js`)
 * loads the query engine at startup and holds it open for its whole lifetime. So if
 * the API is running, `prisma generate` fails with:
 *
 *   EPERM: operation not permitted, rename
 *     '...query_engine-windows.dll.node.tmp30880' ->
 *     '...query_engine-windows.dll.node'
 *
 * That message names a temp file and an internal Prisma path. Nothing in it says
 * "your API is running". It reads like a corrupted install, a permissions problem, or
 * a broken project — so the natural response is to re-run the build, delete
 * node_modules, or investigate Prisma. All of which waste time, and none of which fix it.
 *
 * This has cost multiple sessions (the 2026-09-11 session hit it three times in one
 * afternoon and only diagnosed it by enumerating process command lines). It is also
 * the single most common reason a healthy repo "looks messy" to a new contributor:
 * the build fails, so the project appears broken, when in fact the build is fine and
 * one long-running process needs stopping.
 *
 * WHAT THIS DOES
 * --------------
 * Runs as the FIRST step of `prebuild` and checks whether the Prisma query engine DLL is
 * currently held open by a running process. If it is, it:
 *
 *   1. Names the PIDs and their command lines (so it is obvious it is YOUR API)
 *   2. Says exactly what to run (`npm run build:api` — stop, build, restart)
 *   3. Exits 1 WITHOUT calling prisma generate, so there is no confusing EPERM
 *
 * WHY DETECT THE LOCK RATHER THAN JUST KILL THE PROCESS
 * ---------------------------------------------------
 * Killing the API automatically would be convenient and wrong: it would silently stop a
 * trading system that may hold open positions, in the middle of a build that might then
 * fail for an unrelated reason. Stopping the API is a decision the operator makes, not a
 * side effect of type-checking. This guard only makes the decision visible.
 *
 * WHY NOT JUST ALWAYS REBUILD WITHOUT prisma generate
 * --------------------------------------------------
 * `prisma generate` must run for a schema change to reach the client types. Skipping it
 * unconditionally would reintroduce exactly the silent-stale-client class of bug this
 * repo already has a check for (`check-prisma-client-fresh.cjs`).
 *
 * EXIT CODES
 *   0  DLL not locked — safe to run `prisma generate`
 *   1  DLL locked by a running process — stop it first (message explains how)
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DLL = path.join(__dirname, '..', 'node_modules', '.prisma', 'client', 'query_engine-windows.dll.node');

/**
 * Is the DLL currently open by some process?
 *
 * ⚠️ MEASURED, NOT ASSUMED. The first version of this probe tried `fs.renameSync`,
 * reasoning that prisma generate renames a temp file over the engine. On Windows that
 * is WRONG: renaming a file that is mapped into a running process SUCCEEDS. The probe
 * therefore reported "free" while the API held the engine — a false negative that made
 * the guard useless, and worse than no guard because it looked like it had checked.
 *
 * What actually fails while the DLL is loaded (verified 2026-09-11 against a running
 * API on port 3201):
 *
 *   fs.renameSync(dll, dll + '.t')   -> SUCCEEDS   (does NOT detect)
 *   fs.openSync(dll, 'r+')           -> EBUSY      <-- what we use
 *   fs.unlinkSync(dll)               -> EBUSY      (also detects, but destructive)
 *
 * `r+` is the right probe: it is exactly the access prisma generate needs in order to
 * replace the engine, it detects the real condition, and it leaves the file untouched.
 */
function isLocked() {
  if (!fs.existsSync(DLL)) return { locked: false, missing: true };
  try {
    const fd = fs.openSync(DLL, 'r+');
    fs.closeSync(fd);
    return { locked: false };
  } catch (err) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) {
      return { locked: true, code: err.code };
    }
    // Some other failure (missing dir, odd permissions) — let prisma report it.
    return { locked: false, other: err.code };
  }
}

/**
 * Which processes are node processes running this repo? Advisory only — used purely to
 * make the failure message actionable. Never used to decide the verdict (that is the
 * `r+` probe, which measures the real condition).
 *
 * ⚠️ Listing processes is inherently racy: `npm run` spawns a wrapper that exits as soon
 * as it hands off, so a wrapper can appear here and be gone a millisecond later. The
 * first version of this listed whatever matched the repo path, which in practice meant
 * the preflight's OWN npm wrapper rather than the API — technically true, useless to
 * read. The API is identified by its stable signature (`dist/src/main.js` or a `nest
 * start`), and anything else that merely shares the repo path is labelled as context.
 */
function describeHolders() {
  if (process.platform !== 'win32') return [];
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
          'Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8', timeout: 15000, windowsHide: true },
    ).trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    const rows = Array.isArray(parsed) ? parsed : [parsed];

    // The API's stable signature. `npm` may wrap it, but this is the process that
    // actually maps the engine into memory.
    const API_RE = /dist[\\/]src[\\/]main\.js|nest\s+start/i;

    return rows
      .filter((r) => r && typeof r.CommandLine === 'string')
      .filter((r) => API_RE.test(r.CommandLine))
      // Exclude our own tree, in case `nest start` is how this build was invoked.
      .filter((r) => r.ProcessId !== process.pid && r.ProcessId !== process.ppid)
      .map((r) => ({
        pid: r.ProcessId,
        label: 'NestJS API  ← this is what holds the engine DLL',
        cmd: r.CommandLine.length > 150 ? r.CommandLine.slice(0, 150) + '…' : r.CommandLine,
      }));
  } catch {
    return [];
  }
}

function main() {
  const { locked, missing, code } = isLocked();

  if (missing) {
    // No client generated yet — prisma generate will create it. Fine.
    console.log('[build-preflight] Prisma client not generated yet — generate will create it.');
    process.exit(0);
  }

  if (!locked) {
    console.log('[build-preflight] ✅ Prisma engine DLL is free — safe to build.');
    process.exit(0);
  }

  const holders = describeHolders();

  console.error('');
  console.error('  ┌─────────────────────────────────────────────────────────────────────────┐');
  console.error('  │  BUILD BLOCKED — the NestJS API is holding the Prisma query engine DLL   │');
  console.error('  └─────────────────────────────────────────────────────────────────────────┘');
  console.error('');
  console.error(`  The engine file is locked (${code}):`);
  console.error(`    ${path.relative(path.join(__dirname, '..'), DLL)}`);
  console.error('');
  console.error('  `prisma generate` needs WRITE access to this file to install the new engine.');
  console.error('  While the API has it loaded, that write fails with EBUSY and prisma surfaces');
  console.error('  it as a raw "EPERM ... rename" error that looks like a broken install.');
  console.error('');
  console.error('  It is not broken. The API is just running.');

  if (holders.length > 0) {
    console.error('');
    console.error('  Processes holding it:');
    for (const h of holders) {
      console.error(`    PID ${String(h.pid).padEnd(8)} ${h.label}`);
      console.error(`             ${h.cmd}`);
    }
  } else {
    console.error('');
    console.error('  Could not enumerate holders — check for a running `nest start` or `node dist/src/main.js`.');
  }

  console.error('');
  console.error('  FIX — either:');
  console.error('');
  console.error('    npm run build:api        # stop API → build → restart API (recommended)');
  console.error('');
  console.error('    or stop the API yourself, then:');
  console.error('');
  console.error('    npm run build            # plain build, API stays down');
  console.error('');
  console.error('  Frontend-only change? The API does not need rebuilding:');
  console.error('');
  console.error('    npm --prefix <repo root> run build      # Vite, no Prisma involved');
  console.error('');
  process.exit(1);
}

main();
