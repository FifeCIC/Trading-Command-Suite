import { Module } from '@nestjs/common';
import { DeepSeekService } from './deepseek.service';
import { GeminiService } from './gemini.service';
import { PortfolioLabService } from './portfolio-lab.service';
import { AiUsageService } from './ai-usage.service';
import { AIController } from './ai.controller';
import { AiUsageController } from './ai-usage.controller';

@Module({
  controllers: [AIController, AiUsageController],
  providers: [DeepSeekService, GeminiService, PortfolioLabService, AiUsageService],
  exports: [DeepSeekService, GeminiService, PortfolioLabService, AiUsageService],
})
export class AIModule {}
