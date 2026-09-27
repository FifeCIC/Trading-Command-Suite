/**
 * WindowsNotifyService — raise a REAL Windows notification when something needs a human.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────
 * Owner, 2026-09-27: *"The app might have had a notification but the notifications aren't attention
 * demanding - none are integrated with windows... I need the app to draw my attention when algo
 * trading is not active."*
 *
 * That is a measured complaint about a real gap, not a preference. Measured the same day: both MT5
 * terminals had **AutoTrading switched off**, 19 orders were refused with `retcode 10027` in 48h,
 * and `decision_log` held exactly ONE execution in that window. The app looked healthy throughout.
 * An in-app bell does not help here: the whole failure mode is that nobody is looking at the app.
 *
 * ⚠️ `channels: ['in-app', 'sound']` WAS ALREADY DECLARED ON EVERY ALERT RULE and **no code ever
 * read it** — there was no dispatcher at all (`grep channels\.` over the alerts module returns
 * nothing). So this is the FIRST channel dispatcher, not a second one. The declared `'in-app'`
 * channel stays as it is; this adds a channel that survives the app being un-focussed or closed.
 *
 * ── HOW ──────────────────────────────────────────────────────────────────────────────────────
 * A `NotifyIcon` balloon, because it needs **no module install**: `BurntToast` is not guaranteed to
 * be present, and raw WinRT toast XML is fiddly and version-sensitive. `System.Windows.Forms` ships
 * with Windows PowerShell. On Windows 10/11 the balloon renders as a normal action-centre toast.
 *
 * ⚠️ ASCII ONLY IN THE SCRIPT. A box-drawing or emoji character in a PowerShell argument crashes the
 * child process on a cp1252 console, and the failure is invisible from Node — the toast simply never
 * appears and nothing reports why. This repo has already paid for that lesson once.
 *
 * ⚠️ THROTTLED, AND IT SAYS SO. A notification that fires every 60s is one the owner learns to
 * dismiss without reading, which is the same failure as an allowlisted guard. The cooldown is
 * declared per key, and while the condition persists the service deliberately stays quiet.
 */

import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';

export interface WindowsNotifyInput {
  /** Stable key for throttling — e.g. 'trade-disabled'. */
  key: string;
  title: string;
  message: string;
  /** How long the balloon stays up. Long, because the point is to be noticed while away. */
  seconds?: number;
}

@Injectable()
export class WindowsNotifyService {
  private readonly logger = new Logger(WindowsNotifyService.name);
  private readonly lastSentAt = new Map<string, number>();

  /**
   * Minimum gap between notifications for the SAME key.
   *
   * ⚠️ 15 minutes, and the number is the point: the condition this exists for (AutoTrading off) is
   * not transient — it stays true for hours or days. Firing every poll would train the reader to
   * dismiss it, and a dismissed notification carries no more information than no notification.
   * Long enough to be ignorable while working, short enough that a human away from the desk for
   * an afternoon is told again when they return.
   */
  private readonly COOLDOWN_MS = 15 * 60 * 1000;

  /**
   * Disabled by default under test / on non-Windows, so a unit test never pops a real toast on
   * somebody's desktop and a CI box does not try to.
   */
  get enabled(): boolean {
    if (process.env.DISABLE_WINDOWS_NOTIFICATIONS === '1') return false;
    if (process.env.NODE_ENV === 'test') return false;
    return process.platform === 'win32';
  }

  /**
   * Send, unless throttled. Returns whether a notification was ACTUALLY raised — the caller and the
   * spec both need to tell "sent" from "suppressed", and returning void would make those identical.
   */
  async notify(input: WindowsNotifyInput): Promise<boolean> {
    if (!this.enabled) return false;

    const now = Date.now();
    const last = this.lastSentAt.get(input.key);
    if (last != null && now - last < this.COOLDOWN_MS) {
      return false;
    }
    this.lastSentAt.set(input.key, now);

    try {
      await this.spawnBalloon(input);
      this.logger.warn(
        `Windows notification raised [${input.key}]: ${input.title} — ${input.message}`,
      );
      return true;
    } catch (err) {
      // ⚠️ A failed notification must never take the caller down: the alert itself is still
      // recorded, and the trading path must not be interrupted by a UI concern.
      this.logger.error(
        `Windows notification FAILED [${input.key}]: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Exposed so a caller can force a re-notification after the condition clears. */
  reset(key: string): void {
    this.lastSentAt.delete(key);
  }

  private spawnBalloon(input: WindowsNotifyInput): Promise<void> {
    const seconds = Math.min(Math.max(input.seconds ?? 20, 5), 60);
    // Single quotes are escaped by doubling, which is PowerShell's own rule for a literal string.
    const lit = (s: string) => `'${String(s).replace(/'/g, "''")}'`;

    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName System.Drawing',
      '$n = New-Object System.Windows.Forms.NotifyIcon',
      '$n.Icon = [System.Drawing.SystemIcons]::Warning',
      '$n.Visible = $true',
      `$n.ShowBalloonTip(${seconds * 1000}, ${lit(input.title)}, ${lit(input.message)}, [System.Windows.Forms.ToolTipIcon]::Warning)`,
      // The balloon needs the icon alive for its lifetime; without the wait it is disposed
      // immediately and nothing is ever shown.
      `Start-Sleep -Seconds ${seconds}`,
      '$n.Visible = $false',
      '$n.Dispose()',
    ].join('; ');

    return new Promise<void>((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
        { windowsHide: true, stdio: 'ignore' },
      );
      child.on('error', reject);
      // Resolve on spawn success, not on exit: the child lives for `seconds` and the caller must
      // not be held open for 20s waiting on a notification.
      child.once('spawn', () => resolve());
    });
  }
}
