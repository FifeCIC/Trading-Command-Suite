/**
 * process-manager.status.spec.ts — a serving API must not read as `running: false` (#1238).
 *
 * ⚠️ THE MEASURED FAILURE. Both supervisors reported `running: false` (with a blank `pid` and an
 * EMPTY `issue`) while `curl :3201/api/health` returned `200`. Two independent causes:
 *
 *   1. `isPortOpen()` was a BIND test on `127.0.0.1` first. The API binds the IPv6 wildcard `::`;
 *      on Windows that does not conflict with a loopback bind, so the bind SUCCEEDED and the probe
 *      resolved "free" before its `::1` fallback ever ran. Measured: bind 127.0.0.1 / ::1 / 0.0.0.0
 *      all SUCCEEDED while `bind ::` failed EADDRINUSE and a CONNECT succeeded on both loopbacks.
 *   2. `getPortOwner()` filtered netstat for the literal `LISTENING`. This host omits that row for
 *      the node listener entirely (25 rows on 3201, every one a client socket), so it returned
 *      `{ pid: 0 }`; the `issue` guard then tested `&& listenerPid`, and `0` is FALSY, so the
 *      branch was skipped and the field stayed `null`.
 *
 * These tests pin the RESULT — "the port answers, so running is true and uncertainty is named" —
 * rather than the internals, so a future rewrite that reintroduces either defect fails here.
 */
import { ProcessManagerService, chooseListenerPid, TASKS } from './process-manager.service';

/** A service whose probes are stubbed, so the decision can be exercised without a real socket. */
function makeService(over: {
  portOpen: boolean;
  ownerPid?: number;
  ownerProcess?: string | null;
  cmdPids?: number[];
}) {
  const service = new ProcessManagerService();
  const anyService = service as unknown as Record<string, unknown>;
  anyService.isPortOpen = async () => over.portOpen;
  anyService.getPortOwner = () => ({ pid: over.ownerPid ?? 0, process: over.ownerProcess ?? null });
  anyService.getCommandLinePids = () => over.cmdPids ?? [];
  anyService.readLogTail = () => '';
  (anyService.logger as Record<string, () => void>) = {
    log: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  };
  return service;
}

const TASK = {
  id: 'tradercore:all',
  label: 'Trading Command Suite (All Services)',
  cwd: 'C:\\wamp64\\www\\trading-command-suite',
  command: 'pwsh -File scripts/tcs-launch.ps1',
  port: 3201,
  processMarker: 'dist/src/main.js',
};

describe('an answering port is RUNNING, and uncertainty is always named (#1238)', () => {
  it('port answers, owned by another process → running true, issue names the owner', async () => {
    const s = makeService({ portOpen: true, ownerPid: 23540, ownerProcess: 'node.exe' });
    const status = await s.getTaskStatus(TASK as never);
    expect(status.running).toBe(true);
    expect(status.listenerPid).toBe(23540);
    expect(status.listenerProcess).toBe('node.exe');
    expect(status.issue).toBe('port_owned_by_other_process');
  });

  // ── the exact shape of the measured defect ────────────────────────────────────────────────────
  it('port answers but the owner CANNOT be named → running true and issue is NOT empty', async () => {
    const s = makeService({ portOpen: true, ownerPid: 0, ownerProcess: null });
    const status = await s.getTaskStatus(TASK as never);
    expect(status.running).toBe(true);
    // ⚠️ `0` is falsy. Testing `&& listenerPid` is what left this field null while the API served.
    expect(status.issue).toBe('port_in_use_unknown_owner');
  });

  it('port closed and no child → running false, and NO issue (nothing is uncertain)', async () => {
    const s = makeService({ portOpen: false });
    const status = await s.getTaskStatus(TASK as never);
    expect(status.running).toBe(false);
    expect(status.issue).toBeNull();
  });

  it('a task we started ourselves is running with no issue, even with an owner present', async () => {
    const s = makeService({ portOpen: true, ownerPid: 4242, ownerProcess: 'node.exe' });
    const anyService = s as unknown as Record<string, unknown>;
    anyService.children = new Map([['tradercore:all', { exitCode: null, pid: 4242 }]]);
    const status = await s.getTaskStatus(TASK as never);
    expect(status.running).toBe(true);
    expect(status.pid).toBe(4242);
    // Our own child serving the port is the normal case, not a conflict.
    expect(status.issue).toBeNull();
  });
});

/**
 * #1238 criterion 2 — a second, INDEPENDENT source. Asking "who holds the port?" twice does not help
 * when the OS will not answer; asking about the task's own entry point does.
 */
describe('the second source: command line, and what it may NOT do', () => {
  it('attributes a single command-line match when the socket cannot name the owner', async () => {
    const s = makeService({ portOpen: true, ownerPid: 0, cmdPids: [44568] });
    const status = await s.getTaskStatus(TASK as never);
    expect(status.running).toBe(true);
    expect(status.listenerPid).toBe(44568);
    // ⚠️ An inference must not be indistinguishable from a measurement — that is #1238's own defect.
    expect(status.listenerSource).toBe('command-line');
    expect(status.issue).toBe('port_owned_by_other_process');
  });

  it('a socket-measured pid is labelled socket, and wins over the command line', async () => {
    const s = makeService({ portOpen: true, ownerPid: 23540, ownerProcess: 'node.exe', cmdPids: [999] });
    const status = await s.getTaskStatus(TASK as never);
    expect(status.listenerPid).toBe(23540);
    expect(status.listenerSource).toBe('socket');
  });

  // ⚠️ THE GUESS THIS REFUSES TO MAKE. Two matches means a leftover instance or two ports on one
  // script — and this pid is then used to decide whether to start a THIRD process.
  it('TWO command-line matches is "cannot judge", never the first one', async () => {
    const s = makeService({ portOpen: true, ownerPid: 0, cmdPids: [111, 222] });
    const status = await s.getTaskStatus(TASK as never);
    expect(status.running).toBe(true);
    expect(status.listenerPid).toBeNull();
    expect(status.listenerSource).toBeNull();
    expect(status.issue).toBe('port_in_use_unknown_owner');
  });

  it('chooseListenerPid: socket > single command-line > ambiguity > nothing', () => {
    expect(chooseListenerPid(7, [])).toEqual({ pid: 7, source: 'socket' });
    expect(chooseListenerPid(0, [9])).toEqual({ pid: 9, source: 'command-line' });
    // the same pid reported twice is ONE process, not two
    expect(chooseListenerPid(0, [9, 9])).toEqual({ pid: 9, source: 'command-line' });
    expect(chooseListenerPid(0, [9, 10])).toEqual({ pid: 0, source: null });
    expect(chooseListenerPid(0, [])).toEqual({ pid: 0, source: null });
    // pid 0 is never a process
    expect(chooseListenerPid(0, [0])).toEqual({ pid: 0, source: null });
  });

  // ⚠️ THE CAPABILITY THIS REPLACED. The first version DERIVED the marker from `command`, which is
  // `pwsh -File scripts/tcs-launch.ps1` — a launcher whose command line never mentions
  // `dist/src/main.js`. The derived marker matched nothing, so the second source existed and could
  // never fire. A test that only checked the string parsing would have passed while the feature was
  // dead; this one checks that a marker-less task is honest about having no second opinion.
  it('a task with NO declared marker reports "cannot judge" rather than a confident negative', async () => {
    const s = makeService({ portOpen: true, ownerPid: 0, cmdPids: [] });
    const status = await s.getTaskStatus({ ...TASK, processMarker: undefined } as never);
    expect(status.running).toBe(true);
    expect(status.listenerPid).toBeNull();
    expect(status.issue).toBe('port_in_use_unknown_owner');
  });

  it('the real task declares the marker the kill path already uses', () => {
    // ⚠️ Reads the REAL table, not the local fixture — a fixture would have asserted the test's own
    // copy and passed while the shipped task had no marker and no second source.
    const task = TASKS.find((t) => t.id === 'tradercore:all');
    expect(task?.processMarker).toBe('dist/src/main.js');
  });

  it('the declared marker is the one handed to the query', async () => {
    const s = makeService({ portOpen: true, ownerPid: 0 });
    const anyService = s as unknown as Record<string, unknown>;
    const spy = jest.fn(() => [44568]);
    anyService.getCommandLinePids = spy;
    const status = await s.getTaskStatus(TASK as never);
    expect(spy).toHaveBeenCalledWith('dist/src/main.js');
    expect(status.listenerPid).toBe(44568);
  });
});

/**
 * #1233 — an in-flight start is JOINED, not raced.
 *
 * ⚠️ THE WINDOW THIS PROTECTS. `spawn()` returns in milliseconds but the port stays closed for the
 * whole boot (5–20 s after #1232, ~107 s before). A status check taken inside that gap says "not
 * running" about a process that IS starting, so a second request spawned a second process. Two boots
 * competed and the next `build:api` killed whichever had got furthest — which read as "the API keeps
 * crashing with exit -1".
 */
describe('startTask joins an in-flight start (#1233)', () => {
  it('a second start while one is in flight does not launch again', async () => {
    const s = makeService({ portOpen: false });
    const anyService = s as unknown as Record<string, unknown>;
    const launch = jest.fn(async () => ({ success: true, message: 'spawned' }));
    anyService.launchTask = launch;
    anyService.pendingStarts = new Map([['tradercore:all', { at: Date.now() - 7000, pid: 4242 }]]);

    const r = await s.startTask('tradercore:all');

    expect(launch).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.message).toContain('already starting');
    // ⚠️ It must say HOW LONG, or a reader cannot tell a fresh click from a stuck one.
    expect(r.message).toMatch(/[6-8]s in/);
    expect(r.message).toContain('4242');
  });

  it('with no claim in flight it launches exactly once', async () => {
    const s = makeService({ portOpen: false });
    const anyService = s as unknown as Record<string, unknown>;
    const launch = jest.fn(async () => ({ success: true, message: 'spawned' }));
    anyService.launchTask = launch;
    await s.startTask('tradercore:all');
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('an already-running child is reported as running, not as starting', async () => {
    const s = makeService({ portOpen: true });
    const anyService = s as unknown as Record<string, unknown>;
    anyService.children = new Map([['tradercore:all', { exitCode: null, pid: 99 }]]);
    const r = await s.startTask('tradercore:all');
    expect(r.message).toContain('already running');
    expect(r.message).not.toContain('already starting');
  });
});