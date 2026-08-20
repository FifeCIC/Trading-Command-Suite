#!/usr/bin/env node
/**
 * weekly-digest-discord.cjs — Phase 2: weekly digest → Discord (#653)
 * =====================================================================
 * Compiles the week's processed handoffs (.github/handoffs/processed/) into
 * a "This week in Trading Command Suite" digest, grouped by area, and posts
 * it to Discord. Reuses lib/handoff-parse.cjs + lib/discord-post.cjs
 * (phase 1, #652) for parsing and delivery.
 *
 * Usage:
 *   node scripts/weekly-digest-discord.cjs [--days 7]
 *
 * Scheduling:
 *   - GitHub Actions: .github/workflows/weekly-digest.yml (weekly cron +
 *     manual workflow_dispatch).
 *   - Manual: npm run digest:discord
 *
 * No handoffs in the window → skip message, exit 0.
 * No webhook configured → clear skip message, exit 0.
 *
 * @created 2026-08-20 — Phase 2 weekly digest (#653)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { parseHandoffFile } = require('./lib/handoff-parse.cjs');
const { resolveWebhookUrl, postDiscordEmbed } = require('./lib/discord-post.cjs');

// ── Args ─────────────────────────────────────────────────────────────
let days = 7;
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--days[= ](\d+)$/);
  if (m) days = Math.max(1, parseInt(m[1], 10));
}

const repoRoot = path.resolve(__dirname, '..');
const processedDir = path.join(repoRoot, '.github', 'handoffs', 'processed');

// ── Collect this week's handoffs ─────────────────────────────────────
function collectHandoffs() {
  if (!fs.existsSync(processedDir)) return [];
  const since = Date.now() - days * 86_400_000;
  const out = [];
  for (const name of fs.readdirSync(processedDir)) {
    if (!name.endsWith('.md')) continue;
    const filePath = path.join(processedDir, name);
    try {
      const h = parseHandoffFile(filePath);
      if (!h.date) continue;
      const ts = Date.parse(`${h.date}T00:00:00Z`);
      if (Number.isNaN(ts) || ts < since) continue;
      out.push(h);
    } catch { /* unreadable handoff — skip */ }
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** "Aug 13 – Aug 20" style range from the collected handoffs. */
function weekRange(handoffs) {
  const dates = handoffs.map((h) => h.date).filter(Boolean).sort();
  if (!dates.length) return null;
  const fmt = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return dates.length === 1 ? fmt(dates[0]) : `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`;
}

/** Build a Discord embed: one field per area, one bullet per handoff. */
function buildDigestEmbed(handoffs) {
  const areas = new Map();
  for (const h of handoffs) {
    if (!areas.has(h.area)) areas.set(h.area, []);
    areas.get(h.area).push(h);
  }

  const fields = [];
  for (const [area, list] of areas) {
    const lines = list.map((h) => {
      const issues = h.issues.length ? ` (${h.issues.map((n) => `#${n}`).join(', ')})` : '';
      const summary = (h.summary || 'No summary').slice(0, 180);
      return `• ${h.type} — ${summary}${issues}`;
    });
    // Discord field value limit is 1024 chars — cap lines and note truncation.
    let value = '';
    let used = 0;
    for (const line of lines) {
      if (used + line.length + 1 > 1000) { value += '\n…'; break; }
      value += (value ? '\n' : '') + line;
      used += line.length + 1;
    }
    fields.push({ name: `${area} (${list.length})`, value: value || '—' });
  }

  const range = weekRange(handoffs);
  return {
    title: `🗓 This week in Trading Command Suite${range ? ` — ${range}` : ''}`,
    description: `${handoffs.length} change${handoffs.length === 1 ? '' : 's'} across ${areas.size} area${areas.size === 1 ? '' : 's'}`,
    color: 0x8b5cf6,
    fields,
    timestamp: new Date().toISOString(),
  };
}

// ── Main ──────────────────────────────────────────────────────────────
(async () => {
  const handoffs = collectHandoffs();
  if (handoffs.length === 0) {
    console.log(`⏭  No processed handoffs in the last ${days} day${days === 1 ? '' : 's'} — skipping digest.`);
    process.exit(0);
  }

  const embed = buildDigestEmbed(handoffs);

  const webhookUrl = resolveWebhookUrl(repoRoot);
  if (!webhookUrl) {
    console.log('⏭  Discord webhook not configured — skipping post.');
    console.log('   Set DISCORD_WEBHOOK_URL, add it to .env, or .github/agent-state.json → discordWebhookUrl.');
    console.log(`   Would have posted: ${embed.title}`);
    console.log(`   ${embed.description}`);
    process.exit(0);
  }

  try {
    await postDiscordEmbed(webhookUrl, embed);
    console.log(`✓ Discord digest posted: ${embed.title}`);
    console.log(`  ${embed.description}`);
    process.exit(0);
  } catch (err) {
    console.error(`✗ Discord digest post failed: ${err.message}`);
    process.exit(1);
  }
})();
