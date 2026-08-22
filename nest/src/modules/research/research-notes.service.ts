import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * ResearchNotesService — CRUD + ordering for user research notes.
 * Notes are free-text clippings (news, email, social, discord) pasted by the
 * user. Ticker detection/highlighting happens on the frontend.
 */
@Injectable()
export class ResearchNotesService {
  private readonly logger = new Logger(ResearchNotesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list() {
    if (!this.prisma.isAvailable) return [];
    return this.prisma.researchNote.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(content: string) {
    const max = await this.prisma.researchNote.aggregate({
      _max: { sortOrder: true },
    });
    const note = await this.prisma.researchNote.create({
      data: { content, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
    this.logger.log(`Created research note ${note.id} (${note.content.length} chars)`);
    return note;
  }

  async update(id: string, content: string) {
    await this.ensureExists(id);
    return this.prisma.researchNote.update({ where: { id }, data: { content } });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.researchNote.delete({ where: { id } });
    this.logger.log(`Deleted research note ${id}`);
    return { deleted: id };
  }

  async reorder(orderedIds: string[]) {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return { reordered: 0 };
    }
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.researchNote.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    return { reordered: orderedIds.length };
  }

  private async ensureExists(id: string) {
    const existing = await this.prisma.researchNote.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Note ${id} not found`);
  }
}
