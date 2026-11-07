import { Injectable, Logger } from '@nestjs/common';
import { spawn, execSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';

// ── Task Definitions ─────────────────────────────────────

export interface ProcessTask {
  id: string;
  label: string;
  cwd: string;
  command: string;
  port: number;
  /** Shell command to check if the process is running (pid-based) */
  pidFile?: string;
  /**
   * What the task's REAL process has on its command line — `dist/src/main.js` for this app (#1238).
   *
   * ⚠️ DECLARED, NOT DERIVED. The obvious idea was to parse `command` for a script path, and it is
   * wrong for the only task here: `command` is `pwsh -File scripts/tcs-launch.ps1`, a LAUNCHER whose
   * command line never mentions `dist/src/main.js`. A marker derived from it matches nothing, so the
   * "second source" would silently never fire — a capability that exists and cannot be seen.
   *
   * It is also the identifier the kill path already uses (`build-api.ps1`, `tcs-stop.ps1` both hunt
   * `dist/src/main.js`), so declaring it keeps the two paths agreeing about what "the API process" is.
   *
   * Omit it when a task's process cannot be identified this way — the source then honestly reports
   * "cannot judge" instead of running a query that cannot match.
   */
  processMarker?: string;
}

export interface TaskStatus {
  id: string;
  label: string;
  running: boolean;
  port: number;
  pid: number | null;
  listenerPid: number | null;
  listenerProcess: string | null;
  /**
   * HOW `listenerPid` was attributed — `socket` is measured (the OS named the owner), `command-line`
   * is inferred (a single process runs this task's entry point, so it is almost certainly that one).
   * The distinction exists because #1238 is a bug about a status surface that could not be trusted;
   * answering with an inference that looks identical to a measurement would repeat it.
   */
  listenerSource: ListenerSource;
  issue: string | null;
  logTail: string;
}

export type ListenerSource = 'socket' | 'command-line' | null;

export const TASKS: ProcessTask[] = [
  {
    id: 'tradercore:all',
    label: 'Trading Command Suite (All Services)',
    cwd: 'C:\\wamp64\\www\\trading-command-suite',
    command: 'pwsh -File scripts/tcs-launch.ps1',
    port: 3201,
    pidFile: 'C:\\wamp64\\www\\intranet\\task-runner\\tradercore_all.pid',
    processMarker: 'dist/src/main.js',
  },
];

const LOG_DIR = 'C:\\wamp64\\www\\intranet\\task-runner';
const MAX_LOG_LINES = 25;
/**
 * How long a connect probe waits before calling a port closed (#1238). A loopback connect either
 * completes in single-digit milliseconds or is refused; 750 ms leaves room for a loaded machine
 * without making a five-port status sweep slow.
 */
const PORT_PROBE_TIMEOUT_MS = 750;

/**
 * How long a "start in flight" claim is held for one task (#1233).
 *
 * ⚠️ IT MUST OUTLIVE THE BOOT, NOT THE `spawn()` CALL. `spawn()` returns in milliseconds; the API
 * then takes 5–20 s to open its port (measured, after #1232 made the boot audits non-blocking). The
 * overlap storm happened entirely inside that gap, when a status check said "not running" about a
 * process that was already starting.
 *
 * 60 s is roughly three times the observed worst boot — deliberately generous, because the cost of
 * being wrong in this direction is one refused click, and the cost in the other direction is a
 * second boot racing the first.
 */
const STARTING_WINDOW_MS = 60_000;

@Injectable()
export class ProcessManagerService {
  private readonly logger = new Logger(ProcessManagerService.name);
  private children = new Map<string, ChildProcess>();

  // ── List all tasks with live status ──────────────────────

  async listTasks(): Promise<TaskStatus[]> {
    const results: TaskStatus[] = [];
    for (const task of TASKS) {
      results.push(await this.getTaskStatus(task));
    }
    return results;
  }

  // ── Get single task status ──────────────────────────────

  async getTaskStatus(task: ProcessTask): Promise<TaskStatus> {
    const portOpen = await this.isPortOpen(task.port);
    const existingChild = this.children.get(task.id);
    const isRunning = !!existingChild && existingChild.exitCode === null;

    // Determine if port is open
    let listenerPid: number | null = null;
    let listenerProcess: string | null = null;
    let listenerSource: ListenerSource = null;
    let issue: string | null = null;

    if (portOpen) {
      try {
        const info = this.getPortOwner(task.port);
        const chosen = chooseListenerPid(
          info.pid,
          info.pid > 0 ? [] : this.getCommandLinePids(task.processMarker),
        );
        if (chosen.pid > 0) {
          listenerPid = chosen.pid;
          listenerSource = chosen.source;
          listenerProcess = info.process ?? this.processNameOf(chosen.pid);
        }
      } catch {
        // Can't determine owner — `issue` below says so rather than reporting a clean `false`.
      }
    }

    // ── The `issue` field is how this surface says "cannot judge" (#1238) ─────────────────────────
    //
    // ⚠️ IT USED TO BE UNREACHABLE ON THIS HOST, twice over: the guard tested `&& listenerPid`, and
    // `listenerPid` was `0` — which is FALSY — whenever the owner could not be attributed. So the
    // branch was skipped and the field stayed `null`, i.e. the API answered 200 with `running: false`
    // and NO indication that anything was uncertain. A confident negative, silently.
    //
    // ⚠️ `listenerPid > 0` is the comparison, never truthiness. And when the port answers but no owner
    // can be named, that is `port_in_use_unknown_owner` — not silence.
    const portAnswersButNotOurs = portOpen && !isRunning;
    if (portAnswersButNotOurs) {
      issue = listenerPid && listenerPid > 0 ? 'port_owned_by_other_process' : 'port_in_use_unknown_owner';
    }

    const logTail = this.readLogTail(task.id);

    return {
      id: task.id,
      label: task.label,
      running: isRunning || portOpen,
      port: task.port,
      pid: existingChild?.pid ?? null,
      listenerPid,
      listenerProcess,
      listenerSource,
      issue,
      logTail,
    };
  }

  // ── Start a task ────────────────────────────────────────

  /**
   * In-flight starts, by task id (#1233).
   *
   * ⚠️ WHY A MAP AND NOT JUST THE `isPortOpen` CHECK BELOW. The port does not open until the API has
   * finished booting — measured 5–20 s now, ~107 s before #1232. In that window `isPortOpen` is
   * `false` for a process that is already starting, so a second request saw "not running" and
   * spawned a second process. Two boots then competed, and whichever `build:api` ran next killed
   * whichever had got furthest.
   *
   * ⚠️ THE ENTRY IS HELD FOR `STARTING_WINDOW_MS`, NOT JUST UNTIL `spawn()` RETURNS. `spawn()`
   * returns in milliseconds and the boot takes seconds — releasing the claim on spawn would leave the
   * whole boot unprotected, which is the exact window the storm happened in.
   */
  private readonly pendingStarts = new Map<string, { at: number; pid: number | null }>();

  async startTask(taskId: string): Promise<{ success: boolean; message: string }> {
    const task = TASKS.find((t) => t.id === taskId);
    if (!task) return { success: false, message: `Unknown task: ${taskId}` };

    // Already running?
    const existing = this.children.get(taskId);
    if (existing && existing.exitCode === null) {
      return { success: true, message: `${task.label} is already running (PID ${existing.pid})` };
    }

    // ── A start is already in flight: JOIN it, do not race it (#1233) ──────────────────────────
    //
    // The message says "already starting" and names how long it has been going, because the honest
    // answer to "did my click work?" is "someone's click did, N seconds ago" — not a second spawn.
    const pending = this.pendingStarts.get(taskId);
    if (pending) {
      const ageS = Math.round((Date.now() - pending.at) / 1000);
      return {
        success: true,
        message:
          `${task.label} is already starting (${ageS}s in` +
          `${pending.pid ? `, PID ${pending.pid}` : ''}) — joined that start rather than launching another`,
      };
    }

    // Port already open by something else?
    if (await this.isPortOpen(task.port)) {
      return { success: true, message: `${task.label} port ${task.port} is already in use (already running)` };
    }

    this.pendingStarts.set(taskId, { at: Date.now(), pid: null });
    try {
      return await this.launchTask(task);
    } finally {
      // ⚠️ Deliberately NOT cleared here. `launchTask` returns as soon as the process is spawned, and
      // the port is still closed for the whole boot. The claim is released by the timer below, or
      // early by the child's `exit` handler.
      this.scheduleStartClaimRelease(taskId);
    }
  }

  /**
   * Hold the claim for the boot, then release it.
   *
   * ⚠️ A TIMER, NOT A WAIT. `startTask` is an HTTP handler with its own timeout; blocking it for the
   * length of a boot would trade one failure mode for another. The claim only has to outlive the
   * boot, and `STARTING_WINDOW_MS` is the ceiling on that.
   */
  private scheduleStartClaimRelease(taskId: string): void {
    const entry = this.pendingStarts.get(taskId);
    const child = this.children.get(taskId);
    if (entry) entry.pid = child?.pid ?? null;

    const timer = setTimeout(() => {
      this.pendingStarts.delete(taskId);
    }, STARTING_WINDOW_MS);
    // Do not keep the process alive for a bookkeeping timer.
    if (typeof timer.unref === 'function') timer.unref();

    // If the child dies, the claim is void immediately — nothing is starting any more.
    if (child && typeof child.once === 'function') {
      child.once('exit', () => this.pendingStarts.delete(taskId));
    }
  }

  private async launchTask(task: ProcessTask): Promise<{ success: boolean; message: string }> {
    const taskId = task.id;

    const logFile = path.join(LOG_DIR, `${taskId.replace(/:/g, '_')}.pid.log`);

    try {
      const child = spawn('cmd.exe', ['/c', task.command], {
        cwd: task.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        windowsHide: true,
      });

      // Pipe stdout/stderr to log file
      const logStream = fs.createWriteStream(logFile, { flags: 'w' });
      child.stdout?.pipe(logStream);
      child.stderr?.pipe(logStream);

      child.on('error', (err) => {
        this.logger.error(`Task ${taskId} spawn error: ${err.message}`);
        fs.appendFileSync(logFile, `\n[ProcessManager] Spawn error: ${err.message}\n`);
      });

      child.on('exit', (code) => {
        this.logger.log(`Task ${taskId} exited with code ${code}`);
        fs.appendFileSync(logFile, `\n[ProcessManager] Process exited with code ${code}\n`);
        this.children.delete(taskId);
      });

      child.unref(); // Allow Node to exit independently
      this.children.set(taskId, child);

      this.logger.log(`Started task ${taskId} (PID ${child.pid})`);
      return { success: true, message: `${task.label} started (PID ${child.pid})` };
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Failed to start ${taskId}: ${msg}`);
      return { success: false, message: msg };
    }
  }

  // ── Stop a task ─────────────────────────────────────────

  async stopTask(taskId: string): Promise<{ success: boolean; message: string }> {
    const task = TASKS.find((t) => t.id === taskId);
    if (!task) return { success: false, message: `Unknown task: ${taskId}` };

    const child = this.children.get(taskId);
    if (!child || child.exitCode !== null) {
      // Try to kill by port owner
      try {
        const info = this.getPortOwner(task.port);
        if (info.pid > 0) {
          process.kill(info.pid, 'SIGTERM');
          this.children.delete(taskId);
          return { success: true, message: `Terminated process on port ${task.port} (PID ${info.pid})` };
        }
      } catch {
        // Can't kill
      }
      return { success: true, message: `${task.label} is not running` };
    }

    try {
      // Kill the process tree
      const pid = child.pid;
      if (pid) {
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { timeout: 5000 });
        } catch {
          // Process may already be dead
        }
      }
      child.kill('SIGTERM');
      this.children.delete(taskId);
      this.logger.log(`Stopped task ${taskId}`);
      return { success: true, message: `${task.label} stopped` };
    } catch (err) {
      const msg = (err as Error).message;
      return { success: false, message: msg };
    }
  }

  // ── Port Checking ───────────────────────────────────────

  /**
   * isPortOpen() — can a CLIENT reach this port? (#1238)
   *
   * ⚠️ IT USED TO BE A BIND TEST, AND A BIND TEST CANNOT ANSWER THIS QUESTION ON THIS HOST.
   * Measured 2026-11-07 with the API answering `200` on /api/health:
   *
   *     bind 127.0.0.1 -> SUCCEEDED   (looks FREE)      connect 127.0.0.1 -> CONNECTED
   *     bind ::1       -> SUCCEEDED   (looks FREE)      connect ::1       -> CONNECTED
   *     bind 0.0.0.0   -> SUCCEEDED   (looks FREE)
   *     bind ::        -> FAILED EADDRINUSE  (the only probe that saw the truth)
   *
   * The API binds the IPv6 WILDCARD (`::`), and on Windows that does not conflict with a
   * loopback-specific bind. The old code tried `127.0.0.1` FIRST, it succeeded, and it resolved
   * `false` immediately — so the `::1` fallback never ran (its `settled` flag was already set).
   * Result: `running: false` for an API that was serving, and the supervisors' `issue` field empty
   * because it was only set when `listenerPid` was truthy.
   *
   * ⚠️ A CONNECT is the right question anyway: "running" should mean "a client can use it", and a
   * connect is indifferent to which wildcard the server chose. It also closes a worse defect in
   * `startTask()` — with the bind probe reporting "free", the "already running" guard never fired,
   * so the manager would happily spawn a SECOND API on a port that was already served.
   */
  private isPortOpen(port: number): Promise<boolean> {
    const probe = (host: string): Promise<boolean> =>
      new Promise((resolve) => {
        const socket = net.connect({ host, port });
        const finish = (open: boolean) => {
          socket.removeAllListeners();
          socket.destroy();
          resolve(open);
        };
        socket.setTimeout(PORT_PROBE_TIMEOUT_MS, () => finish(false));
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
      });

    return (async () => {
      // Both loopback families: a server bound to `::` answers on 127.0.0.1 too (dual-stack),
      // but a server bound to `0.0.0.0` answers ONLY on 127.0.0.1 — hence both, not a fallback.
      if (await probe('127.0.0.1')) return true;
      return probe('::1');
    })();
  }

  // ── Port Owner Detection (Windows) ──────────────────────

  /**
   * getPortOwner() — which pid is serving this port, and what is it? (#1238)
   *
   * ⚠️ TWO TIERS, because on this host `netstat` DOES NOT SHOW THE LISTENER. Measured 2026-11-07 with
   * the API serving on 3201: `netstat -ano | findstr :3201` returned 25 rows, ALL of them client
   * sockets (TIME_WAIT / FIN_WAIT_2), and **not one row** for the bound `[::]:3201`. The old code
   * filtered for the literal string `LISTENING`, so it matched nothing, returned `{ pid: 0 }`, and the
   * status surface reported a healthy API with an empty `issue`.
   *
   * `Get-NetTCPConnection` DOES see it — as the row with NO REMOTE PEER (`[::]:3201 -> [::]:0`,
   * `OwningProcess 23540`), which is the only reliable discriminator here: the `State` column is blank
   * for the node listener and, where the Python bridges report `Listen` rows at all, every one of them
   * carries `OwningProcess = 0`.
   *
   * So: cheap netstat first (correct on machines where it behaves), PowerShell only when that finds no
   * listener — which is the normal case here.
   */
  private getPortOwner(port: number): { pid: number; process: string | null } {
    const fromNetstat = this.getPortOwnerFromNetstat(port);
    if (fromNetstat.pid > 0) return { pid: fromNetstat.pid, process: this.processNameOf(fromNetstat.pid) };
    const fromPowershell = this.getPortOwnerFromPowershell(port);
    if (fromPowershell > 0) return { pid: fromPowershell, process: this.processNameOf(fromPowershell) };
    return { pid: 0, process: null };
  }

  /**
   * The netstat tier. A listener row is one whose FOREIGN address is a zero address — `0.0.0.0:0` or
   * `[::]:0` — whatever its state column says. Filtering on the literal `LISTENING` was the bug: this
   * host omits the state entirely for the node listener AND omits the row.
   */
  private getPortOwnerFromNetstat(port: number): { pid: number } {
    try {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', timeout: 3000 });
      const rows = output.split(/\r?\n/).filter((l) => l.trim().length > 0);
      for (const row of rows) {
        const cols = row.trim().split(/\s+/);
        // TCP  <local>  <foreign>  [state]  <pid>
        if (cols.length < 4) continue;
        const foreign = cols[2];
        if (!/:0$/.test(foreign)) continue;
        const pid = parseInt(cols[cols.length - 1], 10);
        if (Number.isFinite(pid) && pid > 0) return { pid };
      }
      return { pid: 0 };
    } catch {
      return { pid: 0 };
    }
  }

  /**
   * The PowerShell tier — the one that actually works on this host. Returns 0 when no attributable
   * owner exists (which is "cannot judge", NOT "nothing is listening": the caller decides liveness
   * from the connect probe, never from this).
   */
  private getPortOwnerFromPowershell(port: number): number {
    try {
      const script =
        `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ` +
        `Where-Object { $_.RemotePort -eq 0 -and $_.OwningProcess -gt 0 } | ` +
        `Select-Object -First 1 -ExpandProperty OwningProcess`;
      const out = execSync(`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`, {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      const pid = parseInt(out, 10);
      return Number.isFinite(pid) && pid > 0 ? pid : 0;
    } catch {
      return 0;
    }
  }

  private processNameOf(pid: number): string | null {
    try {
      const tasklist = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8', timeout: 3000 });
      const match = tasklist.match(/"([^"]+)"/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  /**
   * The SECOND, INDEPENDENT source for "which process is this task?" (#1238, criterion 2).
   *
   * ⚠️ WHY THIS EXISTS. The socket tier answers "who holds the port?". That is the right question
   * right up until the OS will not name the owner — which was the whole of #1238, where the listener
   * existed, served HTTP, and could not be attributed. Asking the SAME question twice ("who holds
   * the port?") in two ways does not help when the answer is unavailable; asking a DIFFERENT question
   * does. The task's entry point is a property of the process, not of the socket.
   *
   * ⚠️ ONLY CALLED WHEN THE SOCKET TIER FOUND NOBODY. It spawns PowerShell (~300-600 ms) and a task
   * list call would pay that per task for information the socket already gave.
   *
   * ⚠️ SELF IS EXCLUDED BY PID. The API's own command line IS `node dist/src/main.js`, so without the
   * exclusion this method always finds itself — and when a SECOND instance is the real owner, that
   * makes two matches and turns a knowable answer into "ambiguous".
   *
   * Returns [] when there is no marker, when nothing matches, or when the query fails. The caller
   * cannot distinguish those, and does not need to: all three mean "no second opinion available".
   */
  private getCommandLinePids(marker: string | undefined): number[] {
    if (!marker) return [];
    try {
      const ps =
        `Get-CimInstance Win32_Process | ` +
        `Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -and ` +
        `$_.CommandLine.Replace('\\','/') -like '*${marker}*' } | ` +
        `ForEach-Object { $_.ProcessId }`;
      const out = execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, {
        encoding: 'utf8',
        timeout: 8000,
      });
      return out
        .split(/\r?\n/)
        .map((l) => parseInt(l.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
    } catch {
      return [];
    }
  }

  // ── Log Reading ─────────────────────────────────────────

  private readLogTail(taskId: string): string {
    const logFile = path.join(LOG_DIR, `${taskId.replace(/:/g, '_')}.pid.log`);
    try {
      if (!fs.existsSync(logFile)) return '';
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      const tail = lines.slice(-MAX_LOG_LINES);
      // Strip ANSI colour codes for clean display
      return tail.map((l) => l.replace(/\x1b\[[0-9;]*m/g, '')).join('\n');
    } catch {
      return '';
    }
  }
}

// ── Pure helper — the decision, separated from the shell ────────────────────────────────────────
//
// Exported so a test can exercise the choice without a real socket or a real OS. #1238's test
// criterion is "a fake 'port answers, no listener row' state must NOT render as running: false",
// and that is a statement about THIS function, not about anything PowerShell returns.

/**
 * chooseListenerPid() — measured beats inferred, and AMBIGUITY IS NOT A RESULT.
 *
 * ⚠️ Two matches means two processes run this entry point (a rebuild that left an older instance
 * alive, or two ports on one script). Picking the first would be a guess wearing a pid's clothes, and
 * that guess would then be used to decide whether to start a THIRD. So: ambiguous → `{ pid: 0 }`, and
 * the caller reports `port_in_use_unknown_owner`, which is the honest answer.
 */
export function chooseListenerPid(
  socketPid: number,
  commandLinePids: number[],
): { pid: number; source: ListenerSource } {
  if (socketPid > 0) return { pid: socketPid, source: 'socket' };
  const distinct = [...new Set(commandLinePids.filter((p) => p > 0))];
  if (distinct.length === 1) return { pid: distinct[0], source: 'command-line' };
  return { pid: 0, source: null };
}
