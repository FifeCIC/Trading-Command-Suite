import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

interface Metrics {
  totalRequests: number;
  requestsByPath: Record<string, number>;
  responseTimes: number[];
  lastMinute: number;
  errors: number;
}

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Metrics');
  private metrics: Metrics = {
    totalRequests: 0,
    requestsByPath: {},
    responseTimes: [],
    lastMinute: 0,
    errors: 0,
  };

  private lastReset = Date.now();

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    this.metrics.totalRequests++;

    const path = req.originalUrl || req.url;
    this.metrics.requestsByPath[path] = (this.metrics.requestsByPath[path] || 0) + 1;

    // Track errors
    const originalSend = res.json.bind(res);
    res.json = (body: any) => {
      if (res.statusCode >= 400) this.metrics.errors++;
      const duration = Date.now() - start;
      this.metrics.responseTimes.push(duration);
      if (this.metrics.responseTimes.length > 1000) this.metrics.responseTimes.shift();
      return originalSend(body);
    };

    // Reset per-minute counter
    if (Date.now() - this.lastReset > 60_000) {
      this.metrics.lastMinute = this.metrics.totalRequests;
      this.lastReset = Date.now();
    }

    next();
  }

  getMetrics() {
    const times = this.metrics.responseTimes;
    const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    const sorted = [...times].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    const p99 = sorted.length ? sorted[Math.floor(sorted.length * 0.99)] : 0;

    return {
      uptime: Math.round(process.uptime()),
      totalRequests: this.metrics.totalRequests,
      requestsLastMinute: this.metrics.lastMinute,
      errors: this.metrics.errors,
      responseTime: { avg, p95, p99, unit: 'ms' },
      topEndpoints: Object.entries(this.metrics.requestsByPath)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([path, count]) => ({ path, count })),
    };
  }
}
