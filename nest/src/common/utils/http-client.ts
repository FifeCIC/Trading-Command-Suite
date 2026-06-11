/**
 * HTTP Client Utility
 * ====================
 * Shared HTTP client for outbound provider requests.
 * Sets standard headers, enforces timeouts, logs failures.
 *
 * Usage:
 *   import { httpClient } from '../../common/utils/http-client';
 *   const data = await httpClient.get('https://api.example.com/v1/data');
 *   const result = await httpClient.post('https://api.example.com/v1/data', { key: 'val' });
 */

import { Logger } from '@nestjs/common';

const DEFAULT_TIMEOUT_MS = 10_000;
const USER_AGENT = 'TradingCommandSuite/0.1.0';
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'application/json',
};

interface HttpClientOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

interface HttpResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

const logger = new Logger('HttpClient');

async function request<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
  options: HttpClientOptions = {},
): Promise<HttpResponse<T>> {
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const headers = { ...DEFAULT_HEADERS, ...options.headers };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchInit: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };

    if (body !== undefined && method !== 'GET') {
      fetchInit.body = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, fetchInit);

    let data: T;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = (await response.json()) as T;
    } else {
      data = (await response.text()) as unknown as T;
    }

    if (!response.ok) {
      logger.warn(
        `HTTP ${method} ${url} → ${response.status} ${response.statusText}`,
      );
    }

    return { ok: response.ok, status: response.status, data };
  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === 'AbortError') {
      logger.warn(`HTTP ${method} ${url} — request timed out after ${timeoutMs}ms`);
      throw new Error(`Request timed out: ${url}`);
    }
    logger.warn(`HTTP ${method} ${url} — ${err.message}`);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const httpClient = {
  get<T = unknown>(url: string, options?: HttpClientOptions): Promise<HttpResponse<T>> {
    return request<T>('GET', url, undefined, options);
  },

  post<T = unknown>(url: string, body?: unknown, options?: HttpClientOptions): Promise<HttpResponse<T>> {
    return request<T>('POST', url, body, options);
  },

  put<T = unknown>(url: string, body?: unknown, options?: HttpClientOptions): Promise<HttpResponse<T>> {
    return request<T>('PUT', url, body, options);
  },

  patch<T = unknown>(url: string, body?: unknown, options?: HttpClientOptions): Promise<HttpResponse<T>> {
    return request<T>('PATCH', url, body, options);
  },

  delete<T = unknown>(url: string, options?: HttpClientOptions): Promise<HttpResponse<T>> {
    return request<T>('DELETE', url, undefined, options);
  },
};
