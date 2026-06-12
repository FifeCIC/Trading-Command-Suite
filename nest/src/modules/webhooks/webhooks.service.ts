/**
 * Webhooks Service
 * =================
 * Validates, queues, and logs incoming webhook payloads.
 * Supports webhooks from Alpaca, TradingView, MT5, and custom sources.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface WebhookLog {
  id: string;
  source: string;
  event: string;
  payload: Record<string, unknown>;
  validated: boolean;
  processed: boolean;
  timestamp: Date;
  error?: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly logs: WebhookLog[] = [];
  private readonly secrets = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {
    // Load configured webhook secrets from env
    if (process.env.WEBHOOK_ALPACA_SECRET) this.secrets.set('alpaca', process.env.WEBHOOK_ALPACA_SECRET);
    if (process.env.WEBHOOK_TRADINGVIEW_SECRET) this.secrets.set('tradingview', process.env.WEBHOOK_TRADINGVIEW_SECRET);
  }

  /**
   * Validate a webhook signature against a known secret.
   */
  validateSignature(source: string, signature: string, body: string): boolean {
    const secret = this.secrets.get(source);
    if (!secret) {
      this.logger.debug(`No secret configured for source: ${source} — skipping validation`);
      return true; // No secret = accept all (permissive by default)
    }

    // Simple HMAC-SHA256 validation
    try {
      const { createHmac } = require('crypto');
      const expected = createHmac('sha256', secret).update(body).digest('hex');
      const valid = signature === expected;
      if (!valid) {
        this.logger.warn(`Invalid signature for webhook from ${source}`);
      }
      return valid;
    } catch {
      this.logger.warn(`Signature validation error for ${source}`);
      return false;
    }
  }

  /**
   * Log an incoming webhook for audit tracking.
   */
  logWebhook(
    source: string,
    event: string,
    payload: Record<string, unknown>,
    validated: boolean,
    processed: boolean,
    error?: string,
  ): WebhookLog {
    const log: WebhookLog = {
      id: `wh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source,
      event,
      payload,
      validated,
      processed,
      timestamp: new Date(),
      error,
    };
    this.logs.push(log);
    if (this.logs.length > 1000) this.logs.shift(); // Keep bounded
    return log;
  }

  /**
   * Get recent webhook logs.
   */
  getLogs(limit = 50): WebhookLog[] {
    return this.logs.slice(-limit).reverse();
  }

  /**
   * Queue a webhook payload for async processing.
   * In production, this would push to a message queue.
   */
  async queueProcessing(payload: Record<string, unknown>, source: string): Promise<void> {
    this.logger.log(`Queued ${source} webhook for processing: ${JSON.stringify(payload).slice(0, 200)}`);
    // TODO: Integrate with QueueModule for async processing
  }
}
