import { Injectable, Logger } from '@nestjs/common';
import type { NotificationMessage } from '../notifications.service';

@Injectable()
export class TelegramChannel {
  private readonly logger = new Logger(TelegramChannel.name);
  private get token() { return process.env.TELEGRAM_BOT_TOKEN || ''; }
  private get chatId() { return process.env.TELEGRAM_CHAT_ID || ''; }

  async send(msg: NotificationMessage): Promise<void> {
    if (!this.token || !this.chatId) { this.logger.debug('Telegram not configured'); return; }
    try {
      const emoji = msg.event === 'drawdown-warning' ? '🔴' : msg.event === 'entry-signal' ? '🟢' : msg.event === 'backtest-complete' ? '📊' : '📋';
      let text = `${emoji} *${msg.title}*\n${msg.body}`;
      if (msg.symbol) text += `\n📈 Symbol: \`${msg.symbol}\``;
      if (msg.score != null) text += `\n🎯 Score: ${msg.score}`;
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text, parse_mode: 'Markdown' }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Telegram API ${res.status}`);
      this.logger.log(`Telegram sent: ${msg.title}`);
    } catch (err) { this.logger.error(`Telegram failed: ${(err as Error).message}`); throw err; }
  }
}
