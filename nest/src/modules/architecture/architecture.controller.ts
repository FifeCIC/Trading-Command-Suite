import { Controller, Get, Post, Patch, Delete, Param, Query } from '@nestjs/common';
import { ArchitectureService } from './architecture.service';

@Controller('architecture')
export class ArchitectureController {
  constructor(private readonly service: ArchitectureService) {}

  @Get('index')
  getIndex() {
    return this.service.getIndex();
  }

  /**
   * GET /api/architecture/facts — the measurable facts, so no document has to quote one.
   * Declared BEFORE `section/:key` so the literal path is matched rather than swallowed by the
   * parameterised one, which would otherwise treat "facts" as a section key.
   */
  @Get('facts')
  getFacts() {
    return this.service.getFacts();
  }

  @Get('section/:key')
  getSection(@Param('key') key: string) {
    return this.service.getSection(key);
  }

  @Get('search')
  search(@Query('q') q: string, @Query('tag') tag?: string) {
    return this.service.search(q, tag);
  }

  @Get('entries')
  getEntries(
    @Query('status') status?: string,
    @Query('tag') tag?: string,
    @Query('section') sectionKey?: string,
  ) {
    return this.service.getEntries(status, tag, sectionKey);
  }

  @Post('entries')
  addEntry(
    @Query('section') sectionKey: string,
    @Query('content') content: string,
    @Query('tags') tags?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.service.addEntry(sectionKey, content, tags, sortOrder ? parseInt(sortOrder) : undefined);
  }

  @Patch('entries/:id')
  updateEntry(
    @Param('id') id: string,
    @Query('content') content?: string,
    @Query('tags') tags?: string,
    @Query('status') status?: string,
  ) {
    return this.service.updateEntry(id, content, tags, status);
  }

  @Delete('entries/:id')
  archiveEntry(@Param('id') id: string) {
    return this.service.archiveEntry(id);
  }

  @Get('revisions/:entryId')
  getRevisions(@Param('entryId') entryId: string) {
    return this.service.getRevisions(entryId);
  }

  @Get('boundaries')
  getBoundaries() {
    return this.service.getBoundaries();
  }
}
