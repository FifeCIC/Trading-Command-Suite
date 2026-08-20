import { Injectable, Logger } from '@nestjs/common';
import type { NotificationMessage } from '../notifications.service';

@Injectable()
export class WindowsChannel {
  private readonly logger = new Logger(WindowsChannel.name);

  async send(msg: NotificationMessage): Promise<void> {
    if (process.platform !== 'win32') { this.logger.debug('Not Windows — skip toast'); return; }
    try {
      // Content passed via env vars, never interpolated into the command string —
      // titles/bodies contain provider data (news text, symbols) = injection vector.
      const psCmd = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; $tpl = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $ns = $tpl.GetElementsByTagName('text'); $ns.Item(0).AppendChild($tpl.CreateTextNode($env:TCS_TOAST_TITLE)) > $null; $ns.Item(1).AppendChild($tpl.CreateTextNode($env:TCS_TOAST_BODY)) > $null; $toast = [Windows.UI.Notifications.ToastNotification]::new($tpl); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('TradingCS').Show($toast)`;
      const { execFileSync } = await import('child_process');
      const env = { ...process.env, TCS_TOAST_TITLE: msg.title, TCS_TOAST_BODY: msg.body };
      try {
        execFileSync('powershell', ['-NoProfile', '-Command', psCmd], { timeout: 5000, windowsHide: true, env });
      } catch {
        execFileSync('msg', ['*', `${msg.title}: ${msg.body}`], { timeout: 3000, windowsHide: true });
      }
      this.logger.log(`Toast sent: ${msg.title}`);
    } catch (err) { this.logger.error(`Toast failed: ${(err as Error).message}`); throw err; }
  }
}
