/**
 * Watchlists Controller
 * =====================
 * CSV import and watchlist management.
 *
 * POST /api/watchlists/import-csv — parse Trading212 CSV, return symbols
 * GET  /api/watchlists — list stored watchlists from repo
 * POST /api/watchlists — create/update a watchlist
 */

import { Controller, Get, Post, Body, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const WATCHLISTS_DIR = join(__dirname, '..', '..', '..', '..', '..', 'src', 'data', 'watchlists');

interface WatchlistEntry {
  ticker: string;
  name?: string;
  exchange?: string;
  type?: string;
}

interface WatchlistFile {
  id: string;
  label: string;
  symbols: WatchlistEntry[];
  importedAt?: string;
  source?: string;
}

@Controller('watchlists')
export class WatchlistsController {
  private readonly logger = new Logger(WatchlistsController.name);

  constructor(private readonly prisma: PrismaService) {
    // Ensure watchlists directory exists
    if (!existsSync(WATCHLISTS_DIR)) {
      mkdirSync(WATCHLISTS_DIR, { recursive: true });
    }
  }

  /** POST /api/watchlists/import-csv — parse Trading212 CSV export */
  @Post('import-csv')
  async importCsv(@Body() body: { csv: string; listName?: string }) {
    if (!body.csv?.trim()) return { error: 'No CSV data provided', symbols: [] };

    const lines = body.csv.trim().split('\n');
    const symbols: WatchlistEntry[] = [];
    let skipped = 0;

    for (const line of lines) {
      // Skip headers and empty lines
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('Ticker') || trimmed.startsWith('Name,') || trimmed.startsWith('Instrument')) continue;

      // Try different CSV formats:
      // Format A: "Ticker,Name,Exchange,Type,..." (comma-separated)
      // Format B: "Ticker" (single column)
      const cols = trimmed.split(',');

      const ticker = cols[0]?.trim()?.replace(/"/g, '');
      if (!ticker || ticker.length > 20) { skipped++; continue; }

      const name = cols[1]?.trim()?.replace(/"/g, '') || ticker;
      const exchange = cols[2]?.trim()?.replace(/"/g, '') || 'Trading212';
      const type = cols[3]?.trim()?.replace(/"/g, '') || 'stock';

      symbols.push({ ticker: ticker.toUpperCase(), name, exchange, type });
    }

    // Save as repo file if listName provided
    if (body.listName?.trim() && symbols.length > 0) {
      const safeName = body.listName.trim().replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
      const filePath = join(WATCHLISTS_DIR, `${safeName}.json`);
      const data: WatchlistFile = {
        id: safeName,
        label: body.listName.trim(),
        symbols,
        importedAt: new Date().toISOString(),
        source: 'Trading212 CSV',
      };
      writeFileSync(filePath, JSON.stringify(data, null, 2));
      this.logger.log(`Saved watchlist: ${safeName} (${symbols.length} symbols)`);
    }

    return {
      count: symbols.length,
      skipped,
      symbols: symbols.slice(0, 50), // preview first 50
      total: symbols.length,
      saved: !!body.listName?.trim(),
    };
  }

  /** GET /api/watchlists — list all stored watchlists */
  @Get()
  listWatchlists() {
    if (!existsSync(WATCHLISTS_DIR)) return [];

    const files = readdirSync(WATCHLISTS_DIR).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      try {
        const raw = readFileSync(join(WATCHLISTS_DIR, f), 'utf-8');
        const data: WatchlistFile = JSON.parse(raw);
        return {
          id: data.id,
          label: data.label,
          symbolCount: data.symbols?.length ?? 0,
          importedAt: data.importedAt,
          source: data.source,
        };
      } catch {
        return { id: f.replace('.json', ''), label: f, error: 'Failed to parse' };
      }
    });
  }

  /** POST /api/watchlists — save/update a watchlist */
  @Post()
  saveWatchlist(@Body() body: WatchlistFile) {
    if (!body.id || !body.symbols?.length) return { error: 'id and symbols are required' };

    const filePath = join(WATCHLISTS_DIR, `${body.id}.json`);
    const data: WatchlistFile = {
      ...body,
      importedAt: body.importedAt || new Date().toISOString(),
    };
    writeFileSync(filePath, JSON.stringify(data, null, 2));
    this.logger.log(`Saved watchlist: ${body.id} (${body.symbols.length} symbols)`);

    return { saved: true, id: body.id, symbolCount: body.symbols.length };
  }
}
