import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface FileItem {
  relativePath: string;
  size: number;
  lines: number;
  lastModified: string;
  dir: string;
  ext: string;
}

export interface FileInventoryResult {
  generatedAt: string;
  root: string;
  totalFiles: number;
  totalLines: number;
  totalSize: number;
  byExt: Record<string, { count: number; lines: number; size: number }>;
  byDir: Record<string, { count: number; lines: number; size: number }>;
  files: FileItem[];
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', '.venv', 'venv']);
const CODE_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.less', '.html', '.json', '.md', '.yml', '.yaml', '.env', '.prisma', '.sql', '.py', '.ps1', '.sh', '.mjs', '.cjs', '.graphql', '.proto', '.xml', '.svg', '.conf', '.dockerfile', '.editorconfig', '.eslintrc', '.prettierrc', '.babelrc', '.npmrc', '.nvmrc']);

@Injectable()
export class FileInventoryService {
  scan(rootDir: string): FileInventoryResult {
    const result: FileInventoryResult = {
      generatedAt: new Date().toISOString(),
      root: rootDir,
      totalFiles: 0,
      totalLines: 0,
      totalSize: 0,
      byExt: {},
      byDir: {},
      files: [],
    };

    this.walk(rootDir, rootDir, result);
    return result;
  }

  private walk(dir: string, root: string, result: FileInventoryResult) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        this.walk(path.join(dir, entry.name), root, result);
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
      const ext = path.extname(entry.name).toLowerCase() || '(none)';

      if (!CODE_EXTS.has(ext)) continue;

      let size = 0;
      let lines = 0;
      try {
        const stat = fs.statSync(fullPath);
        size = stat.size;
        const content = fs.readFileSync(fullPath, 'utf-8');
        lines = content.split('\n').length;
      } catch {
        // skip unreadable files
        continue;
      }

      const parentDir = path.dirname(relPath);

      result.totalFiles++;
      result.totalLines += lines;
      result.totalSize += size;

      if (!result.byExt[ext]) result.byExt[ext] = { count: 0, lines: 0, size: 0 };
      result.byExt[ext].count++;
      result.byExt[ext].lines += lines;
      result.byExt[ext].size += size;

      if (!result.byDir[parentDir]) result.byDir[parentDir] = { count: 0, lines: 0, size: 0 };
      result.byDir[parentDir].count++;
      result.byDir[parentDir].lines += lines;
      result.byDir[parentDir].size += size;

      result.files.push({
        relativePath: relPath,
        size,
        lines,
        lastModified: new Date(fs.statSync(fullPath).mtime).toISOString(),
        dir: parentDir,
        ext,
      });
    }
  }
}
