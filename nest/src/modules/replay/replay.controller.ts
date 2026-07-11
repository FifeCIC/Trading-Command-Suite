import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReplayService } from './replay.service';
import type { ReplayConfig } from './replay.service';

@ApiTags('replay')
@Controller('replay')
export class ReplayController {
  constructor(private readonly replayService: ReplayService) {}

  @Post('run')
  @ApiOperation({ summary: 'Run a replay — step through historical bars and score each one' })
  async run(@Body() config: ReplayConfig) {
    return this.replayService.runReplay(config);
  }

  @Get('data-inventory')
  @ApiOperation({ summary: 'List symbols with bar counts and date ranges available for replay' })
  async dataInventory() {
    return this.replayService.getDataInventory();
  }
}
