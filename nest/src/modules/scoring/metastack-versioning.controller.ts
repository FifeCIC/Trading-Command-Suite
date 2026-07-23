import { Controller, Get, Post, Param, Body, Logger } from '@nestjs/common';
import { MetaStackVersioningService } from './metastack-versioning.service';

@Controller('scoring/metastacks')
export class MetaStackVersioningController {
  private readonly logger = new Logger(MetaStackVersioningController.name);

  constructor(private readonly versioning: MetaStackVersioningService) {}

  /**
   * POST /api/scoring/metastacks/:id/snapshot
   * Create a snapshot of the current strategy state. Auto-increments version.
   */
  @Post(':id/snapshot')
  async createSnapshot(
    @Param('id') id: string,
    @Body('createdBy') createdBy?: string,
  ) {
    return this.versioning.createSnapshot(id, createdBy);
  }

  /**
   * GET /api/scoring/metastacks/:id/versions
   * List all snapshots with change log for a strategy.
   */
  @Get(':id/versions')
  async getVersions(@Param('id') id: string) {
    return this.versioning.getVersions(id);
  }

  /**
   * POST /api/scoring/metastacks/:id/restore/:versionId
   * Restore a strategy to a previous snapshot.
   */
  @Post(':id/restore/:versionId')
  async restoreSnapshot(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.versioning.restoreSnapshot(id, versionId);
  }

  /**
   * GET /api/scoring/metastacks/:id/export/:versionId
   * Export a snapshot as portable JSON.
   */
  @Get(':id/export/:versionId')
  async exportSnapshot(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.versioning.exportSnapshot(id, versionId);
  }
}
