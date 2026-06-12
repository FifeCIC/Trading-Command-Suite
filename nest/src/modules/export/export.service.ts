import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  /** Export portfolio positions as CSV string */
  toCsv(data: Array<Record<string, any>>, columns: string[]): string {
    const header = columns.join(',');
    const rows = data.map((row) =>
      columns.map((col) => {
        const val = row[col];
        if (val == null) return '';
        const str = String(val);
        // Quote strings containing commas or quotes
        return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(','),
    );
    return [header, ...rows].join('\n');
  }

  /** Export data as formatted JSON */
  toJson(data: any): string {
    return JSON.stringify(data, null, 2);
  }

  /** Generate a simple HTML score card */
  toScoreCardHtml(data: {
    strategyName: string;
    symbol: string;
    score: number;
    signal: string;
    date: string;
    url: string;
  }): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${data.strategyName} — Score Card</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 2rem auto; padding: 1rem; background: #0d1117; color: #c9d1d9; }
  .card { border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; background: #161b22; }
  .symbol { font-size: 2rem; font-weight: 700; color: #58a6ff; }
  .score { font-size: 3rem; font-weight: 700; color: #3fb950; margin: 0.5rem 0; }
  .signal { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 4px; font-weight: 600; }
  .signal-buy { background: #1b3a1b; color: #3fb950; }
  .signal-sell { background: #3a1b1b; color: #f85149; }
  .signal-hold { background: #1b2a3a; color: #79c0ff; }
  .meta { font-size: 0.85rem; color: #8b949e; margin-top: 1rem; }
</style></head>
<body>
  <div class="card">
    <div class="symbol">${data.symbol}</div>
    <div class="score">${data.score}</div>
    <div class="signal signal-${data.signal.toLowerCase()}">${data.signal.toUpperCase()}</div>
    <div class="meta">${data.strategyName} · ${data.date}</div>
  </div>
</body>
</html>`;
  }

  /** Sanitize filename for safe file download */
  sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
  }
}
