import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface DecodedDocument {
  id?: string;
  content: string;
  format: string;
  parsedFields: Record<string, any>;
  extractedSymbols: string[];
  sentiment: 'bullish' | 'bearish' | 'neutral' | null;
  analysis: {
    summary: string;
    sentimentScore: number;
    keyDates: Array<{ label: string; date: string }>;
    actionableTickers: string[];
    confidence: number;
  };
  createdAt?: string;
}

const EARNINGS_PATTERNS = [
  { key: 'ticker', label: 'Ticker', regex: /\((\w{1,5})\)/g, multi: true },
  { key: 'companyName', label: 'Company', regex: /^###\s+(.+?)\s+(?:is|Earnings)/gm },
  { key: 'reportDate', label: 'Report Date', regex: /(?:report earnings on|to report earnings on)\s+(\w+day,?\s+\w+\s+\d{1,2},?\s+\d{4})/gi },
  { key: 'consensusEPS', label: 'Consensus EPS', regex: /consensus (?:earnings )?estimate is \$?([\d.-]+) per share/gi },
  { key: 'whisperEPS', label: 'Whisper EPS', regex: /Earnings Whisper ® number is \$?([\d.-]+) per share/gi },
  { key: 'sentiment', label: 'Investor Sentiment', regex: /Investors are (\w+)/gi },
  { key: 'beatExpect', label: 'Expecting Beat %', regex: /(\d+\.?\d*%)\s+expecting a beat/gi },
  { key: 'optionMove', label: 'Option-Implied Move', regex: /pricing in a (\d+\.?\d*%) move on earnings/gi },
];

@Injectable()
export class DecoderService {
  private readonly logger = new Logger(DecoderService.name);

  constructor(private readonly prisma: PrismaService) {}

  detectFormat(text: string): string {
    if (!text?.trim()) return 'generic';
    const t = text.trim();
    if (t.startsWith('{') || t.startsWith('[')) return 'json';
    if (t.includes('Earnings Whisper') && t.includes('consensus earnings estimate')) return 'earnings-whisper';
    const lines = t.split('\n').filter(Boolean);
    if (lines.length >= 3 && lines[0].includes(',') && lines[1].includes(',')) return 'csv';
    return 'generic';
  }

  parseContent(text: string, format?: string): { fields: Record<string, any>; extractedSymbols: string[] } {
    const fmt = format || this.detectFormat(text);
    const fields: Record<string, any> = {};
    const symbols = new Set<string>();

    if (fmt === 'earnings-whisper') {
      for (const pattern of EARNINGS_PATTERNS) {
        const matches = [...text.matchAll(pattern.regex)];
        if (matches.length > 0) {
          if (pattern.multi) {
            fields[pattern.key] = matches.map(m => m[1] || m[0]);
          } else {
            fields[pattern.key] = matches[0][1] || matches[0][0];
          }
        }
      }
      // Extract tickers
      if (fields.ticker) {
        (Array.isArray(fields.ticker) ? fields.ticker : [fields.ticker]).forEach((t: string) => symbols.add(t));
      }
    } else if (fmt === 'json') {
      try { fields.parsed = JSON.parse(text); } catch { fields.raw = text; }
    } else if (fmt === 'csv') {
      const lines = text.split('\n').filter(Boolean);
      fields.headers = lines[0]?.split(',').map(h => h.trim());
      fields.rowCount = lines.length - 1;
    } else {
      fields.wordCount = text.split(/\s+/).filter(Boolean).length;
      fields.charCount = text.length;
      fields.lineCount = text.split('\n').filter(Boolean).length;
    }

    // Always try to extract ticker symbols
    const tickerPattern = /\b([A-Z]{1,5})\b/g;
    let match;
    while ((match = tickerPattern.exec(text)) !== null) {
      if (match[1].length >= 2 && match[1] !== match[1].toLowerCase()) {
        symbols.add(match[1]);
      }
    }

    return { fields, extractedSymbols: [...symbols].slice(0, 10) };
  }

  generateAnalysis(text: string, fields: Record<string, any>, symbols: string[]): DecodedDocument['analysis'] {
    const lowerText = text.toLowerCase();

    // Sentiment
    const bullishWords = ['beat', 'strong', 'bullish', 'growth', 'higher', 'upgrade', 'positive', 'exceed', 'record'];
    const bearishWords = ['miss', 'weak', 'bearish', 'decline', 'lower', 'downgrade', 'negative', 'below', 'risk', 'loss'];
    let bullishCount = 0, bearishCount = 0;
    for (const w of bullishWords) if (lowerText.includes(w)) bullishCount++;
    for (const w of bearishWords) if (lowerText.includes(w)) bearishCount++;

    const sentimentScore = bullishCount + bearishCount > 0
      ? Math.round((bullishCount / (bullishCount + bearishCount)) * 100)
      : 50;

    // Dates
    const keyDates: Array<{ label: string; date: string }> = [];
    if (fields.reportDate) keyDates.push({ label: 'Report Date', date: fields.reportDate });
    const datePattern = /(\w+day,?\s+\w+\s+\d{1,2},?\s+\d{4})/gi;
    let dateMatch;
    while ((dateMatch = datePattern.exec(text)) !== null) {
      if (!keyDates.some(d => d.date === dateMatch![1])) {
        keyDates.push({ label: 'Date found', date: dateMatch[1] });
      }
    }

    // Confidence
    let confidence = 50;
    if (fields.ticker && fields.consensusEPS) confidence += 15;
    if (fields.whisperEPS && fields.consensusEPS) confidence += 10;
    if (bullishCount + bearishCount > 5) confidence += 5;
    if (symbols.length > 0) confidence += 10;

    // Summary
    let summary = `Decoded ${Object.keys(fields).length} data fields.`;
    if (symbols.length > 0) summary += ` Found ${symbols.length} symbols: ${symbols.slice(0, 5).join(', ')}.`;
    if (sentimentScore > 65) summary += ' Overall bullish sentiment detected.';
    else if (sentimentScore < 35) summary += ' Overall bearish sentiment detected.';
    else summary += ' Mixed or neutral sentiment.';

    return {
      summary,
      sentimentScore,
      keyDates: keyDates.slice(0, 5),
      actionableTickers: symbols,
      confidence: Math.min(100, confidence),
    };
  }

  async decode(text: string): Promise<DecodedDocument> {
    const format = this.detectFormat(text);
    const { fields, extractedSymbols } = this.parseContent(text, format);
    const analysis = this.generateAnalysis(text, fields, extractedSymbols);

    const sentiment: 'bullish' | 'bearish' | 'neutral' =
      analysis.sentimentScore > 60 ? 'bullish' : analysis.sentimentScore < 40 ? 'bearish' : 'neutral';

    const doc: DecodedDocument = {
      content: text,
      format,
      parsedFields: fields,
      extractedSymbols,
      sentiment,
      analysis,
      createdAt: new Date().toISOString(),
    };

    // Persist to DB if available
    try {
      const created = await this.prisma.decodedDocument.create({
        data: {
          content: text,
          format,
          parsedFields: fields as any,
          extractedSymbols: extractedSymbols as any,
          sentiment,
          analysis: analysis as any,
        },
      });
      doc.id = created.id;
    } catch (err) {
      this.logger.warn(`DB save failed: ${(err as Error).message}`);
    }

    return doc;
  }

  async getDocuments(limit = 20) {
    try {
      return await this.prisma.decodedDocument.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } catch {
      return [];
    }
  }
}
