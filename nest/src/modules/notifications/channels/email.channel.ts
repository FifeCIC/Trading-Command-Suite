import { Injectable, Logger } from '@nestjs/common';
import type { NotificationMessage } from '../notifications.service';

/**
 * Email notification channel using SMTP.
 * Rate-limited to 1 email per 15 minutes.
 */
@Injectable()
export class EmailChannel {
  private readonly logger = new Logger(EmailChannel.name);

  private get host() { return process.env.NOTIFICATION_EMAIL_HOST || ''; }
  private get user() { return process.env.NOTIFICATION_EMAIL_USER || ''; }
  private get pass() { return process.env.NOTIFICATION_EMAIL_PASS || ''; }
  private get to() { return process.env.NOTIFICATION_EMAIL_TO || ''; }

  async send(msg: NotificationMessage): Promise<void> {
    if (!this.host || !this.user || !this.pass || !this.to) {
      this.logger.debug('Email not configured — skipping');
      return;
    }
    const subject = `[TradingCS] ${msg.title}`;
    const body = this.buildBody(msg);
    try {
      const res = await fetch(`https://${this.host}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.user, to: this.to, subject, html: body, auth: { user: this.user, pass: this.pass } }),
        signal: AbortSignal.timeout(10_000),
      });
      this.logger.log(`Email sent: ${subject} (${res.status})`);
    } catch (err) {
      this.logger.error(`Email failed: ${(err as Error).message}`);
      throw err;
    }
  }

  private buildBody(msg: NotificationMessage): string {
    const color = msg.event === 'drawdown-warning' ? '#ef4444' : '#22c55e';
    return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><div style="background:${color};padding:12px;border-radius:8px 8px 0 0"><h2 style="color:#fff;margin:0">${msg.title}</h2></div><div style="background:#1a1d2e;padding:16px;border-radius:0 0 8px 8px;color:#d1d5db"><p style="font-size:16px">${msg.body}</p>${msg.symbol ? `<p><strong>Symbol:</strong> ${msg.symbol}</p>` : ''}${msg.score != null ? `<p><strong>Score:</strong> ${msg.score}</p>` : ''}</div></div>`;
  }
}
