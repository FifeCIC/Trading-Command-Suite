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
}

export interface TaskStatus {
  id: string;
  label: string;
  running: boolean;
  port: number;
  pid: number | null;
  listenerPid: number | null;
  listenerProcess: string | null;
  issue: string | null;
  logTail: string;
}

const TASKS: ProcessTask[] = [
  {
    id: 'tradercore:react',
    label: 'Trading Command Suite (Frontend)',
    cwd: 'C:\\wamp64\\www\\trading-command-suite',
    command: 'npm run dev',
    port: 5173,
    pidFile: 'C:\\wamp64\\www\\intranet\\task-runner\\tradercore_react.pid',
  },
  {
    id: 'tradercore:api:3201',
    label: 'Trading Command Suite (API)',
    cwd: 'C:\\wamp64\\www\\trading-command-suite\\nest',
    command: 'npm run start:dev',
    port: 3201,
    pidFile: 'C:\\wamp64\\www\\intranet\\task-runner\\tradercore_api_3201.pid',
  },
  {
    id: 'tradercore:mt5-bridge',
    label: 'Trading Command Suite (MT5 Bridge)',
    cwd: process.env.MT5_BRIDGE_CWD || 'C:\\wamp64\\www\\trading-command-suite\\scripts\\mt5-bridge',
    command: `"${process.env.MT5_PYTHON_PATH || 'python'}" ${process.env.MT5_BRIDGE_SCRIPT || 'mt5_bridge.py'}`,
    port: 5000,
    pidFile: 'C:\\wamp64\\www\\intranet\\task-runner\\tradercore_mt5-bridge.pid',
  },
];

const LOG_DIR = 'C:\\wamp64\\www\\intranet\\task-runner';
const MAX_LOG_LINES = 25;

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
    let issue: string | null = null;

    if (portOpen) {
      try {
        const info = this.getPortOwner(task.port);
        listenerPid = info.pid;
        listenerProcess = info.process;
      } catch {
        // Can't determine owner
      }
    }

    // Only flag port issues if the task is NOT running under our management
    if (!isRunning && portOpen && listenerPid) {
      if (listenerPid > 0) {
        issue = 'port_owned_by_other_process';
      } else {
        issue = 'port_in_use_unknown_owner';
      }
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
      issue,
      logTail,
    };
  }

  // ── Start a task ────────────────────────────────────────

  async startTask(taskId: string): Promise<{ success: boolean; message: string }> {
    const task = TASKS.find((t) => t.id === taskId);
    if (!task) return { success: false, message: `Unknown task: ${taskId}` };

    // Already running?
    const existing = this.children.get(taskId);
    if (existing && existing.exitCode === null) {
      return { success: true, message: `${task.label} is already running (PID ${existing.pid})` };
    }

    // Port already open by something else?
    if (await this.isPortOpen(task.port)) {
      return { success: true, message: `${task.label} port ${task.port} is already in use (already running)` };
    }

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

  private isPortOpen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      // Try IPv4 first, then IPv6
      let settled = false;
      const tryListen = (host: string) => {
        if (settled) return;
        const server = net.createServer();
        server.once('error', () => {
          if (!settled) { settled = true; resolve(true); }
        });
        server.once('listening', () => {
          server.close(() => {
            if (!settled) { settled = true; resolve(false); }
          });
        });
        try {
          server.listen(port, host);
        } catch {
          if (!settled) { settled = true; resolve(true); }
        }
      };
      tryListen('127.0.0.1');
      // Also try IPv6 after a short delay if IPv4 reports free
      setTimeout(() => {
        if (!settled) tryListen('::1');
      }, 100);
    });
  }

  // ── Port Owner Detection (Windows) ──────────────────────

  private getPortOwner(port: number): { pid: number; process: string | null } {
    try {
      const output = execSync(`netstat -ano | findstr :${port}`, {
        encoding: 'utf8',
        timeout: 3000,
      });
      const lines = output.trim().split('\n').filter((l) => l.includes('LISTENING'));
      if (lines.length === 0) return { pid: 0, process: null };

      const parts = lines[0].trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1], 10);
      if (!pid) return { pid: 0, process: null };

      let processName: string | null = null;
      try {
        const tasklist = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
          encoding: 'utf8',
          timeout: 3000,
        });
        const match = tasklist.match(/"([^"]+)"/);
        if (match) processName = match[1];
      } catch {
        // Can't get process name
      }

      return { pid, process: processName };
    } catch {
      return { pid: 0, process: null };
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
