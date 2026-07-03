import { Controller, Post, Get, Body, Query, Logger } from '@nestjs/common';
import { DecoderService } from './decoder.service';

@Controller('decoder')
export class DecoderController {
  private readonly logger = new Logger(DecoderController.name);

  constructor(private readonly decoder: DecoderService) {}

  @Post('parse')
  async parse(@Body() body: { content: string }) {
    if (!body.content) return { error: 'content is required' };
    return this.decoder.decode(body.content);
  }

  @Get('documents')
  async list(@Query('limit') limit?: string) {
    return this.decoder.getDocuments(limit ? parseInt(limit, 10) : 20);
  }
}
