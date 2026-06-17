import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { JournalService } from './journal.service';

@Controller('journal')
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  @Get('entries')
  getEntries() { return this.journal.getEntries(); }

  @Get('stats')
  getStats() { return this.journal.getStats(); }

  @Post('entries/:id/note')
  addNote(@Param('id') id: string, @Body() body: { notes: string }) {
    return this.journal.addNote(id, body.notes);
  }

  @Post('entries/:id/analyze')
  analyzeTrade(@Param('id') id: string) {
    return this.journal.analyzeTrade(id);
  }
}
