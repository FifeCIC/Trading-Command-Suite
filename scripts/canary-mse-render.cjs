/**
 * canary-mse-render.cjs — does /status/meta-stack-explorer actually RENDER, and are its rows present?
 *
 * ⚠️ WHY THIS EXISTS. On 2026-10-20 the page blanked TWICE with
 *   ReferenceError: Cannot access 'scored' / 'allProtocolsData' / 'selectedProtocol' before initialization
 * and every build was green. That is the `useMemo(fn, [deps])` trap: deps are evaluated immediately, so
 * a `const` declared later in the component is a crash. ESLint's `no-use-before-define` only reports
 * SAME-SCOPE references, so it cannot see `selectedProtocol` used inside a memo callback — the third
 * crash got through a lint rule that was added specifically to catch the class.
 *
 * **A build passing is not evidence that a page loads.** This is the only check in the repo that
 * answers that question, which is why it is a guard and not a report.
 *
 * ⚠️ TWO WAYS TO GET A FALSE RESULT, both hit while writing this:
 *   1. Measuring too early. The first run reported "picker options: 0" and nearly became a filed UI
 *      bug — the select simply had not been populated. Every condition is POLLED before asserted.
 *   2. A canary that only prints. "MISSING" in the transcript does not fail a build, so a page that
 *      renders but has lost a required row would pass. `REQUIRED_ROWS` below FAILS the run.
 *
 * No npm dependency: Playwright's Chromium is on disk and Node 24 has a global WebSocket, so CDP is
 * driven directly. This is the same approach `logs/canary-protocol-backtest.cjs` used.
 *
 *   node scripts/canary-mse-render.cjs              # drive the real page
 *   node scripts/canary-mse-render.cjs --self-test  # prove the row checks can FAIL
 *
 * Requires the frontend on :5173 (and the API on :3201 for the rows to have data).
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const URL_UNDER_TEST = process.env.MSE_URL || 'http://localhost:5173/status/meta-stack-explorer';
const PORT = Number(process.env.MSE_CDP_PORT || 9337);
const PROTOCOL_HINT = process.env.MSE_PROTOCOL || 'xau-speed-m15';

/** Rows that must exist once a protocol is selected. Each entry fails the run when absent. */
const REQUIRED_ROWS = [
  { name: 'Earnable capacity (#1131)', needle: /Earnable capacity/ },
  { name: 'Label under the calibrated basis (#1131)', needle: /calibrated basis/ },
];

/** Candidate Chromium locations, in order. An explicit env var always wins. */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1208', 'chrome-win64', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find((c) => { try { return fs.existsSync(c); } catch { return false; } }) ?? null;
}

/**
 * PURE matcher, extracted so `--self-test` can prove it can return a miss. A finder that only ever
 * returns a row is indistinguishable from one that is not looking.
 */
function findRow(texts, needle) {
  return texts.find((t) => needle.test(t)) ?? null;
}

function selfTest() {
  const rows = [
    '⚠Earnable capacity630 of 910 · 31% unearnable',
    '✓Label under the calibrated basisHOLD at 13.85%',
    'Counted / measured directives9 / 11',
  ];
  let failures = 0;
  const check = (label, ok) => {
    if (!ok) failures++;
    console.log(`  ${ok ? '✔' : '✖'} ${label}`);
  };
  check('finds a row that IS present', findRow(rows, /Earnable capacity/) !== null);
  check('returns null for a row that is ABSENT', findRow(rows, /Nonexistent row/) === null);
  check('matches on a substring, not the whole cell', findRow(rows, /calibrated basis/)?.startsWith('✓Label'));
  // The requirement logic must fail when a required row is missing — that is the whole point.
  const missingOne = REQUIRED_ROWS.filter((r) => !findRow(rows.slice(0, 1), r.needle));
  check('REQUIRED_ROWS reports the missing row', missingOne.length === REQUIRED_ROWS.length - 1);
  check('REQUIRED_ROWS passes when all are present',
    REQUIRED_ROWS.every((r) => findRow(rows, r.needle)));
  // A canary that cannot find its browser must say so, not report a pass.
  check('findChrome() returns a path or null, never undefined', findChrome() !== undefined);
  console.log(failures === 0
    ? `[canary-mse] ✅ self-test passed (6 checks)`
    : `[canary-mse] ✖ self-test FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('✖ no Chromium found. Set CHROME_PATH, or install Playwright browsers.');
    process.exit(2); // 2 = cannot run, deliberately distinct from 1 = the page is broken
  }
  const profile = path.join(os.tmpdir(), 'cdp-mse-' + Date.now());
  fs.mkdirSync(profile, { recursive: true });
  const chrome = spawn(chromePath, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1600,1400',
    URL_UNDER_TEST,
  ], { stdio: 'ignore' });

  let code = 0;
  try {
    let wsUrl = null;
    for (let i = 0; i < 60 && !wsUrl; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        wsUrl = list.find((t) => t.type === 'page' && t.url.includes('5173'))?.webSocketDebuggerUrl ?? null;
      } catch { /* not up yet */ }
      if (!wsUrl) await sleep(500);
    }
    if (!wsUrl) throw new Error(`no page target on ${URL_UNDER_TEST} — is the frontend running on :5173?`);

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

    const pending = new Map();
    const problems = [];
    let n = 1;
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params?.exceptionDetails;
        problems.push('UNCAUGHT: ' + (d?.exception?.description || d?.text || '?'));
      }
      if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') {
        problems.push('LOG.ERROR: ' + m.params.entry.text);
      }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = n++;
      pending.set(id, (m) => (m.error ? reject(new Error(method + ' ' + JSON.stringify(m.error))) : resolve(m.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
    // `ev()` MUST surface evaluate failures — a verifier that cannot read its input has to ERROR.
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r?.exceptionDetails) {
        throw new Error('evaluate threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      }
      return r?.result?.value;
    };

    await send('Runtime.enable');
    await send('Log.enable');

    let mounted = false;
    for (let i = 0; i < 40; i++) {
      mounted = await ev(`!!document.querySelector('.mse-page')`);
      if (mounted) break;
      await sleep(500);
    }

    const body = String(await ev(`document.body.innerText || ''`));
    const crashed = /Something went wrong rendering this view/i.test(body);

    console.log('mounted                 :', mounted);
    console.log('crash boundary shown    :', crashed);
    console.log('heading                 :', await ev(`document.querySelector('.mse-header h1')?.innerText.split('\\n')[0] || '(none)'`));
    console.log('pause/play toggle       :', await ev(`document.querySelector('.mse-live-toggle')?.innerText.trim() || '(missing)'`));

    let optionCount = 0;
    for (let i = 0; i < 40; i++) {
      optionCount = await ev(`document.querySelectorAll('.mse-banner-select option').length`);
      if (optionCount > 1) break;
      await sleep(500);
    }
    console.log('protocol picker options :', optionCount);

    const picked = await ev(`(() => {
      const sel = document.querySelector('.mse-banner-select');
      if (!sel || sel.options.length < 2) return null;
      const opt = Array.from(sel.options).find(o => o.value && o.textContent.includes('${PROTOCOL_HINT}'))
        || Array.from(sel.options).find(o => o.value);
      if (!opt) return null;
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return opt.textContent.trim();
    })()`);
    console.log('selected protocol       :', picked || '(picker empty — nothing to select)');
    if (picked) {
      // ⚠️ POLL for the scored payload, never a fixed sleep. A flat `await sleep(6000)` was measured
      // flaking on the first run after an API restart — the batch query had simply not resolved, and
      // the run reported "required row missing" against a page that was still loading. That is a
      // false failure, and a guard that cries wolf gets ignored. Poll for the condition, then assert.
      let ledger = 0;
      let waited = 0;
      for (let i = 0; i < 60; i++) {
        ledger = await ev(`document.querySelectorAll('.mse-dir-table tbody tr').length`);
        if (ledger > 0) break;
        waited += 500;
        await sleep(500);
      }
      console.log('  after selection — waited for score:', `${(waited / 1000).toFixed(1)}s`);
      console.log('  after selection — stages with data:', await ev(`document.querySelectorAll('.mse-stage:not(.mse-stage-waiting)').length`));
      console.log('  after selection — ledger rows     :', ledger);
      console.log('  after selection — banner shows    :', await ev(`document.querySelector('.mse-strategy-banner-name')?.innerText || '(none)'`));
    }
    console.log('stages rendered         :', await ev(`document.querySelectorAll('.mse-stage').length`));
    console.log('measured-value rows     :', await ev(`document.querySelectorAll('.mse-check-list--technical .mse-check-item').length`));
    console.log('directive ledger rows   :', await ev(`document.querySelectorAll('.mse-dir-table tbody tr').length`));

    const rowTexts = await ev(`[...document.querySelectorAll('.mse-check-item')].map(e=>e.textContent.replace(/\\s+/g,' ').trim())`);
    const texts = Array.isArray(rowTexts) ? rowTexts : [];
    let missing = [];
    for (const req of REQUIRED_ROWS) {
      const found = findRow(texts, req.needle);
      console.log(`  ${found ? '✔' : '✖'} required row — ${req.name}`);
      if (!found) missing.push(req.name);
    }
    if (texts.length === 0) {
      // An assertion over nothing is not a pass: no rows at all means the probe read nothing.
      console.log('  ✖ measured-value rows could not be read — refusing to treat that as a pass');
      missing.push('(no measured-value rows at all)');
    }

    console.log('na rows (stand out)     :', await ev(`document.querySelectorAll('.mse-check-na').length`));
    console.log('old tech heading gone   :', await ev(`document.querySelectorAll('.mse-tech-heading').length === 0`));
    console.log('dashed divider gone     :', await ev(`(getComputedStyle(document.querySelector('.mse-check-list--technical') || document.body).borderTopStyle !== 'dashed')`));

    if (!mounted || crashed) {
      console.log('\nbody (first 700 chars)  :', body.slice(0, 700));
      code = 1;
    }
    if (missing.length) {
      console.log(`\n✖ ${missing.length} required row(s) missing: ${missing.join(', ')}`);
      code = 1;
    }
    if (problems.length) {
      console.log('\n--- page errors ---');
      for (const p of problems) console.log(' ', p);
      code = 1;
    }
    console.log('\nRESULT:', code === 0 ? '✅ rendered, required rows present, no page errors' : '✖ page did not render cleanly');
  } catch (err) {
    console.error('✖ ' + err.message);
    code = 1;
  } finally {
    try { chrome.kill(); } catch { /* already gone */ }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* profile may be locked */ }
    process.exit(code);
  }
})();
