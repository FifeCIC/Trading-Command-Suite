import { Module } from '@nestjs/common';
import { DeepSeekService } from './deepseek.service';
import { PortfolioLabService } from './portfolio-lab.service';
import { AIController } from './ai.controller';

@Module({
  controllers: [AIController],
  providers: [DeepSeekService, PortfolioLabService],
  exports: [DeepSeekService, PortfolioLabService],
})
export class AIModule {}
