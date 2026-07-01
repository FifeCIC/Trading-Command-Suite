/**
 * DeepSeek API Service
 * ====================
 * Direct integration with api.deepseek.com for chat completions.
 *
 * Environment:
 *   DEEPSEEK_API_KEY  — API key from platform.deepseek.com
 *   DEEPSEEK_MODEL    — Model name (default: deepseek-chat)
 *                       Options: deepseek-chat, deepseek-reasoner
 *
 * Pricing (deepseek-chat, as of 2026):
 *   Input:  $0.14 / 1M tokens
 *   Output: $0.28 / 1M tokens
 *   Cache hit: $0.014 / 1M tokens
 */

import { Injectable, Logger } from '@nestjs/common';

// ── Types ──────────────────────────────────────────────────

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;    // 0.0–2.0 (default: 0.7)
  maxTokens?: number;      // max output tokens
  jsonMode?: boolean;      // force JSON output
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResponse {
  content: string;
  usage: ChatUsage;
  model: string;
  finishReason: string;
}

// ── Service ────────────────────────────────────────────────

@Injectable()
export class DeepSeekService {
  private readonly logger = new Logger(DeepSeekService.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl = 'https://api.deepseek.com/v1';

  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY || '';
    this.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    if (this.apiKey) {
      this.logger.log(`DeepSeek configured — model=${this.model} key=${this.apiKey.substring(0, 6)}...`);
    } else {
      this.logger.warn('DeepSeek API key not set — DEEPSEEK_API_KEY missing from env');
    }
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  // ── Core Chat ──────────────────────────────────────────

  async chat(
    messages: DeepSeekMessage[],
    options: ChatOptions = {},
  ): Promise<ChatResponse> {
    if (!this.apiKey) {
      throw new Error('DeepSeek API key not configured');
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      stream: false,
    };

    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const start = Date.now();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown');
      this.logger.error(`DeepSeek API error ${res.status}: ${errText.substring(0, 300)}`);
      throw new Error(`DeepSeek API error ${res.status}: ${errText.substring(0, 200)}`);
    }

    const data = await res.json();
    const elapsed = Date.now() - start;

    const choice = data.choices?.[0];
    const usage: ChatUsage = {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    };

    this.logger.log(
      `DeepSeek chat: ${usage.totalTokens} tokens, ${elapsed}ms, ` +
      `finish=${choice?.finish_reason}, model=${data.model}`,
    );

    return {
      content: choice?.message?.content ?? '',
      usage,
      model: data.model || this.model,
      finishReason: choice?.finish_reason ?? 'unknown',
    };
  }

  /**
   * Simple test — sends a single message and returns the response.
   * Useful for verifying API key and connectivity.
   */
  async ping(): Promise<{ ok: boolean; response: string; model: string; ms: number }> {
    try {
      const start = Date.now();
      const result = await this.chat(
        [{ role: 'user', content: 'Reply with exactly: OK' }],
        { maxTokens: 10, temperature: 0 },
      );
      return {
        ok: true,
        response: result.content.trim(),
        model: result.model,
        ms: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        response: (err as Error).message,
        model: this.model,
        ms: 0,
      };
    }
  }
}
