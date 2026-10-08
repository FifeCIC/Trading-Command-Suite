/**
 * One-off: fold 2026-10-08 findings into sprint issue #1081 and write the updated body.
 * Node (not PowerShell) so the issue's em-dashes/en-dashes survive the UTF-8 round trip —
 * PowerShell's native-command decoding mojibakes them (ÔÇö), which would corrupt the body.
 *
 * Scratch tool: lives in logs/ on purpose — anything in scripts/ stales docs/TOOLS-INDEX.md.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const repo = 'FifeCIC/Trading-Command-Suite';
const raw = execFileSync('gh', ['issue', 'view', '1081', '--repo', repo, '--json', 'body', '--jq', '.body'], {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});

const E = (s) => s.join('\n');

const replacements = [
  // ── R1 — §3: re-measurement of #916 + the new #1089 ────────────────────────────
  [
    '- [x] #916 ⚡ Winners exit at a third of their target — realised payoff 0.448 against declared 1.0–2.0',
    E([
      '- [x] #916 ⚡ **[RE-MEASURED 2026-10-08]** capture is **16.9%** of target (not a third); realised payoff **0.586**; of the 125 winners, 66 are `broker:terminal` at a 2.04 move (the owner\'s own bulk closes, R46 — **the actor IS named**) and 29 are `system:time-stop` at a 0.58 move. The remaining live gap is the broker-3 deal blindness → #1089',
      '- [ ] #1089 ⚡ **NEW (2026-10-08)** Every close on a broker-3 symbol is `broker:unknown` — **48 of 48** (VIX/GER40/FRA40/US30/UK100/XAGUSD). `getDeals()` asks only the primary bridge (:5000), so the closing deal is never read and the row keeps the SNAPSHOT price/pnl (GER40: stored −7.19 vs real deal −8.18, reason 4 SL). **Code fix + 3 guarding tests + canary (2 failed mutated / 8 passed restored) landed 2026-10-08**; the repair of the 48 stored rows is the open part',
    ]),
  ],
  // ── R2 — §7.1: the corrected definition-of-done status ──────────────────────────
  [
    '- Definition of done carried: the actor closing winners is **NAMED** with `closeReason`/`stop_adjustment`/log evidence; realised payoff is reported **per bot beside win rate** (#916 item 3 — a rating defect); every claim carries its command and output.',
    E([
      '- Definition of done carried: the actor closing winners is **NAMED** with `closeReason`/`stop_adjustment`/log evidence; realised payoff is reported **per bot beside win rate** (#916 item 3 — a rating defect); every claim carries its command and output.',
      '- **[2026-10-08 — correction]** The actor for the 93 `broker:terminal` rows **is named**: the owner\'s own manual bulk closes (R46), which stopped 2026-10-02; the deal-reason mapping now reports an unstamped CLIENT/MOBILE/WEB/EXPERT close as `user:manual` (`close-reason.ts`). The remainder is accounted for exactly: of the 50 `broker:unknown` rows with valid P&L, **34 are the broker-3 blindness (#1089)** and **16 are XAUUSD A/B rows** (#1079/#1080 threads).',
    ]),
  ],
  // ── R3 — §2: #1088 joins the market-hours family ────────────────────────────────
  [
    '- [ ] #850 ⚡ Market-open gate uses the US calendar for EVERY symbol',
    E([
      '- [ ] #850 ⚡ Market-open gate uses the US calendar for EVERY symbol',
      '- [ ] #1088 **NEW (2026-10-08)**: the FX venue has NO holidays — every index CFD, metal and FX pair reads as OPEN on Christmas Day (a Friday in 2026). Same family as #850',
    ]),
  ],
  // ── R4 — §4: #1085 joins the data/contract faults ──────────────────────────────
  [
    '- [ ] #1068 ⚡ Bar refresh FABRICATES bars — 1,172 rows while the market was shut',
    E([
      '- [ ] #1068 ⚡ Bar refresh FABRICATES bars — 1,172 rows while the market was shut',
      '- [ ] #1085 **NEW (2026-10-08)**: the bridge\'s quote carries no trade time — a STALE quote is indistinguishable from a live one (absent refuses, stale is silently used)',
    ]),
  ],
  // ── R5 — First-pass order item 3 ────────────────────────────────────────────────
  [
    '3. **#916, #998, #1056** — exits and give-back',
    '3. **#1089, #1056** — exits and give-back (#916 re-measured 2026-10-08; #998 done)',
  ],
];

let body = raw;
for (const [oldText, newText] of replacements) {
  if (!body.includes(oldText)) {
    console.error('ANCHOR NOT FOUND — refusing to write a partial edit:\n' + oldText.slice(0, 160));
    process.exit(1);
  }
  body = body.replace(oldText, newText);
}

fs.writeFileSync('logs/sprint-1081-body-updated.md', body, 'utf8');
console.log(`OK — ${replacements.length} replacements applied, body ${raw.length} -> ${body.length} chars`);
