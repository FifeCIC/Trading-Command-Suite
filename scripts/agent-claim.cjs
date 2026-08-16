#!/usr/bin/env node
/**
 * agent-claim.cjs — Issue-claim + server-restart coordination state machine.
 * =============================================================================
 * Backs .github/prompts/start.prompt.md (/start) and reads/writes
 * .github/agent-state.json.
 *
 * Commands:
 *   status                          Show claim + snapshot + serverOps state.
 *   claim <number> "<title>"        Claim an issue (posts "🤖 Claimed by" comment).
 *   heartbeat                       Refresh the active claim's lastHeartbeat.
 *   release                         Clear the active claim.
 *   cache-snapshot                  Read `gh issue list --json ...` on stdin,
 *                                   write .github/issue-cache/snapshot.md.
 *   server-op start <vite|nest|mt5|all>
 *   server-op end   [vite|nest|mt5|all]
 *   help                            Show usage.
 *
 * Why this exists: multiple agents work the same repo. Without a shared claim
 * state, two agents can pick the same issue or restart the same dev server.
 * This file is the single source of truth both claims and restarts coordinate on.
 *
 * See GH issue for the full spec.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STATE_PATH = path.join(ROOT, '.github', 'agent-state.json');
const SNAPSHOT_PATH = path.join(ROOT, '.github', 'issue-cache', 'snapshot.md');
const REPO = process.env.GITHUB_REPOSITORY || 'FifeCIC/Trading-Command-Suite';

const SNAPSHOT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const HEARTBEAT_STALE_MS = 15 * 60 * 1000; // 15 minutes

const EMPTY_CLAIM = {
  number: null,
  title: null,
  claimedBy: null,
  claimSession: null,
  claimTimestamp: null,
  lastHeartbeat: null,
};

const EMPTY_SERVER_OPS = {
  restartingVite: false,
  restartingNest: false,
  restartingMt5: false,
  opStartedAt: null,
  opSession: null,
};

function nowIso() {
  return new Date().toISOString();
}

function agentName() {
  return process.env.AGENT_NAME || process.env.AGENT || 'agent';
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return defaultState();
  }
}

function defaultState() {
  return {
    version: 1,
    claimedIssue: { ...EMPTY_CLAIM },
    serverOps: { ...EMPTY_SERVER_OPS },
    issueCache: { entryCount: 0, lastPruned: null, totalTokensSaved: 0 },
    issueSnapshot: { updatedAt: null, count: 0 },
  };
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function ageMs(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, ms);
}

function fmtAge(ms) {
  if (ms == null) return 'never';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function postClaimComment(number, agent) {
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0];
  const timeStr = date.toISOString().split('T')[1].slice(0, 8);
  const body = `🤖 Claimed by ${agent} — started work on ${dateStr} ${timeStr} UTC`;
  const tmp = path.join(os.tmpdir(), `agent-claim-${number}.md`);
  fs.writeFileSync(tmp, body, 'utf8');
  try {
    execSync(
      `gh issue comment ${number} --repo ${REPO} --body-file "${tmp}"`,
      { stdio: 'ignore' },
    );
    return true;
  } catch (err) {
    console.warn(
      `⚠️  Could not post GitHub claim comment (${(err && err.message) || 'gh unavailable'}). ` +
      `Manual: pwsh -File scripts\\gh-wrapper.ps1 issue comment ${number} --repo ${REPO} --body "🤖 Claimed by ${agent}"`,
    );
    return false;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ── Commands ──────────────────────────────────────────────────────────────

function cmdStatus() {
  const state = loadState();
  const claim = state.claimedIssue || EMPTY_CLAIM;
  const claimed = Boolean(claim.number);

  const hbAge = ageMs(claim.lastHeartbeat);
  const stale = claimed && hbAge != null && hbAge > HEARTBEAT_STALE_MS;

  const snapAge = ageMs(state.issueSnapshot?.updatedAt);
  const snapshotFresh = snapAge != null && snapAge < SNAPSHOT_TTL_MS;

  const ops = state.serverOps || EMPTY_SERVER_OPS;
  const anyOp = ops.restartingVite || ops.restartingNest || ops.restartingMt5;

  console.log(`claimed: ${claimed}${stale ? ' (STALE heartbeat)' : ''}`);
  if (claimed) {
    console.log(`  issue: #${claim.number} "${claim.title}"`);
    console.log(`  by: ${claim.claimedBy} (session ${claim.claimSession})`);
    console.log(`  claimed: ${claim.claimTimestamp}`);
    console.log(`  lastHeartbeat: ${claim.lastHeartbeat} (${fmtAge(hbAge)})`);
  }
  console.log(
    `snapshotFresh: ${snapshotFresh} ` +
    `(updated ${fmtAge(snapAge)}, ${state.issueSnapshot?.count || 0} issues)`,
  );
  console.log(
    `serverOps: vite=${ops.restartingVite} nest=${ops.restartingNest} mt5=${ops.restartingMt5}` +
    (anyOp ? ` (op by ${ops.opSession} at ${ops.opStartedAt})` : ''),
  );
}

function cmdClaim(args) {
  const number = parseInt(args[0], 10);
  const title = args.slice(1).join(' ');
  if (!number) {
    console.error('usage: agent-claim.cjs claim <number> "<title>"');
    process.exit(1);
  }
  const state = loadState();
  if (state.claimedIssue?.number) {
    console.error(
      `⚠️  Issue #${state.claimedIssue.number} is already claimed by ${state.claimedIssue.claimedBy}. ` +
      `Release it first: node scripts/agent-claim.cjs release`,
    );
    process.exit(1);
  }
  const agent = agentName();
  state.claimedIssue = {
    number,
    title: title || null,
    claimedBy: agent,
    claimSession: `sess-${Date.now().toString(36)}`,
    claimTimestamp: nowIso(),
    lastHeartbeat: nowIso(),
  };
  saveState(state);
  const posted = postClaimComment(number, agent);
  console.log(`✅ Claimed #${number} "${title || ''}" as ${agent}`);
  if (posted) console.log('   Posted "🤖 Claimed by" comment to GitHub.');
}

function cmdHeartbeat() {
  const state = loadState();
  if (!state.claimedIssue?.number) {
    console.warn('⚠️  No active claim — nothing to heartbeat.');
    process.exit(1);
  }
  state.claimedIssue.lastHeartbeat = nowIso();
  saveState(state);
  console.log(`❤️  Heartbeat updated for #${state.claimedIssue.number}.`);
}

function cmdRelease() {
  const state = loadState();
  const was = state.claimedIssue?.number;
  state.claimedIssue = { ...EMPTY_CLAIM };
  saveState(state);
  console.log(was ? `🔓 Released claim on #${was}.` : '🔓 Nothing to release.');
}

function cmdCacheSnapshot() {
  const raw = readStdin().trim();
  if (!raw) {
    console.error('cache-snapshot expects `gh issue list --json ...` piped on stdin.');
    process.exit(1);
  }
  let issues;
  try {
    issues = JSON.parse(raw);
    if (!Array.isArray(issues)) throw new Error('not an array');
  } catch {
    console.error('cache-snapshot: stdin was not valid JSON array.');
    process.exit(1);
  }

  const lines = issues.map((i) => {
    const labels = (i.labels || []).map((l) => l.name).join(', ');
    return `- #${i.number} — ${i.title}${labels ? `  \`[${labels}]\`` : ''} (updated ${i.updatedAt})`;
  });

  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(
    SNAPSHOT_PATH,
    `# Issue Snapshot (${issues.length} open issues)\n\n` + lines.join('\n') + '\n',
    'utf8',
  );

  const state = loadState();
  state.issueSnapshot = { updatedAt: nowIso(), count: issues.length };
  saveState(state);

  console.log(`📸 Cached ${issues.length} issues → ${path.relative(ROOT, SNAPSHOT_PATH)}`);
}

const OPS = { vite: 'restartingVite', nest: 'restartingNest', mt5: 'restartingMt5' };

function cmdServerOp(sub, args) {
  const state = loadState();
  state.serverOps = state.serverOps || { ...EMPTY_SERVER_OPS };
  const ops = state.serverOps;

  if (sub === 'start') {
    const target = (args[0] || '').toLowerCase();
    if (target === 'all') {
      for (const k of Object.values(OPS)) ops[k] = true;
      ops.opStartedAt = nowIso();
      ops.opSession = agentName();
    } else if (OPS[target]) {
      ops[OPS[target]] = true;
      ops.opStartedAt = nowIso();
      ops.opSession = agentName();
    } else {
      console.error('usage: agent-claim.cjs server-op start <vite|nest|mt5|all>');
      process.exit(1);
    }
    saveState(state);
    console.log(`🚧 Server op started (${target}) by ${ops.opSession}.`);
    return;
  }

  if (sub === 'end') {
    const target = (args[0] || 'all').toLowerCase();
    if (target === 'all') {
      for (const k of Object.values(OPS)) ops[k] = false;
      ops.opStartedAt = null;
      ops.opSession = null;
    } else if (OPS[target]) {
      ops[OPS[target]] = false;
      if (!ops.restartingVite && !ops.restartingNest && !ops.restartingMt5) {
        ops.opStartedAt = null;
        ops.opSession = null;
      }
    } else {
      console.error('usage: agent-claim.cjs server-op end [vite|nest|mt5|all]');
      process.exit(1);
    }
    saveState(state);
    console.log(`✅ Server op ended (${target}).`);
    return;
  }

  console.error('usage: agent-claim.cjs server-op <start|end> [vite|nest|mt5|all]');
  process.exit(1);
}

function cmdHelp() {
  console.log(`agent-claim.cjs — issue claim + server-restart coordination

Usage:
  node scripts/agent-claim.cjs status
  node scripts/agent-claim.cjs claim <number> "<title>"
  node scripts/agent-claim.cjs heartbeat
  node scripts/agent-claim.cjs release
  node scripts/agent-claim.cjs cache-snapshot          (reads gh JSON on stdin)
  node scripts/agent-claim.cjs server-op start <vite|nest|mt5|all>
  node scripts/agent-claim.cjs server-op end   [vite|nest|mt5|all]

State file: .github/agent-state.json
Snapshot:   .github/issue-cache/snapshot.md`);
}

// ── Main ──────────────────────────────────────────────────────────────────

const [, , cmd, ...args] = process.argv;

switch (cmd) {
  case 'status': cmdStatus(); break;
  case 'claim': cmdClaim(args); break;
  case 'heartbeat': cmdHeartbeat(); break;
  case 'release': cmdRelease(); break;
  case 'cache-snapshot': cmdCacheSnapshot(); break;
  case 'server-op': cmdServerOp(args[0], args.slice(1)); break;
  case 'help':
  case '--help':
  case '-h': cmdHelp(); break;
  default:
    cmdHelp();
    process.exit(cmd ? 1 : 0);
}
