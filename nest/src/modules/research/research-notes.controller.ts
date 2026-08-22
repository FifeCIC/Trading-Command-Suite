import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ResearchNotesService } from './research-notes.service';
import {
  CreateResearchNoteDto,
  ReorderResearchNotesDto,
  UpdateResearchNoteDto,
} from './dto/research-note.dto';

@Controller('research/notes')
export class ResearchNotesController {
  constructor(private readonly notes: ResearchNotesService) {}

  @Get()
  list() {
    return this.notes.list();
  }

  @Post()
  create(@Body() dto: CreateResearchNoteDto) {
    return this.notes.create(dto.content.trim());
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateResearchNoteDto) {
    return this.notes.update(id, dto.content.trim());
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.notes.remove(id);
  }

  @Put('reorder')
  reorder(@Body() dto: ReorderResearchNotesDto) {
    return this.notes.reorder(dto.orderedIds);
  }
}
