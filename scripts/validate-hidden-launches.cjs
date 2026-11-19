#!/usr/bin/env node
/**
 * validate-hidden-launches.cjs — a WMI-launched console app must be launched HIDDEN (#1138).
 *
 * ── THE DEFECT THIS CLOSES ────────────────────────────────────────────────────────────────────
 * `scripts/build-api.ps1` restarts the API with
 *
 *     Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "cmd.exe /c …" }
 *
 * `Win32_Process.Create` is the right way to detach (a `Start-Process` child is a DESCENDANT of the
 * caller, and the caller then waits for a server that never exits). But with **no
 * `ProcessStartupInformation`**, Windows gives the console-subsystem child a brand-new VISIBLE
 * console: an empty black `C:\WINDOWS\system32\cmd.exe` window that displays nothing and belongs to
 * nobody.
 *
 * It was reported exactly that, repeatedly: *"I always have a system32\cmd window open as it is
 * right now but 2-3 times you've caused a new one to open but it never displays anything."* One
 * window per `build:api`. `scripts/tcs-launch.ps1` already passes `-WindowStyle Hidden` for the same
 * reason — `build-api.ps1` was the only launcher that did not.
 *
 * ── WHAT THIS CHECKS ─────────────────────────────────────────────────────────────────────────
 * Every PowerShell script that calls `Win32_Process` `Create` must, in the same statement block,
 * pass `ProcessStartupInformation` built with `ShowWindow = 0` (SW_HIDE).
 *
 * ⚠️ It is a SOURCE check, not a behaviour check: it cannot see whether a window actually appeared.
 * Its value is that a future edit which removes the flag fails the build instead of quietly
 * annoying the requirement on the next run. The behaviour was verified once, by hand — the API's stderr
 * log went from `^C` (interrupted with its console) to 0 bytes.
 *
 * Usage:  node scripts/validate-hidden-launches.cjs [--self-test]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = [path.join(ROOT, 'scripts'), path.join(ROOT, 'nest', 'scripts')];

/** Files that legitimately query Win32_Process without creating anything. */
const READ_ONLY_CALLS = /-ClassName\s+Win32_Process\s+-Filter|Get-CimInstance\s+Win32_Process/;

/**
 * Pure: given a script's text, return the problems found.
 *
 * ⚠️ COMMENTS ARE STRIPPED FIRST (fixed 2026-11-19). The gate is about what a script DOES, and a
 * documentation example is not a launch. Measured: `scripts/tcs-launch.ps1` carries a docblock that
 * shows the recovery one-liner — `Invoke-CimMethod … Win32_Process -MethodName Create …` with no
 * startup blob, because it is an example a human pastes by hand — and that **failed the build**.
 * The fix belongs here, not in the comment: telling the next person to write a worse example would
 * leave the same trap for every future docblock. This is the same defect `validate-page-chrome.cjs`
 * had with `<h1>` inside a docblock.
 *
 * A `Win32_Process.Create` call is "safe" when the text between its `Arguments @{` and the closing
 * `}` names `ProcessStartupInformation` AND the file sets `ShowWindow = 0` somewhere. Both halves are
 * required: passing a startup blob without the show flag still allocates a visible console.
 */
function stripComments(text) {
  // A PowerShell comment runs from a line-leading `#` to end of line. Only line-leading, so a `#`
  // inside a string or a command argument is untouched.
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

function inspectScript(relPath, text) {
  const problems = [];
  const code = stripComments(text);
  const creates = [...code.matchAll(/Invoke-CimMethod[\s\S]{0,200}?Win32_Process[\s\S]{0,80}?Create/gi)];
  if (creates.length === 0) return problems;

  // ⚠️ THE `[uint16]` CAST IS PART OF THE CORRECT FORM, NOT A VARIATION OF IT (fixed 2026-11-19).
  // `Win32_ProcessStartup.ShowWindow` is a CIM `uint16`, and `build-api.ps1` documents at the call
  // site that the cast is REQUIRED — without it the assignment is rejected at runtime. The matcher
  // used to demand a bare `0`, so it flagged the one spelling that works and would have accepted a
  // `1` that shows the window. A guard that fires on the correct code is the defect it exists to
  // catch, so the cast is optional in the pattern and required to still be `0`.
  const hidesWindow = /ShowWindow\s*=\s*(\[[A-Za-z0-9]+\]\s*)?0\b/.test(code);
  for (const m of creates) {
    const after = code.slice(m.index, m.index + 1200);
    // The argument block that follows the call.
    const block = after.slice(after.indexOf('Arguments'), after.indexOf('Arguments') + 700);
    const passesBlob = /ProcessStartupInformation\s*=/.test(block);
    if (!passesBlob) {
      problems.push(
        `${relPath}: Win32_Process Create with no ProcessStartupInformation — this allocates a VISIBLE console window. Pass a Win32_ProcessStartup with ShowWindow = 0.`,
      );
    } else if (!hidesWindow) {
      problems.push(
        `${relPath}: Win32_Process Create passes a startup blob but the file never sets ShowWindow = 0 — the console is still visible.`,
      );
    }
  }
  return problems;
}

function run() {
  const problems = [];
  let scanned = 0;
  for (const dir of SCAN_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.ps1')) continue;
      scanned += 1;
      const full = path.join(dir, f);
      const text = fs.readFileSync(full, 'utf8');
      if (READ_ONLY_CALLS.test(text) && !/Invoke-CimMethod/.test(text)) continue;
      problems.push(...inspectScript(path.relative(ROOT, full), text));
    }
  }

  // ⚠️ A checker that inspected NOTHING must ERROR, never pass. If the scan found no PowerShell
  // files at all, the paths are wrong and a green tick would be meaningless.
  if (scanned === 0) {
    console.error('[hidden-launches] ✖ inspected 0 script(s) — the scan paths are wrong, so this check proved nothing.');
    process.exit(1);
  }

  if (problems.length > 0) {
    console.error(`[hidden-launches] ✖ ${problems.length} problem(s) across ${scanned} script(s):`);
    for (const p of problems) console.error(`   ${p}`);
    process.exit(1);
  }
  console.log(`[hidden-launches] ✅ OK — ${scanned} PowerShell script(s); every Win32_Process Create hides its console.`);
}

function selfTest() {
  let failed = 0;
  const check = (label, expected, actual) => {
    const ok = expected === actual;
    if (!ok) failed += 1;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} → ${actual}${ok ? '' : ` (expected ${expected})`}`);
  };

  // 1. The exact defect: a Create with no startup blob.
  const bad = `Invoke-CimMethod -ClassName Win32_Process -MethodName Create \`
  -Arguments @{ CommandLine = "cmd.exe /c node x.js" } -ErrorAction Stop`;
  check('no ProcessStartupInformation is a problem', 1, inspectScript('bad.ps1', bad).length);

  // 2. A blob without the hide flag is STILL a problem — the console is allocated either way.
  const halfFixed = `$s = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ Priority = 0 }
Invoke-CimMethod -ClassName Win32_Process -MethodName Create \`
  -Arguments @{ CommandLine = "cmd.exe /c node x.js"; ProcessStartupInformation = $s }`;
  check('startup blob without ShowWindow = 0 is a problem', 1, inspectScript('half.ps1', halfFixed).length);

  // 3. The correct shape passes.
  const good = `$s = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = 0 }
Invoke-CimMethod -ClassName Win32_Process -MethodName Create \`
  -Arguments @{ CommandLine = "cmd.exe /c node x.js"; ProcessStartupInformation = $s }`;
  check('hidden console passes', 0, inspectScript('good.ps1', good).length);

  // 4. A script that never creates a process is out of scope, not a failure.
  check('read-only Win32_Process use is ignored', 0, inspectScript('reader.ps1', 'Get-CimInstance Win32_Process -Filter "ProcessId=1"').length);

  // 5. Canary-the-canary: the matcher must produce a DIFFERENT DIAGNOSIS for each broken shape, so a
  //    future "simplification" that reports one generic message (or always returns []) fails here.
  //    ⚠️ Compare the MESSAGES, not the counts — cases 1 and 2 both yield exactly one problem, and a
  //    count-based canary read that as "the matcher cannot tell them apart" when it can.
  const messages = new Set([
    inspectScript('a', bad)[0] ?? '',
    inspectScript('b', halfFixed)[0] ?? '',
    inspectScript('c', good)[0] ?? '',
  ]);
  check('matcher gives each shape its own diagnosis', 3, messages.size);

  // 6. A DOCBLOCK is not a launch (added 2026-11-19). `tcs-launch.ps1` documents the recovery
  //    one-liner in a comment — without a startup blob, because a human pastes it by hand — and the
  //    unfiltered matcher failed the build on it. Both directions are checked: the comment must be
  //    ignored, and the SAME text uncommented must still be caught. Without the second half, a
  //    "fix" that stopped matching anything would pass this case.
  const commented = bad
    .split('\n')
    .map((line) => '#     ' + line)
    .join('\n');
  check('a commented example is not a launch', 0, inspectScript('doc.ps1', commented).length);
  check('…but the same text as CODE is still a launch', 1, inspectScript('doc.ps1', bad).length);

  // 7. The `[uint16]` cast is the CORRECT form (see the note beside `hidesWindow`). Both directions:
  //    the cast hides the window, and a visible window is still a problem whatever the spelling.
  const castHidden = `$s = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
Invoke-CimMethod -ClassName Win32_Process -MethodName Create \`
  -Arguments @{ CommandLine = "cmd.exe /c node x.js"; ProcessStartupInformation = $s }`;
  check('ShowWindow = [uint16]0 counts as hidden', 0, inspectScript('cast.ps1', castHidden).length);

  const castVisible = castHidden.replace('[uint16]0', '[uint16]1');
  check('ShowWindow = [uint16]1 is still a problem', 1, inspectScript('cast1.ps1', castVisible).length);

  console.log(failed === 0 ? '\n✅ self-test passed' : `\n🛑 self-test FAILED (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (process.argv.slice(2).includes('--self-test')) selfTest();
else run();
