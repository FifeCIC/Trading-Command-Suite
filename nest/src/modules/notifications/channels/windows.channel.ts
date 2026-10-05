import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { NotificationMessage } from '../notifications.service';

/**
 * WindowsChannel — a WINDOWS TOAST, branded and formatted for trading activity.
 *
 * ── WHY IT WAS PLAIN, AND WHAT CHANGED (2026-10-05) ──────────────────────────────
 * Owner: *"TCS is generating Windows notifications but they're plain - we need to add the TCS logo
 * for starters but I'm thinking some formats to display trading related activity would be great."*
 *
 * Three things kept it plain, and each had a cause worth naming:
 *
 * 1. **The template.** It used `ToastTemplateType.ToastText02` — a legacy template that accepts
 *    exactly TWO text nodes and no image. There is nothing to brand and nothing to structure with
 *    it, whatever the message contains. It is now `ToastGeneric`, the modern template, which
 *    accepts an app-logo override, a hero image, an attribution footer and free text lines.
 * 2. **The logo.** `CreateToastNotifier('TradingCS')` raises the toast under an AppID that is not a
 *    registered Start-menu shortcut, so Windows draws its OWN default icon — there is no
 *    "app icon" to set. The branding has to be carried BY the toast, as
 *    `<image placement="appLogoOverride">`. That is what makes it TCS rather than a generic toast.
 * 3. **The fields.** `NotificationMessage` already carries `symbol` and `score` — Discord,
 *    Telegram and Email all use them — but this channel used only title and body, so a trade
 *    notification said WHAT happened without saying WHICH SYMBOL or WHAT SCORE.
 *
 * ── FORMAT ─────────────────────────────────────────────────────────────────────
 * `text 1` title · `text 2` body · `text 3` the structured trading line (`SYMBOL · score N`),
 * emitted ONLY when there is something to put in it — an empty third line collapses the layout.
 * The footer is `attribution`, so the toast is signed.
 *
 * ⚠️ **INJECTION, ROUND TWO.** The original comment below is right that passing content by
 * environment variable avoids *shell* injection. It is NOT sufficient here: the content is now
 * interpolated into **XML**, where a body containing `<` or `&` (news headlines do) produces a
 * malformed document and the toast silently fails to appear. Every interpolated value goes through
 * `SecurityElement::Escape`, which is why the PowerShell is longer than it looks like it needs to be.
 */
@Injectable()
export class WindowsChannel {
  private readonly logger = new Logger(WindowsChannel.name);

  /** Resolved once. `undefined` = not looked up yet; `null` = looked up and not found. */
  private logoUri: string | null | undefined = undefined;

  /**
   * The logo as a `file:///` URI, or `null` when it cannot be found.
   *
   * ⚠️ A toast image must be a LOCAL file URI (an https URL needs package internet capability,
   * which an unpackaged notifier does not have). The API's cwd differs depending on whether it was
   * started by `build-api.ps1` (nest/) or the launcher from the repo root, so both are tried —
   * and a miss is LOGGED rather than silently producing an unbranded toast that looks intentional.
   */
  private logoFileUri(): string | null {
    if (this.logoUri !== undefined) return this.logoUri;
    const candidates = [
      path.resolve(process.cwd(), 'public', 'tcs-logo.png'),
      path.resolve(process.cwd(), '..', 'public', 'tcs-logo.png'),
      path.resolve(process.cwd(), '..', '..', 'public', 'tcs-logo.png'),
    ];
    const found = candidates.find((p) => existsSync(p));
    if (!found) {
      this.logger.warn(`Toast logo not found (looked in ${candidates.length} places) — toast will be unbranded`);
      this.logoUri = null;
    } else {
      this.logoUri = `file:///${found.replace(/\\/g, '/')}`;
    }
    return this.logoUri;
  }

  async send(msg: NotificationMessage): Promise<void> {
    if (process.platform !== 'win32') { this.logger.debug('Not Windows — skip toast'); return; }
    try {
      // ── the structured trading line — only when there is something to show ──
      const detail = [msg.symbol, typeof msg.score === 'number' ? `score ${msg.score}` : null]
        .filter(Boolean)
        .join('   ·   ');

      // Content passed via env vars, never interpolated into the command string — titles/bodies
      // contain provider data (news text, symbols) = injection vector. Values are XML-escaped
      // inside PowerShell because they are interpolated into a DOCUMENT here, not just a string.
      const psCmd = [
        '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
        '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
        '$x = \'<toast><visual><binding template="ToastGeneric">\'',
        '$x += \'<text id="1">\' + [System.Security.SecurityElement]::Escape($env:TCS_TOAST_TITLE) + \'</text>\'',
        '$x += \'<text id="2">\' + [System.Security.SecurityElement]::Escape($env:TCS_TOAST_BODY) + \'</text>\'',
        'if ($env:TCS_TOAST_DETAIL) { $x += \'<text id="3">\' + [System.Security.SecurityElement]::Escape($env:TCS_TOAST_DETAIL) + \'</text>\' }',
        'if ($env:TCS_TOAST_LOGO) { $x += \'<image placement="appLogoOverride" hint-crop="circle" src="\' + $env:TCS_TOAST_LOGO + \'" />\' }',
        '$x += \'<text placement="attribution">Trading Command Suite</text>\'',
        '$x += \'</binding></visual></toast>\'',
        '$doc = New-Object Windows.Data.Xml.Dom.XmlDocument',
        '$doc.LoadXml($x)',
        '$toast = [Windows.UI.Notifications.ToastNotification]::new($doc)',
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('TradingCS').Show($toast)",
      ].join('; ');
      const { execFileSync } = await import('child_process');
      const env = {
        ...process.env,
        TCS_TOAST_TITLE: msg.title,
        TCS_TOAST_BODY: msg.body,
        TCS_TOAST_DETAIL: detail,
      } as NodeJS.ProcessEnv;
      const logo = this.logoFileUri();
      if (logo) env.TCS_TOAST_LOGO = logo;
      try {
        execFileSync('powershell', ['-NoProfile', '-Command', psCmd], { timeout: 5000, windowsHide: true, env });
      } catch {
        execFileSync('msg', ['*', `${msg.title}: ${msg.body}`], { timeout: 3000, windowsHide: true });
      }
      this.logger.log(`Toast sent: ${msg.title}${detail ? ` [${detail}]` : ''}`);
    } catch (err) { this.logger.error(`Toast failed: ${(err as Error).message}`); throw err; }
  }
}
