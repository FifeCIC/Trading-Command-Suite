const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', '.github', 'agent-state.json');
const CACHE_DIR = path.join(__dirname, '..', '.github', 'issue-cache');
const SNAPSHOT_PATH = path.join(CACHE_DIR, 'snapshot.md');
const LOG_PATH = path.join(__dirname, '..', '.github', 'agent-coordination-log.md');

const [action, ...args] = process.argv.slice(2);

function readState() { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
function writeState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2) + '\n'); }
function getSession() { return process.env.VSCODE_TARGET_SESSION_LOG || 'unknown-session'; }
function getAgentName() { return process.env.AGENT_NAME || process.title || 'unnamed'; }
function logEvent(event) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const s = getSession().slice(0, 12);
  fs.appendFileSync(LOG_PATH, `| ${ts} | ${event} | ${s}... |\n`);
}

switch (action) {
  case 'claim': {
    const number = parseInt(args[0], 10);
    const title = args.slice(1).join(' ') || '(no title)';
    if (isNaN(number)) { console.error('Usage: node scripts/agent-claim.cjs claim <number> [title]'); process.exit(1); }
    const state = readState();
    state.claimedIssue = { number, title, claimedBy: getAgentName(), claimSession: getSession(), claimTimestamp: new Date().toISOString(), lastHeartbeat: new Date().toISOString() };
    writeState(state);
    if (fs.existsSync(LOG_PATH)) logEvent('Claimed issue #' + number + ' — "' + title + '"');
    console.log('Claimed issue #' + number);
    break;
  }
  case 'release': {
    const state = readState();
    const was = state.claimedIssue.number;
    state.claimedIssue = { number: null, title: null, claimedBy: null, claimSession: null, claimTimestamp: null, lastHeartbeat: null };
    state.serverOps = { restartingVite: false, restartingNest: false, restartingMt5: false, opStartedAt: null, opSession: null };
    writeState(state);
    if (was) console.log('Released claim on issue #' + was);
    else console.log('State cleared (no active claim)');
    break;
  }
  case 'heartbeat': {
    const state = readState();
    if (!state.claimedIssue.number) { console.log('No active claim'); process.exit(0); }
    state.claimedIssue.lastHeartbeat = new Date().toISOString();
    writeState(state);
    console.log('Heartbeat for #' + state.claimedIssue.number);
    break;
  }
  case 'status': {
    const state = readState();
    const ci = state.claimedIssue; const so = state.serverOps; const ss = state.issueSnapshot; const now = Date.now();
    const snapAge = ss.updatedAt ? Math.round((now - new Date(ss.updatedAt).getTime()) / 1000) : null;
    const snapFresh = snapAge !== null && snapAge < 300;
    console.log(JSON.stringify({
      claimed: ci.number !== null, issue: ci.number, title: ci.title, by: ci.claimedBy,
      heartbeatAge: ci.lastHeartbeat ? Math.round((now - new Date(ci.lastHeartbeat).getTime()) / 1000) + 's' : 'never',
      viteRestarting: so.restartingVite, nestRestarting: so.restartingNest,
      snapshotAge: snapAge !== null ? snapAge + 's' : 'none',
      snapshotFresh: snapFresh,
      snapshotCount: ss.count,
      cachedIssues: state.issueCache.entryCount
    }, null, 2));
    break;
  }
  case 'cache-snapshot': {
    let body = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => body += c);
    process.stdin.on('end', () => {
      if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(SNAPSHOT_PATH, body);
      const state = readState();
      const issues = JSON.parse(body);
      state.issueSnapshot = { updatedAt: new Date().toISOString(), count: Array.isArray(issues) ? issues.length : 0 };
      writeState(state);
      console.log('Snapshot cached: ' + state.issueSnapshot.count + ' issues');
    });
    break;
  }
  default:
    console.log('Usage:\n  node scripts/agent-claim.cjs claim <number> [title]\n  node scripts/agent-claim.cjs release\n  node scripts/agent-claim.cjs heartbeat\n  node scripts/agent-claim.cjs status\n  node scripts/agent-claim.cjs cache-snapshot  (pipe gh issue list --json)');
    process.exit(1);
}
