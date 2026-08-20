/**
 * discord-post.cjs — shared Discord webhook resolution + delivery.
 * =====================================================================
 * Used by scripts/handoff-to-discord.cjs (phase 1, #652) and
 * scripts/weekly-digest-discord.cjs (phase 2, #653).
 *
 * Webhook URL resolution order:
 *   1. DISCORD_WEBHOOK_URL environment variable
 *   2. <repo>/.env            (KEY=VALUE lines)
 *   3. .github/agent-state.json  → discordWebhookUrl
 */
'use strict';

const fs = require('fs');
const path = require('path');

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

/** Resolve the webhook URL for the repo rooted at `repoRoot`. Empty when unconfigured. */
function resolveWebhookUrl(repoRoot) {
  return (
    process.env.DISCORD_WEBHOOK_URL ||
    webhookFromEnvFile(path.join(repoRoot, '.env')) ||
    webhookFromAgentState(path.join(repoRoot, '.github', 'agent-state.json')) ||
    ''
  ).trim();
}

/** POST one embed to the webhook. Throws on network/HTTP failure. */
async function postDiscordEmbed(webhookUrl, embed) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Discord responded ${res.status}`);
  return res;
}

module.exports = { resolveWebhookUrl, postDiscordEmbed };
