# Q503 — Rate-Limit-Aware Symbol Data Cache

**Type:** Infrastructure — Backend (NestJS)  
**Depends on:** None (standalone service, Q502 will consume it)  
**Status:** CLAIM__

## Context

The Automation subsystem will run multiple protocols concurrently, each scoring multiple symbols. Without a cache layer, every protocol run would independently call Finnhub/T212/MT5 for the same symbol data, wasting rate limits and adding latency.

This service provides a **TTL-based in-memory cache** that deduplicates provider API calls within a configurable time window. It sits between ProtocolRunner and the provider adapters.

**Critical rule**: All provider data requests from Automation MUST go through this cache. Direct adapter calls from Automation code are forbidden.

## Steps

### 1. Create SymbolDataCacheService
- Path: `nest/src/modules/automation/symbol-data-cache.service.ts`
- Uses NestJS `@Injectable()` with singleton scope
- Internal: `Map<string, CacheEntry<T>>` keyed by `provider:symbol:endpoint`
- Interface:
```typescript
interface CacheEntry<T> {
  data: T;
  fetchedAt: number;    // Date.now()
  ttl: number;          // ms
  provider: string;
  symbol: string;
  endpoint: string;
}
```

### 2. Core methods
- `getOrFetch<T>(provider: string, symbol: string, endpoint: string, fetcher: () => Promise<T>, ttl?: number): Promise<T>`
  - Check cache for `{provider}:{symbol}:{endpoint}` key
  - If hit and not expired: return cached data
  - If miss or expired: call fetcher(), cache result, return
- `invalidate(provider: string, symbol?: string): void`
  - Clear all entries for a provider (or specific symbol)
- `getStats(): CacheStats`
  - Return `{ size, hits, misses, evictions, oldestEntry }`
- `flush(): void` — clear all entries

### 3. Default TTLs per provider
- Finnhub: 60s (matches 60 calls/min limit)
- Trading212: 30s (matches demo API)
- MT5 Bridge: 5s (local, near real-time)
- Alpha Vantage: 65s (5 calls/min free tier)

### 4. Rate-limit awareness (v2, can be deferred)
- Track calls-per-minute per provider
- If Finnhub is at 55+/60 calls in the current minute, stall and retry
- This prevents 403 errors before they happen

### 5. Wire into existing providers
- Do NOT modify existing adapters (Trading212Adapter, FinnhubAdapter, MT5Adapter)
- Instead: ProtocolRunner calls `cache.getOrFetch()` which internally calls adapter methods
- The cache is a **wrapper**, not a replacement

## Design Notes

- The cache is NOT a database replacement. Market data already lives in the DB. This cache is for **in-flight deduplication during a scoring run**.
- TTLs are short by design. The cache prevents duplicate calls within a single protocol run batch, not across hours.
- Memory usage: ~100 symbols × 3 providers × 5 endpoints = 1500 entries max. Negligible.
- Stats endpoint (`GET /api/automation/cache-stats`) for debugging cache hit rates.

## Files to Create/Modify

| File | Action |
|------|--------|
| `nest/src/modules/automation/symbol-data-cache.service.ts` | Create |
| `nest/src/modules/automation/automation.module.ts` | Modify (register service) |
