import { Injectable, Logger } from '@nestjs/common';
import type { NotificationMessage } from '../notifications.service';

@Injectable()
export class WindowsChannel {
  private readonly logger = new Logger(WindowsChannel.name);

  async send(msg: NotificationMessage): Promise<void> {
    if (process.platform !== 'win32') { this.logger.debug('Not Windows — skip toast'); return; }
    try {
      const title = msg.title.replace(/'/g, "''");
      const body = msg.body.replace(/'/g, "''");
      const psCmd = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; $tpl = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $ns = $tpl.GetElementsByTagName('text'); $ns.Item(0).AppendChild($tpl.CreateTextNode('${title}')) > $null; $ns.Item(1).AppendChild($tpl.CreateTextNode('${body}')) > $null; $toast = [Windows.UI.Notifications.ToastNotification]::new($tpl); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('TradingCS').Show($toast)`;
      const { execSync } = await import('child_process');
      try { execSync(`powershell -NoProfile -Command "${psCmd.replace(/"/g, '\\"')}"`, { timeout: 5000, windowsHide: true }); }
      catch { execSync(`msg * "${title}: ${body}"`, { timeout: 3000, windowsHide: true }); }
      this.logger.log(`Toast sent: ${msg.title}`);
    } catch (err) { this.logger.error(`Toast failed: ${(err as Error).message}`); throw err; }
  }
}
