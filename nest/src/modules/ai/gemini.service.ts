/**
 * Gemini API Service
 * ==================
 * Direct integration with Google's Gemini API (generativelanguage.googleapis.com)
 * for chat completions. Mirrors the DeepSeekService interface so the AI
 * controller can route requests to either provider.
 *
 * Environment:
 *   GEMINI_API_KEY  — API key from aistudio.google.com/apikey
 *   GEMINI_MODEL    — Model name (default: gemini-3.6-flash)
 *                     Options (as of 2026): gemini-3.6-flash, gemini-2.5-pro,
 *                     gemini-2.0-flash, gemini-2.0-flash-lite
 *
 * Pricing (gemini-3.6-flash, as of 2026):
 *   Input:  $0.30 / 1M tokens (≤200k)
 *   Output: $2.50 / 1M tokens (≤200k)
 *   Free tier is available via AI Studio (rate-limited).
 */

import { Injectable, Logger } from '@nestjs/common';
import type {
  DeepSeekMessage as AIMessage,
  ChatOptions,
  ChatResponse,
} from './deepseek.service';

// ── Service ────────────────────────────────────────────────

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  readonly providerName = 'gemini';

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || '';
    this.model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    if (this.apiKey) {
      this.logger.log(
        `Gemini configured — model=${this.model} key=${this.apiKey.substring(0, 6)}...`,
      );
    } else {
      this.logger.warn('Gemini API key not set — GEMINI_API_KEY missing from env');
    }
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  // ── Core Chat ──────────────────────────────────────────

  async chat(
    messages: AIMessage[],
    options: ChatOptions = {},
  ): Promise<ChatResponse> {
    if (!this.apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const body = this.buildBody(messages, options);

    const start = Date.now();
    const res = await fetch(
      `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown');
      this.logger.error(`Gemini API error ${res.status}: ${errText.substring(0, 300)}`);
      throw new Error(`Gemini API error ${res.status}: ${errText.substring(0, 200)}`);
    }

    const data = await res.json();
    const elapsed = Date.now() - start;

    const candidate = data.candidates?.[0];
    const text =
      candidate?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? '')
        .join('') ?? '';

    const usage = {
      promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
    };

    this.logger.log(
      `Gemini chat: ${usage.totalTokens} tokens, ${elapsed}ms, ` +
        `finish=${candidate?.finishReason}, model=${data.modelVersion ?? this.model}`,
    );

    return {
      content: text,
      usage,
      model: data.modelVersion || this.model,
      finishReason: candidate?.finishReason ?? 'unknown',
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

  // ── Mapping ────────────────────────────────────────────

  private buildBody(
    messages: AIMessage[],
    options: ChatOptions,
  ): Record<string, unknown> {
    // System messages become a top-level systemInstruction; the rest become
    // contents with Gemini roles (user / model).
    const systemText = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');

    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const generationConfig: Record<string, unknown> = {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxTokens ?? 2048,
    };
    if (options.jsonMode) {
      generationConfig.responseMimeType = 'application/json';
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig,
    };
    if (systemText) {
      body.systemInstruction = { parts: [{ text: systemText }] };
    }
    return body;
  }
}
