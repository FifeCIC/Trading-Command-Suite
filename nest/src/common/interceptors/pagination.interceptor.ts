/**
 * Pagination Interceptor
 * ======================
 * Wraps array responses in a paginated envelope.
 * Reads ?page=1&pageSize=20 from query params.
 * Pass the response property name that contains the array via constructor.
 *
 * Usage:
 *   @UseInterceptors(new PaginationInterceptor('symbols'))
 *   @Get()
 *   findAll() { return { mode, services, symbols: [...] } }
 *
 *   @UseInterceptors(new PaginationInterceptor('runs'))
 *   @Get('runs')
 *   listRuns() { return { mode, services, runs: [...] } }
 *
 * Response shape:
 *   {
 *     data: [...],         // Paginated slice
 *     total: number,       // Total items before pagination
 *     page: number,        // Current page (1-based)
 *     pageSize: number,    // Items per page
 *     totalPages: number,  // Total pages
 *     ...rest              // Original non-array keys preserved
 *   }
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

@Injectable()
export class PaginationInterceptor implements NestInterceptor {
  private readonly dataKey: string;

  /**
   * @param dataKey - The property name of the array to paginate (e.g. 'symbols', 'runs', 'ranked')
   */
  constructor(dataKey: string) {
    this.dataKey = dataKey;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();

    // Parse query params with defaults
    const rawPage = request.query?.page;
    const rawPageSize = request.query?.pageSize;

    // Opt-in: only paginate when at least one param is explicitly provided
    const hasPage = rawPage !== undefined && rawPage !== null && rawPage !== '';
    const hasPageSize = rawPageSize !== undefined && rawPageSize !== null && rawPageSize !== '';

    if (!hasPage && !hasPageSize) {
      // No pagination requested — pass through unchanged for backward compat
      return next.handle();
    }

    const page = Math.max(1, Number(rawPage) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(rawPageSize) || 20));

    return next.handle().pipe(
      map((responseBody) => {
        if (!responseBody || typeof responseBody !== 'object') {
          return responseBody;
        }

        const array = (responseBody as Record<string, unknown>)[this.dataKey];
        if (!Array.isArray(array)) {
          // Not an array — return as-is
          return responseBody;
        }

        const total = array.length;
        const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
        const start = (page - 1) * pageSize;
        const data = array.slice(start, start + pageSize);

        // Preserve all original keys except the paginated one
        const { [this.dataKey]: _omitted, ...rest } = responseBody as Record<string, unknown>;

        return {
          data,
          total,
          page,
          pageSize,
          totalPages,
          ...rest,
        };
      }),
    );
  }
}
