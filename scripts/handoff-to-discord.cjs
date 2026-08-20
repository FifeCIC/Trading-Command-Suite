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
const { parseHandoffFile } = require('./lib/handoff-parse.cjs');
const { resolveWebhookUrl, postDiscordEmbed } = require('./lib/discord-post.cjs');

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

// ── Main ──────────────────────────────────────────────────────────────
(async () => {
  const h = parseHandoffFile(handoffPath);

  const embed = {
    title: `Handoff closed · ${h.area} — ${h.type}`,
    description: h.summary || 'No "What Changed" section found.',
    color: h.type === 'fix' || h.type === 'bugfix' ? 0x22c55e : h.type === 'feature' ? 0x3b82f6 : 0x8b5cf6,
    fields: [],
    timestamp: new Date().toISOString(),
  };
  if (h.date) embed.fields.push({ name: 'Date', value: h.date, inline: true });
  if (h.issues.length) embed.fields.push({ name: 'Issues', value: h.issues.map((n) => `#${n}`).join(', '), inline: true });
  if (h.title) embed.fields.push({ name: 'Title', value: h.title, inline: true });

  const webhookUrl = resolveWebhookUrl(repoRoot);
  if (!webhookUrl) {
    console.log('⏭  Discord webhook not configured — skipping post.');
    console.log('   Set DISCORD_WEBHOOK_URL, add it to .env, or .github/agent-state.json → discordWebhookUrl.');
    console.log(`   Would have posted: ${embed.title}`);
    process.exit(0);
  }

  try {
    await postDiscordEmbed(webhookUrl, embed);
    console.log(`✓ Discord posted: ${embed.title}`);
    process.exit(0);
  } catch (err) {
    console.error(`✗ Discord post failed: ${err.message}`);
    process.exit(1);
  }
})();
