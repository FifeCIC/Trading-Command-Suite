/**
 * agent-paths.cjs — ONE place that knows where agent material lives.
 *
 * Owner directive, 2026-11-16: Ideally they would all be part of one library anyway where they're easy to
 * manage. I think we have a lot of discussion notes/roadmapping/agent rules scattered.
 *
 * This module is that library's index. Every script asks it for a file instead of hard-coding
 * `.github/…`, so moving the library again is a change to ONE constant.
 *
 * ── WHY THE MATERIAL LEFT THE REPOSITORY ───────────────────────────────────────────────────────
 * `.github/` is an ordinary tracked folder — a leading dot hides it from `ls`, not from git or
 * GitHub — so the rule corpus, the attention board and the agents were all published. The product
 * repo should show engineering standards, not the process that produced them.
 *
 * ── TWO LOCATIONS, IN ORDER ────────────────────────────────────────────────────────────────────
 *   1. `.github/…`            — the old in-repo location. Resolved FIRST so checking out an older
 *                               commit validates what that commit actually contains.
 *   2. `agent-ops/…` in the docs store — where the material lives now.
 *
 * ⚠️ NEITHER EXISTING IS NOT AN ERROR. `G:` is a Google Drive mount that drops out routinely, and a
 * build that goes red because a network drive is offline trains everyone to ignore the gate. Callers
 * receive `null` and are expected to report the check as SKIPPED in the output — never as a pass.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** The library root in the docs store. One constant, deliberately. */
const AGENT_HOME = path.join(
  'G:\\My Drive\\Project Management\\Live\\Trading-Command-Suite-Documentation',
  'agent-ops',
);

/**
 * agentPath(...parts) — absolute path to an agent file, or null when it is on neither location.
 * Callers must handle null explicitly; silently treating it as "" would read the wrong file.
 */
function agentPath(...parts) {
  const inRepo = path.join(REPO_ROOT, '.github', ...parts);
  if (fs.existsSync(inRepo)) return inRepo;
  const inStore = path.join(AGENT_HOME, ...parts);
  if (fs.existsSync(inStore)) return inStore;
  return null;
}

/** A writable location for agent state: repo copy if present, else the docs store if mounted. */
function agentWritable(...parts) {
  const inRepo = path.join(REPO_ROOT, '.github', ...parts);
  if (fs.existsSync(path.dirname(inRepo))) return inRepo;
  const storeDir = path.join(AGENT_HOME, ...parts.slice(0, -1));
  if (fs.existsSync(storeDir)) return path.join(AGENT_HOME, ...parts);
  return null;
}

function agentHome() {
  return AGENT_HOME;
}

module.exports = { agentPath, agentWritable, agentHome, AGENT_HOME, REPO_ROOT };
