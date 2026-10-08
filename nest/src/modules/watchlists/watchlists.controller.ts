/**
 * Watchlists Controller
 * =====================
 * Database-backed watchlist management (Prisma). Formerly file-based.
 * Existing JSON files migrated on first DB access if needed.
 */

import { Controller, Get, Post, Delete, Param, Body, Logger, NotFoundException, ConflictException, HttpCode } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { Trading212Adapter } from '../providers/adapters/trading212.adapter';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const WATCHLISTS_DIR = join(__dirname, '..', '..', '..', '..', '..', 'src', 'data', 'watchlists');

interface WatchlistEntry {
  ticker: string;
  name?: string;
  exchange?: string;
  type?: string;
}

type RawWatchlistFile = unknown;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseWatchlistFile(raw: RawWatchlistFile, fallbackName: string) {
  const result = {
    id: fallbackName,
    label: fallbackName,
    symbols: [] as WatchlistEntry[],
    source: 'Trading212 CSV',
    importedAt: new Date(),
  };

  if (!isPlainObject(raw)) return result;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id === 'string') result.id = obj.id;
  if (typeof obj.label === 'string') result.label = obj.label;
  if (typeof obj.source === 'string') result.source = obj.source;
  if (typeof obj.importedAt === 'string' || typeof obj.importedAt === 'number') {
    const d = new Date(obj.importedAt as string | number);
    if (!Number.isNaN(d.getTime())) result.importedAt = d;
  }

  if (Array.isArray(obj.symbols)) {
    const symbols: WatchlistEntry[] = [];
    for (const s of obj.symbols) {
      if (!isPlainObject(s)) continue;
      const si = s as Record<string, unknown>;
      const ticker = typeof si.ticker === 'string' ? si.ticker : (typeof si === 'string' ? String(si) : undefined);
      if (!ticker) continue;
      symbols.push({
        ticker: ticker.toUpperCase(),
        name: typeof si.name === 'string' ? si.name : undefined,
        exchange: typeof si.exchange === 'string' ? si.exchange : undefined,
        type: typeof si.type === 'string' ? si.type : undefined,
      });
    }
    result.symbols = symbols;
  }

  return result;
}

@Controller('watchlists')
export class WatchlistsController {
  private readonly logger = new Logger(WatchlistsController.name);
  private migrated = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly t212: Trading212Adapter,
  ) {}

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
        const parsedRaw: unknown = JSON.parse(raw);
        const data = parseWatchlistFile(parsedRaw, f.replace('.json', ''));
        await this.prisma.watchlist.create({
          data: {
            id: data.id,
            name: data.label,
            symbols: data.symbols as unknown as Prisma.InputJsonValue,
            source: data.source,
            importedAt: data.importedAt,
          },
        });
        this.logger.log(`  ✓ Migrated: ${data.label || f}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`  ✗ Skipped ${f}: ${message}`);
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
            symbols: symbols as unknown as Prisma.InputJsonValue,
            source: 'Trading212 CSV',
            importedAt: new Date(),
          },
        });
        watchlistId = wl.id;
        saved = true;
        this.logger.log(`Imported to DB: ${wl.name} (${symbols.length} symbols)`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to save watchlist: ${message}`);
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
      kind: wl.kind || 'user',
      isDefault: wl.isDefault === true,
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
      isDefault: wl.isDefault === true,
      importedAt: wl.importedAt?.toISOString(),
    };
  }

  /** POST /api/watchlists/:id/set-default — make this the default watchlist */
  @Post(':id/set-default')
  async setDefault(@Param('id') id: string) {
    await this.migrateFilesIfNeeded();
    // Unset any existing default
    await this.prisma.watchlist.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
    // Set the new default
    const wl = await this.prisma.watchlist.update({
      where: { id },
      data: { isDefault: true },
    });
    return { default: true, id: wl.id, label: wl.name };
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
    const existing = await this.prisma.watchlist.findUnique({ where: { id } });

    const wl = existing
      ? await this.prisma.watchlist.update({
          where: { id },
          data: { name: body.name, symbols: body.symbols as unknown as Prisma.InputJsonValue, source: body.source || 'manual' },
        })
      : await this.prisma.watchlist.create({
          data: {
            id,
            name: body.name,
            symbols: body.symbols as unknown as Prisma.InputJsonValue,
            source: body.source || 'manual',
            importedAt: new Date(),
          },
        });

    this.logger.log(`Saved watchlist: ${wl.name} (${body.symbols.length} symbols)`);
    return { saved: true, id: wl.id, symbolCount: body.symbols.length };
  }

  /** POST /api/watchlists/trading212-portfolio/sync — sync T212 positions into the watchlist */
  @Post('trading212-portfolio/sync')
  async syncTrading212Portfolio() {
    try {
      const positions = await this.t212.getPositions() as Array<{ ticker: string; symbol: string }>;
      const symbols = positions.map((p) => ({
        ticker: p.ticker.toUpperCase(),
        name: p.symbol,
        exchange: 'Trading212',
        type: 'stock',
      }));

      await this.prisma.watchlist.update({
        where: { id: 'trading212-portfolio' },
        data: {
          symbols: symbols as unknown as Prisma.InputJsonValue,
          source: 'trading212',
          kind: 'built-in',
          importedAt: new Date(),
        },
      });

      this.logger.log(`Synced Trading212 Portfolio: ${symbols.length} positions`);
      return { synced: true, symbolCount: symbols.length, syncedAt: new Date().toISOString() };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to sync T212 portfolio: ${message}`);
      return { synced: false, error: message };
    }
  }

  /** GET /api/watchlists/:id/lock-status — whether this watchlist is locked by active strategies */
  @Get(':id/lock-status')
  async getLockStatus(@Param('id') id: string) {
    try {
      const strategies = await (this.prisma as any).scoringStrategy.findMany({
        where: { watchlistId: id, enabled: true },
        select: { id: true, name: true, protocolId: true },
      }) as Array<{ id: string; name: string; protocolId?: string }>;
      if (strategies.length === 0) return { locked: false, strategies: [] };

      // Check for active positions linked to strategies' protocols
      const protocolIds = [...new Set(strategies.map((s) => s.protocolId).filter(Boolean))] as string[];
      const activePositions = protocolIds.length > 0
        ? await (this.prisma as any).position.count({ where: { protocolId: { in: protocolIds }, quantity: { gt: 0 } } })
        : 0;

      const locked = activePositions > 0;
      return { locked, strategies: strategies.map((s) => s.name), activePositions };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { locked: false, error: message };
    }
  }

  /** DELETE /api/watchlists/:id — delete a watchlist if not locked */
  @Delete(':id')
  @HttpCode(200)
  async deleteWatchlist(@Param('id') id: string) {
    const wl = await this.prisma.watchlist.findUnique({ where: { id } });
    if (!wl) throw new NotFoundException(`Watchlist "${id}" not found`);

    // Lock check
    const strategies = await (this.prisma as any).scoringStrategy.findMany({
      where: { watchlistId: id, enabled: true },
      select: { name: true, protocolId: true },
    }) as Array<{ name: string; protocolId?: string }>;
    if (strategies.length > 0) {
      const protocolIds = [...new Set(strategies.map((s) => s.protocolId).filter(Boolean))] as string[];
      const activePositions = protocolIds.length > 0
        ? await (this.prisma as any).position.count({ where: { protocolId: { in: protocolIds }, quantity: { gt: 0 } } })
        : 0;
      if (activePositions > 0) {
        throw new ConflictException(`Watchlist is locked — used by ${strategies.map((s) => s.name).join(', ')} with ${activePositions} active positions`);
      }
    }

    await this.prisma.watchlist.delete({ where: { id } });
    return { deleted: true, id };
  }

  /**
   * POST /api/watchlists/:id/symbols/:ticker — add ONE symbol to an existing watchlist.
   *
   * ⚠️ WHY THIS EXISTS (2026-10-08). There was a DELETE for a single symbol but no POST, so the only
   * way to add one to an existing watchlist was `POST /api/watchlists`. **That is not a safe
   * substitute**: `saveWatchlist()` derives the row id from the *name* it is given
   * (`name.replace(/[^a-zA-Z0-9_-]/g,'-').toLowerCase()`), so passing a watchlist's `label` adds a
   * DUPLICATE watchlist whenever the id is not already that label slugged — silently, with a 200.
   *
   * This mirrors `removeSymbol` exactly (same lookup, same tolerance for both stored shapes) so the
   * two halves cannot drift: `symbols` is a JSON column that has held plain strings and `{ticker}`
   * objects, and a writer that handled only one shape would report success and store nothing useful.
   *
   * `added: false` + `alreadyPresent: true` is reported rather than written — the caller must be able
   * to tell "we added it" from "it was already there", because only one of those changed the row.
   */
  @Post(':id/symbols/:ticker')
  @HttpCode(200)
  async addSymbol(@Param('id') id: string, @Param('ticker') ticker: string) {
    const wl = await this.prisma.watchlist.findUnique({ where: { id } });
    if (!wl) throw new NotFoundException(`Watchlist "${id}" not found`);

    const upperTicker = (ticker || '').trim().toUpperCase();
    // Matches this file's own convention for a bad body (`saveWatchlist` returns `{ error }`
    // rather than throwing) so the caller sees the reason instead of a bare 400.
    if (!upperTicker) return { added: false, error: 'ticker is required' };

    const symbols = (Array.isArray(wl.symbols) ? wl.symbols : []) as Array<Record<string, unknown> | string>;
    const has = (s: Record<string, unknown> | string) => {
      if (typeof s === 'string') return s.toUpperCase() === upperTicker;
      if (isPlainObject(s) && typeof s.ticker === 'string') return s.ticker.toUpperCase() === upperTicker;
      return false;
    };

    if (symbols.some(has)) {
      return { added: false, alreadyPresent: true, id, ticker: upperTicker, count: symbols.length };
    }

    // ⚠️ APPENDED AS A PLAIN STRING. `GET /api/watchlists/:id` returns `symbols` as strings today
    // (measured: 97 entries, first "ACHR"), and `removeSymbol` compares against both shapes. Writing
    // the string form keeps a single convention rather than introducing a third.
    const next = [...symbols, upperTicker];
    // ⚠️ `as any` IS LOAD-BEARING, not laziness. Prisma's generated JSON input type rejects a
    // `(string | Record<string, unknown>)[]` union because it cannot prove an index signature, and
    // this column genuinely holds both shapes (see the DELETE below, which tolerates both). The cast
    // states that reality; narrowing the array to one shape would instead make the writer silently
    // incompatible with rows the reader still supports.
    await this.prisma.watchlist.update({ where: { id }, data: { symbols: next as any } });
    return { added: true, id, ticker: upperTicker, count: next.length };
  }

  /** DELETE /api/watchlists/:id/symbols/:ticker — remove a single symbol */
  @Delete(':id/symbols/:ticker')
  async removeSymbol(@Param('id') id: string, @Param('ticker') ticker: string) {
    const wl = await this.prisma.watchlist.findUnique({ where: { id } });
    if (!wl) throw new NotFoundException(`Watchlist "${id}" not found`);

    const symbols = (Array.isArray(wl.symbols) ? wl.symbols : []) as Array<Record<string, unknown> | string>;
    const upperTicker = ticker.toUpperCase();
    const filtered = symbols.filter((s) => {
      if (typeof s === 'string') return s.toUpperCase() !== upperTicker;
      if (isPlainObject(s) && typeof s.ticker === 'string') return s.ticker.toUpperCase() !== upperTicker;
      return true;
    });

    if (filtered.length === symbols.length) {
      return { removed: false, message: `Symbol "${upperTicker}" not found in watchlist` };
    }

    await this.prisma.watchlist.update({
      where: { id },
      data: { symbols: filtered as unknown as Prisma.InputJsonValue },
    });
    return { removed: true, ticker: upperTicker, remaining: filtered.length };
  }
}
