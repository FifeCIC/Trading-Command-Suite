import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { JournalService } from './journal.service';

@Controller('journal')
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  @Get('entries')
  getEntries() { return this.journal.getEntries(); }

  // ── #1100 (2026-10-09) — `@Get('stats')` DELETED, not ported ──
  // It served four hardcoded fabrications + a "NaN%" win rate computed over an empty array
  // (measured against 440 closed trades). Realised P&L is canonical at
  // `GET /api/scoring/edge/pnl` (PnlReport — quarantine-aware, reliability bands); consumers
  // read that. Re-adding a stat route here would be a second implementation of P&L.

  @Post('entries/:id/note')
  addNote(@Param('id') id: string, @Body() body: { notes: string }) {
    return this.journal.addNote(id, body.notes);
  }

  @Post('entries/:id/analyze')
  analyzeTrade(@Param('id') id: string) {
    return this.journal.analyzeTrade(id);
  }
}
