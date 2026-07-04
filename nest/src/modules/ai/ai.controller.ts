import { Controller, Post, Get, Body, Logger } from '@nestjs/common';
import { DeepSeekService, DeepSeekMessage } from './deepseek.service';
import { PortfolioLabService } from './portfolio-lab.service';

@Controller('lab')
export class AIController {
  private readonly logger = new Logger(AIController.name);

  constructor(
    private readonly deepseek: DeepSeekService,
    private readonly lab: PortfolioLabService,
  ) {}

  /** Step 1 test: verify DeepSeek connectivity */
  @Post('ping')
  async ping() {
    if (!this.deepseek.isConfigured) {
      return { ok: false, error: 'DEEPSEEK_API_KEY not set in environment' };
    }
    return this.deepseek.ping();
  }

  /** Step 1 test: send a custom message */
  @Post('chat')
  async chat(@Body() body: { messages?: DeepSeekMessage[]; message?: string }) {
    if (!this.deepseek.isConfigured) {
      return { ok: false, error: 'DEEPSEEK_API_KEY not set in environment' };
    }
    try {
      const messages = body.messages ?? [
        { role: 'user', content: body.message || 'Hello' },
      ];
      const result = await this.deepseek.chat(messages);
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Step 3: Full AI portfolio analysis */
  @Post('analyze')
  async analyze(@Body() body: {
    positions: Array<{ symbol: string; ticker: string; quantity: number; avgCost: number; currentPrice: number; value: number; pnl: number; pnlPct: number }>;
    scores: Array<{ symbol: string; score: number; signal: string; strength: string; dataStatus: string }>;
    cash?: number;
    question?: string; // optional user question to guide analysis
  }) {
    if (!this.deepseek.isConfigured) {
      return { ok: false, error: 'DEEPSEEK_API_KEY not set' };
    }

    // Run deterministic classification first
    const lab = this.lab.analyze({
      positions: body.positions || [],
      scores: body.scores || [],
      cash: body.cash ?? 0,
    });

    // Build system prompt
    const systemPrompt = `You are a portfolio restructuring advisor for an active trader. Your job is to analyze their positions and recommend specific actions.

CONTEXT:
- The trader uses SEES (Scoring Engine Evaluation System) which scores positions 0-1500+ based on technical, sentiment, and risk directives.
- Scores >800 = strong buy conviction. Scores 500-800 = buy. 200-500 = hold. <200 = weak. 0 = no data (dead position).
- The trader wants ACTIONS, not just observations. Every suggestion should be concrete.
- Loss avoidance is preferred — don't recommend selling positions with large losses unless the outlook is truly hopeless.

CLASSIFICATIONS (pre-computed):
${lab.classifications.map(c => `- ${c.symbol}: score=${c.score}, signal=${c.signal}, P&L=${c.pnlPct}%, recommendation=${c.recommendation}, reason: ${c.reasoning}`).join('\n')}

SCENARIOS (pre-computed):
${lab.scenarios.map(s => `- ${s.name} (${s.riskLevel} risk): ${s.description}`).join('\n')}

GUIDELINES:
1. Be specific — name the symbols, dollar amounts, and reasons.
2. Prioritize actions that free dead capital for strong signals.
3. Flag any risks the trader might not see (earnings, concentration, sector overlap).
4. Keep it concise — bullet points preferred.
5. If the trader asked a specific question, answer it directly first.`;

    const userMessage = body.question
      ? `My question: ${body.question}\n\nFull portfolio context is in the system message.`
      : 'Analyze my portfolio and recommend specific actions.';

    try {
      const result = await this.deepseek.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        { temperature: 0.5, maxTokens: 1500 },
      );

      return {
        ok: true,
        analysis: result.content,
        usage: result.usage,
        model: result.model,
        classifications: lab.classifications,
        scenarios: lab.scenarios,
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message, classifications: lab.classifications, scenarios: lab.scenarios };
    }
  }

  /**
   * POST /api/lab/explain-signal
   * AI Co-Pilot — explain WHY a signal fired in natural language.
   * Sends directive breakdown + market context to DeepSeek.
   */
  @Post('explain-signal')
  async explainSignal(@Body() body: {
    symbol: string;
    signal: string;
    composite: number;
    protocolName?: string;
    directives?: Array<{ name: string; score: number; reason: string }>;
  }) {
    if (!this.deepseek.isConfigured) {
      return { ok: false, error: 'DEEPSEEK_API_KEY not set' };
    }

    const directiveSummary = (body.directives || [])
      .slice(0, 8)
      .map(d => `- ${d.name}: score ${d.score}, ${d.reason}`)
      .join('\n');

    const prompt = `You are a trading signal analyst. Explain this signal in plain English.

Symbol: ${body.symbol}
Signal: ${body.signal}
Composite Score: ${body.composite}%
Protocol: ${body.protocolName || 'default'}

Directive breakdown:
${directiveSummary || 'No directive details available'}

Give a 2-3 sentence explanation of WHY this trade makes sense (or why it's risky). Mention the strongest supporting and opposing factors. Be honest — if the signal is weak or contradictory, say so. Keep it under 150 words.`;

    try {
      const result = await this.deepseek.chat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.3, maxTokens: 300 },
      );
      return { ok: true, explanation: result.content, model: result.model };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
