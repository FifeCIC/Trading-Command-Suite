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

  /** Step 2: Classify all positions (no AI needed) */
  @Post('classify')
  async classify(@Body() body: {
    positions: Array<{ symbol: string; ticker: string; quantity: number; avgCost: number; currentPrice: number; value: number; pnl: number; pnlPct: number }>;
    scores: Array<{ symbol: string; score: number; signal: string; strength: string; dataStatus: string }>;
    cash?: number;
  }) {
    const result = this.lab.analyze({
      positions: body.positions || [],
      scores: body.scores || [],
      cash: body.cash ?? 0,
    });
    return { ok: true, ...result };
  }
}
