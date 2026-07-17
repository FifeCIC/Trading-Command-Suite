/**
 * BacktestArchiveService — exports pruned rows to compressed JSON before deletion.
 *
 * Part A of #354. Wires into DataRetentionService to dump directive outcomes
 * and other high-velocity data to disk before pruning. Files organized by date range,
 * with a metadata index tracking what's been archived.
 *
 * POST /api/system/backtest-archive/export?table=directiveoutcome&days=30
 * GET  /api/system/backtest-archive/index
 * GET  /api/system/backtest-archive/import/:archiveId
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import * as zlib from 'zlib';

const ARCHIVE_DIR = resolve(process.cwd(), 'data', 'backtest-archive');
const INDEX_FILE = join(ARCHIVE_DIR, 'index.json');

interface ArchiveEntry {
  id: string;
  table: string;
  dateFrom: string;
  dateTo: string;
  rowCount: number;
  fileSize: number;
  filePath: string;
  createdAt: string;
}

export interface ArchiveIndex {
  lastUpdated: string;
  totalFiles: number;
  totalRows: number;
  entries: ArchiveEntry[];
}

@Injectable()
export class BacktestArchiveService {
  private readonly logger = new Logger(BacktestArchiveService.name);

  constructor(private readonly prisma: PrismaService) {
    if (!existsSync(ARCHIVE_DIR)) {
      mkdirSync(ARCHIVE_DIR, { recursive: true });
    }
  }

  /** Export rows older than N days from a table, delete them, and archive to JSON. */
  async exportAndPrune(
    table: string,
    dateCol: string,
    retentionDays: number,
  ): Promise<{ exported: number; filePath: string | null }> {
    if (!this.prisma.isAvailable) return { exported: 0, filePath: null };

    const cutoff = new Date(Date.now() - retentionDays * 86400000);
    const cutoffStr = cutoff.toISOString().slice(0, 19).replace('T', ' ');
    const dateFrom = new Date(Date.now() - (retentionDays + 30) * 86400000).toISOString().slice(0, 10);
    const dateTo = cutoff.toISOString().slice(0, 10);

    // Count rows to export
    const countRow = await this.prisma.$queryRawUnsafe<Array<{ cnt: number }>>(
      `SELECT COUNT(*) as cnt FROM \`${table}\` WHERE \`${dateCol}\` < '${cutoffStr}'`
    );
    const total = Number(countRow[0]?.cnt ?? 0);
    if (total === 0) return { exported: 0, filePath: null };

    this.logger.log(`Archiving ${total} rows from ${table} (${dateFrom} to ${dateTo})...`);

    const archiveId = `${table}-${dateFrom}-to-${dateTo}`;
    const fileName = `${archiveId}.json.gz`;
    const filePath = join(ARCHIVE_DIR, fileName);

    // Export in batches to avoid memory issues
    const batchSize = 10000;
    let exported = 0;
    const gz = zlib.createGzip();
    const chunks: Buffer[] = [];

    gz.on('data', (chunk: Buffer) => chunks.push(chunk));

    await new Promise<void>((resolve, reject) => {
      gz.on('end', resolve);
      gz.on('error', reject);

      (async () => {
        gz.write('[\n');
        let first = true;
        while (true) {
          const rows = await this.prisma.$queryRawUnsafe<Array<any>>(
            `SELECT * FROM \`${table}\` WHERE \`${dateCol}\` < '${cutoffStr}' LIMIT ${batchSize}`
          );
          if (rows.length === 0) break;

          for (const row of rows) {
            if (!first) gz.write(',\n');
            // Convert Date objects to ISO strings for JSON serialization
            const clean = Object.fromEntries(
              Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])
            );
            gz.write(JSON.stringify(clean));
            first = false;
          }
          exported += rows.length;

          // Delete the exported batch
          await this.prisma.$executeRawUnsafe(
            `DELETE FROM \`${table}\` WHERE \`${dateCol}\` < '${cutoffStr}' LIMIT ${batchSize}`
          );
        }
        gz.write('\n]');
        gz.end();
      })().catch(reject);
    });

    // Write compressed file
    const buffer = Buffer.concat(chunks);
    writeFileSync(filePath, buffer);

    // Update index
    const entry: ArchiveEntry = {
      id: archiveId,
      table,
      dateFrom,
      dateTo,
      rowCount: exported,
      fileSize: buffer.length,
      filePath: fileName,
      createdAt: new Date().toISOString(),
    };
    this.addToIndex(entry);

    this.logger.log(`Archived ${exported} rows → ${fileName} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
    return { exported, filePath };
  }

  /** Get archive index. */
  getIndex(): ArchiveIndex {
    try {
      if (existsSync(INDEX_FILE)) {
        return JSON.parse(readFileSync(INDEX_FILE, 'utf-8'));
      }
    } catch { /* corrupted */ }
    return { lastUpdated: new Date().toISOString(), totalFiles: 0, totalRows: 0, entries: [] };
  }

  /** Read and decompress an archived file, returning all rows. */
  readArchive(archiveId: string): any[] | null {
    const index = this.getIndex();
    const entry = index.entries.find(e => e.id === archiveId);
    if (!entry) return null;

    try {
      const raw = readFileSync(join(ARCHIVE_DIR, entry.filePath));
      const decompressed = zlib.gunzipSync(raw).toString('utf-8');
      return JSON.parse(decompressed);
    } catch (err) {
      this.logger.warn(`Failed to read archive ${archiveId}: ${(err as Error).message}`);
      return null;
    }
  }

  private addToIndex(entry: ArchiveEntry) {
    const index = this.getIndex();
    index.entries.push(entry);
    index.totalFiles = index.entries.length;
    index.totalRows = index.entries.reduce((s, e) => s + e.rowCount, 0);
    index.lastUpdated = new Date().toISOString();
    writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  }
}
