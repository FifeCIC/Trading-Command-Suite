/**
 * DevController — development-only utilities.
 *
 * POST /api/dev/open-file
 * Opens a file in VS Code at the specified path and line.
 * Only works in local development environments where `code` is in PATH.
 */

import { Controller, Post, Body, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { readFileSync } from 'fs';

@Controller('dev')
export class DevController {
  private readonly logger = new Logger(DevController.name);
  private readonly workspaceRoot = process.env.WORKSPACE_ROOT || 'c:/wamp64/www/trading-command-suite';

  @Post('open-file')
  async openFile(@Body() body: { file: string; line?: number; query?: string }) {
    const { file, line, query } = body;
    if (!file) return { error: 'file path required' };

    if (!file.startsWith('src/') && !file.startsWith('nest/') && !file.startsWith('scripts/') && !file.startsWith('docs/')) {
      return { error: 'Path must be relative to workspace root' };
    }

    const fullPath = `${this.workspaceRoot}/${file}`.replace(/\\/g, '/');
    let matchedLine: number | null = null;

    if (query && !line) {
      try {
        const content = readFileSync(fullPath.replace(/\//g, '\\'), 'utf-8');
        const lines = content.split('\n');
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'i');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) { matchedLine = i + 1; break; }
        }
      } catch { /* file unreadable */ }
    }

    const targetLine = line || matchedLine;
    const goto = targetLine ? `${fullPath}:${targetLine}` : fullPath;

    return new Promise((resolve) => {
      exec(`code --goto "${goto}"`, (err) => {
        if (err) {
          resolve({ opened: false, error: err.message, path: goto });
        } else {
          resolve({ opened: true, path: goto, line: targetLine || undefined, matched: query || undefined });
        }
      });
    });
  }
}
