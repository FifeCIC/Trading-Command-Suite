/**
 * Watchlists Controller
 * =====================
 * Database-backed watchlist management (Prisma). Formerly file-based.
 * Existing JSON files migrated on first DB access if needed.
 */

import { Controller, Get, Post, Param, Body, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const WATCHLISTS_DIR = join(__dirname, '..', '..', '..', '..', '..', 'src', 'data', 'watchlists');

interface WatchlistEntry {
  ticker: string;
  name?: string;
  exchange?: string;
  type?: string;
}

@Controller('watchlists')
export class WatchlistsController {
  private readonly logger = new Logger(WatchlistsController.name);
  private migrated = false;

  constructor(private readonly prisma: PrismaService) {}

  /** Lazily migrate any JSON files into the database (one-time) */
  private async migrateFilesIfNeeded() {
    if (this.migrated) return;
    this.migrated = true;

    if (!existsSync(WATCHLISTS_DIR)) return;
    const files = readdirSync(WATCHLISTS_DIR).filter(f => f.endsWith('.json'));
    if (files.length === 0) return;

    const existing = await this.prisma.watchlist.count();
    if (existing > 0) return; // DB already has watchlists

    this.logger.log(`Migrating ${files.length} JSON watchlist files to database…`);
    for (const f of files) {
      try {
        const raw = readFileSync(join(WATCHLISTS_DIR, f), 'utf-8');
        const data = JSON.parse(raw);
        await this.prisma.watchlist.create({
          data: {
            id: data.id || f.replace('.json', ''),
            name: data.label || f,
            symbols: data.symbols || [],
            source: data.source || 'Trading212 CSV',
            importedAt: data.importedAt ? new Date(data.importedAt) : new Date(),
          },
        });
        this.logger.log(`  ✓ Migrated: ${data.label || f}`);
      } catch (err) {
        this.logger.warn(`  ✗ Skipped ${f}: ${err.message}`);
      }
    }
  }

  /** POST /api/watchlists/import-csv — parse Trading212 CSV, save to DB */
  @Post('import-csv')
  async importCsv(@Body() body: { csv: string; listName?: string }) {
    if (!body.csv?.trim()) return { error: 'No CSV data provided', symbols: [] };

    const lines = body.csv.trim().split('\n');
    const symbols: WatchlistEntry[] = [];
    let skipped = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('Ticker') || trimmed.startsWith('Name,') || trimmed.startsWith('Instrument')) continue;

      const cols = trimmed.split(',');
      const ticker = cols[0]?.trim()?.replace(/"/g, '');
      if (!ticker || ticker.length > 20) { skipped++; continue; }

      const name = cols[1]?.trim()?.replace(/"/g, '') || ticker;
      const exchange = cols[2]?.trim()?.replace(/"/g, '') || 'Trading212';
      const type = cols[3]?.trim()?.replace(/"/g, '') || 'stock';

      symbols.push({ ticker: ticker.toUpperCase(), name, exchange, type });
    }

    // Save to database
    let saved = false;
    let watchlistId: string | null = null;
    if (body.listName?.trim() && symbols.length > 0) {
      const safeId = body.listName.trim().replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() + '-' + Date.now();
      try {
        const wl = await this.prisma.watchlist.create({
          data: {
            id: safeId,
            name: body.listName.trim(),
            symbols: symbols as any,
            source: 'Trading212 CSV',
            importedAt: new Date(),
          },
        });
        watchlistId = wl.id;
        saved = true;
        this.logger.log(`Imported to DB: ${wl.name} (${symbols.length} symbols)`);
      } catch (err) {
        this.logger.error(`Failed to save watchlist: ${err.message}`);
      }
    }

    return {
      count: symbols.length,
      skipped,
      symbols: symbols.slice(0, 50),
      total: symbols.length,
      saved,
      watchlistId,
    };
  }

  /** GET /api/watchlists — list from database */
  @Get()
  async listWatchlists() {
    await this.migrateFilesIfNeeded();
    const wls = await this.prisma.watchlist.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return wls.map(wl => ({
      id: wl.id,
      label: wl.name,
      symbolCount: Array.isArray(wl.symbols) ? wl.symbols.length : 0,
      importedAt: wl.importedAt?.toISOString() ?? wl.createdAt.toISOString(),
      source: wl.source || 'manual',
      protocolId: wl.protocolId,
    }));
  }

  /** GET /api/watchlists/:id — full watchlist with symbols */
  @Get(':id')
  async getWatchlist(@Param('id') id: string) {
    await this.migrateFilesIfNeeded();
    const wl = await this.prisma.watchlist.findUnique({ where: { id } });
    if (!wl) throw new NotFoundException(`Watchlist ${id} not found`);
    return {
      id: wl.id,
      label: wl.name,
      symbols: wl.symbols,
      source: wl.source,
      protocolId: wl.protocolId,
      importedAt: wl.importedAt?.toISOString(),
    };
  }

  /** PATCH /api/watchlists/:id — update protocol or name */
  @Post(':id')
  async updateWatchlist(
    @Param('id') id: string,
    @Body() body: { name?: string; protocolId?: string },
  ) {
    await this.migrateFilesIfNeeded();
    const wl = await this.prisma.watchlist.findUnique({ where: { id } });
    if (!wl) throw new NotFoundException(`Watchlist ${id} not found`);

    const updated = await this.prisma.watchlist.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.protocolId !== undefined && { protocolId: body.protocolId }),
      },
    });
    return { updated: true, id: updated.id, protocolId: updated.protocolId };
  }

  /** POST /api/watchlists — create a new watchlist manually */
  @Post()
  async saveWatchlist(@Body() body: { name: string; symbols: WatchlistEntry[]; source?: string }) {
    if (!body.name || !body.symbols?.length) return { error: 'name and symbols are required' };

    const id = body.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const wl = await this.prisma.watchlist.upsert({
      where: { id },
      create: {
        id,
        name: body.name,
        symbols: body.symbols as any,
        source: body.source || 'manual',
        importedAt: new Date(),
      },
      update: {
        name: body.name,
        symbols: body.symbols as any,
        source: body.source || 'manual',
      },
    });

    this.logger.log(`Saved watchlist: ${wl.name} (${body.symbols.length} symbols)`);
    return { saved: true, id: wl.id, symbolCount: body.symbols.length };
  }
}
