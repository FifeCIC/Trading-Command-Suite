import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ModeService } from '../../config/mode.service';
import { EarningsWhispersService } from './earnings-whispers.service';
import { ParseEarningsWhisperDto } from './dto/parse-earnings-whisper.dto';

@ApiTags('earnings-whispers')
@Controller('earnings-whispers')
export class EarningsWhispersController {
  constructor(
    private readonly service: EarningsWhispersService,
    private readonly modeService: ModeService,
  ) {}

  private modeMeta() {
    const info = this.modeService.getModeInfo();
    return {
      mode: info.mode,
      services: { database: info.database, queue: info.queue, redis: info.redis },
    };
  }

  @Post('parse')
  @ApiOperation({ summary: 'Parse an Earnings Whispers email dump (optionally save)' })
  async parse(@Body() dto: ParseEarningsWhisperDto) {
    const result = await this.service.parseAndSave(dto.text, dto.save ?? false);
    return { ...this.modeMeta(), ...result };
  }

  @Get()
  @ApiOperation({ summary: 'List stored Earnings Whispers batches and recent entries' })
  async list() {
    const result = await this.service.list();
    return { ...this.modeMeta(), ...result };
  }
}
