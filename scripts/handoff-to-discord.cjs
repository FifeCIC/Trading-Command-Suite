#!/usr/bin/env node
/**
 * handoff-to-discord.cjs — Phase 1: Discord activity (#652)
 * =====================================================================
 * Posts a short Discord embed when a handoff file is closed/processed.
 * Foundation for the social pipeline (phase 2 weekly digest → this channel,
 * phase 3 Reddit/Facebook, phase 6 changelog umbrella).
 *
 * Usage:
 *   node scripts/handoff-to-discord.cjs <path/to/handoff.md>
 *
 * Webhook URL resolution order:
 *   1. DISCORD_WEBHOOK_URL environment variable
 *   2. <repo>/.env            (KEY=VALUE lines)
 *   3. .github/agent-state.json  → discordWebhookUrl
 *
 * No webhook configured → prints a clear skip message and exits 0.
 * POST failure → prints the error and exits 1 (does not crash the caller).
 *
 * Embed contents (acceptance #652):
 *   - title built from handoff area + type
 *   - one-line summary (first paragraph of "What Changed")
 *   - issue numbers referenced in the handoff (e.g. #652)
 *   - handoff date
 *
 * @created 2026-08-20 — Phase 1 Discord activity (#652)
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ── Args ─────────────────────────────────────────────────────────────
const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Usage: node scripts/handoff-to-discord.cjs <path/to/handoff.md>');
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..');
const handoffPath = path.resolve(repoRoot, fileArg);

if (!fs.existsSync(handoffPath)) {
  console.error(`✗ Handoff file not found: ${handoffPath}`);
  process.exit(1);
}

// ── Parse helpers ─────────────────────────────────────────────────────
/** Extract YAML frontmatter ({key: value} lines between leading --- fences). */
function parseFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return fm;
}

/** First non-empty paragraph under `## What Changed` (case-insensitive), collapsed to one line. */
function oneLineSummary(md, heading = 'What Changed') {
  const section = md.match(new RegExp(`^##\\s+${heading}\\s*\\r?\\n([\\s\\S]*?)(?=\\n##\\s|\\Z)`, 'im'));
  if (!section) return null;
  const para = section[1].split(/\r?\n\r?\n/).map((p) => p.trim()).find(Boolean);
  if (!para) return null;
  const one = para.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  return one.length > 280 ? `${one.slice(0, 277)}…` : one;
}

/** Unique issue numbers referenced anywhere in the doc: (#652), #652, issue 652. */
function referencedIssues(md) {
  const set = new Set();
  const re = /(?:^|[^\w#])#(\d{2,})\b|issue\s+#?(\d{2,})\b/gi;
  let m;
  while ((m = re.exec(md)) !== null) set.add(Number(m[1] || m[2]));
  return [...set].sort((a, b) => a - b);
}

/** Date from frontmatter, else from a YYYY-MM-DD filename prefix. */
function handoffDate(fm, filePath) {
  if (fm.date) return fm.date;
  const fn = path.basename(filePath);
  const m = fn.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// ── Webhook resolution ────────────────────────────────────────────────
function webhookFromEnvFile(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const kv = line.match(/^\s*DISCORD_WEBHOOK_URL\s*=\s*(.+?)\s*$/);
      if (kv) return kv[1].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* unreadable .env */ }
  return null;
}

function webhookFromAgentState(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    return state.discordWebhookUrl || state.discord?.webhookUrl || null;
  } catch { /* missing/unparseable */ }
  return null;
}

function resolveWebhookUrl() {
  return (
    process.env.DISCORD_WEBHOOK_URL ||
    webhookFromEnvFile(path.join(repoRoot, '.env')) ||
    webhookFromAgentState(path.join(repoRoot, '.github', 'agent-state.json')) ||
    ''
  ).trim();
}

// ── Main ──────────────────────────────────────────────────────────────
(async () => {
  const md = fs.readFileSync(handoffPath, 'utf8');
  const fm = parseFrontmatter(md);
  const area = fm.area || 'general';
  const type = fm.type || 'update';
  const date = handoffDate(fm, handoffPath);
  const summary = oneLineSummary(md);
  const issues = referencedIssues(md);

  const embed = {
    title: `Handoff closed · ${area} — ${type}`,
    description: summary || 'No "What Changed" section found.',
    color: type === 'fix' ? 0x22c55e : type === 'feature' ? 0x3b82f6 : 0x8b5cf6,
    fields: [],
    timestamp: new Date().toISOString(),
  };
  if (date) embed.fields.push({ name: 'Date', value: date, inline: true });
  if (issues.length) embed.fields.push({ name: 'Issues', value: issues.map((n) => `#${n}`).join(', '), inline: true });
  if (fm.title) embed.fields.push({ name: 'Title', value: fm.title, inline: true });

  const webhookUrl = resolveWebhookUrl();
  if (!webhookUrl) {
    console.log('⏭  Discord webhook not configured — skipping post.');
    console.log('   Set DISCORD_WEBHOOK_URL, add it to .env, or .github/agent-state.json → discordWebhookUrl.');
    console.log(`   Would have posted: ${embed.title}`);
    process.exit(0);
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Discord responded ${res.status}`);
    console.log(`✓ Discord posted: ${embed.title}`);
    if (res.status !== 204) {
      const text = await res.text();
      if (text.trim()) console.log(`  response: ${text.slice(0, 200)}`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`✗ Discord post failed: ${err.message}`);
    process.exit(1);
  }
})();
