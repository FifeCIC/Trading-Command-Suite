import { Injectable, Logger } from '@nestjs/common';
import type { NotificationMessage } from '../notifications.service';

@Injectable()
export class DiscordChannel {
  private readonly logger = new Logger(DiscordChannel.name);
  private get webhookUrl() { return process.env.DISCORD_WEBHOOK_URL || ''; }

  async send(msg: NotificationMessage): Promise<void> {
    if (!this.webhookUrl) { this.logger.debug('Discord not configured'); return; }
    try {
      const color = msg.event === 'drawdown-warning' ? 0xef4444 : msg.event === 'entry-signal' ? 0x22c55e : msg.event === 'backtest-complete' ? 0x3b82f6 : 0x6b7280;
      const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
      if (msg.symbol) fields.push({ name: 'Symbol', value: msg.symbol, inline: true });
      if (msg.score != null) fields.push({ name: 'Score', value: String(msg.score), inline: true });
      const embed = { title: msg.title, description: msg.body, color, fields, timestamp: new Date().toISOString() };
      const res = await fetch(this.webhookUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }), signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Discord ${res.status}`);
      this.logger.log(`Discord sent: ${msg.title}`);
    } catch (err) { this.logger.error(`Discord failed: ${(err as Error).message}`); throw err; }
  }
}
