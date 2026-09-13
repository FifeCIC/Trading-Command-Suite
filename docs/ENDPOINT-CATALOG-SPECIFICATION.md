# Endpoint Catalog Specification

> Generated: 2026-06-10 | Schema Version: 1.0.0-alpha
> Companion artifacts: `src/data/endpoint-catalog.schema.json`, `src/data/endpoint-catalog.seed.json`

---

## 1. Field Dictionary

### 1.1 Top-Level Fields (`$meta`)

| Field | Type | Description |
|---|---|---|
| `$meta.schemaVersion` | `string` | Semver of the JSON Schema (NOT the data). Bump on breaking field changes. |
| `$meta.generatedAt` | `iso-8601` | UTC timestamp of generation/update. |
| `$meta.generatedBy` | `string` | Tool or process name. |
| `$meta.sourceFiles` | `string[]` | Input files this catalog derived from. |
| `$meta.confidenceScoring.{level}` | `string` | Description of each confidence tier. |

### 1.2 Provider-Level Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `providerId` | `string` | ✅ | Machine slug matching `provider-comparisons.seed.json`. Lowercase, underscores. |
| `displayName` | `string` | ✅ | Human-readable name for React table headers. |
| `providerType` | `enum[brokerage,data-only,hybrid]` | ✅ | Core classification. |
| `adapterStatus.implemented` | `boolean` | — | Whether a Nest adapter exists. |
| `adapterStatus.adapterFile` | `string\|null` | — | Path relative to `nest/` root. |
| `adapterStatus.methodsImplemented` | `string[]` | — | Which `IProviderAdapter` methods are implemented. |
| `adapterStatus.isMockOnly` | `boolean` | — | `true` if adapter returns mock data even with credentials. |
| `auth.method` | `enum[api_key_header, api_key_query, bearer_token, oauth2, basic_auth, mtls, proprietary]` | ✅ | Auth mechanism. |
| `auth.credentialFields` | `string[]` | ✅ | Env var / secret names needed. |
| `auth.headerName` | `string\|null` | — | Header name for api_key_header / bearer_token. |
| `auth.tokenPrefix` | `string\|null` | — | Prefix before token value (e.g. `"Bearer"`). |
| `auth.oauthGrantTypes` | `string[]` | — | OAuth2 grant types if applicable. |
| `auth.confidence` | `enum[confirmed,likely,uncertain,unknown]` | ✅ | How certain we are about the auth mechanism. |
| `environments.paper` | `string\|null` | — | Paper/sandbox base URL, or `null`. |
| `environments.live` | `string` | ✅ | Production base URL. |
| `rateLimitProfile.freeTier` | `object` | ✅ | RPM, RPD, WS limits for free tier. |
| `rateLimitProfile.paidTier` | `object` | ✅ | RPM, RPD, WS limits for paid tier. |
| `rateLimitProfile.notes` | `string` | — | Free-form notes about rate limits. |
| `freshnessSLA.expectedLatencyMs` | `number\|null` | — | Expected data latency from market event to API delivery. |
| `freshnessSLA.staleThresholdMinutes` | `number` | ✅ | Minutes after which cached data is stale. |
| `freshnessSLA.updateFrequency` | `enum[realtime,per_second,per_minute,...,unknown]` | ✅ | Update cadence. |
| `freshnessSLA.marketHoursOnly` | `boolean` | ✅ | Data flows only during market hours. |
| `freshnessSLA.confidence` | `confidence` | ✅ | Confidence in SLA values. |
| `capabilityMatrix.{fieldId}.value` | `string` | — | Cross-reference to `provider-comparisons.seed.json`. |
| `capabilityMatrix.{fieldId}.notes` | `string` | — | Cross-reference notes. |

### 1.3 Endpoint-Level Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✅ | Machine ID: `{verb}_{resource}`. Must be unique per provider. |
| `method` | `enum[GET,POST,PUT,DELETE,PATCH,WS]` | ✅ | HTTP method or `WS` for WebSocket. |
| `path` | `string` | ✅ | URL path relative to base URL. `{placeholder}` for params. |
| `category` | `enum[quotes,candles,profiles,fundamentals,order_management,account,portfolio,streaming,reference,screening,news,options,forex,crypto,indicators]` | ✅ | Functional group. |
| `displayName` | `string` | — | Short label for React table rendering. |
| `description` | `string` | — | One-line description. |
| `payloadClass` | `string` | — | Key into `payloadClasses` map. |
| `timeframeSupport` | `string[]` | — | For candles endpoints: supported timeframes. |
| `assetClasses` | `enum[equity,etf,option,forex,crypto,index,futures,bond,cfd][]` | — | Asset classes this endpoint supports. |
| `rateLimitCategory` | `string` | — | Key into `rateLimitCategories` map. |
| `parameters.required[]` | `parameterSpec[]` | — | Required parameters. |
| `parameters.optional[]` | `parameterSpec[]` | — | Optional parameters. |
| `freshnessSLA` | `freshnessSLA` | — | Per-endpoint SLA override. Falls back to provider-level SLA. |
| `paginationSupport` | `enum[none,cursor,offset,page,token]` | — | Pagination strategy. |
| `maxPageSize` | `number\|null` | — | Max items per page. |
| `deprecated` | `boolean` | — | Endpoint deprecated by provider. Default: `false`. |
| `deprecationDate` | `string\|null` | — | Date deprecated. |
| `confidence` | `confidence` | ✅ | Confidence in endpoint existence, path, and parameters. |

### 1.4 Rate-Limit Category Fields

| Field | Type | Description |
|---|---|---|
| `requestsPerMinute` | `number\|null` | Steady-state RPM. `null` = uncapped/unpublished. |
| `requestsPerDay` | `number\|null` | Daily cap. |
| `burstAllowance` | `number` | Max concurrent or short-burst requests. |
| `windowType` | `enum[sliding,fixed,token_bucket,leaky_bucket,unknown]` | Rate-limit algorithm type. |
| `headersProvided` | `boolean` | Whether `X-RateLimit-*` headers are returned. |
| `costPerRequest` | `number\|null` | Weighted cost model (e.g., 10 for snapshot). |
| `confidence` | `confidence` | Confidence in rate-limit values. |

### 1.5 Payload Class Fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Machine-friendly class ID. |
| `description` | `string` | What this response shape represents. |
| `exampleKeys` | `string[]` | Top-level JSON keys. |
| `schemaType` | `enum[object,array,scalar]` | Root JSON type. |

### 1.6 Parameter Spec Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Parameter name as used in the API. |
| `type` | `enum[string,number,integer,boolean,array,enum]` | ✅ | Data type. |
| `description` | `string` | — | What the parameter does. |
| `default` | `any` | — | Default value if omitted. |
| `enumValues` | `string[]` | — | Allowed values if `type=enum`. |
| `min` | `number` | — | Minimum value (numeric types). |
| `max` | `number` | — | Maximum value (numeric types). |

### 1.7 Freshness SLA Fields

| Field | Type | Description |
|---|---|---|
| `expectedLatencyMs` | `number\|null` | Data latency from market event to API delivery. |
| `staleThresholdMinutes` | `number` | Minutes after which cached data is stale for this endpoint. Aligns with `FreshnessService` thresholds. |
| `updateFrequency` | `enum` | How frequently the provider updates this data. |
| `marketHoursOnly` | `boolean` | Data only flows during market hours. |
| `confidence` | `confidence` | Confidence in SLA values. |

### 1.8 Confidence Levels

| Level | Meaning | How to Upgrade |
|---|---|---|
| `confirmed` | Verified against official provider docs or live API testing. | — _(terminal state)_ |
| `likely` | Inferred from known patterns, public docs, community sources. Not directly tested. | Test against live API or sandbox. |
| `uncertain` | Best-guess with limited information. Field may be wrong or incomplete. | Research provider docs; test against sandbox. |
| `unknown` | Explicitly unknown. Field value is `null` with a reason in notes. | Must research from scratch. |

---

## 2. Provider Coverage Summary

| Provider | Endpoints Cataloged | Confidence: Confirmed | Confidence: Likely | Confidence: Uncertain | Adapter Exists | Adapter Real? |
|---|---|---|---|---|---|---|
| **Trading 212** | 11 | 7 | 2 | 2 | ✅ `trading212.adapter.ts` | ❌ Mock-only |
| **Interactive Brokers** | 10 | 0 | 8 | 2 | ❌ None | — |
| **Alpaca** | 14 | 14 | 0 | 0 | ✅ `alpaca.adapter.ts` | ❌ Mock-only |
| **Alpha Vantage** | 11 | 11 | 0 | 0 | ✅ `alpha-vantage.adapter.ts` | ❌ Mock-only |
| **Polygon** | 15 | 15 | 0 | 0 | ❌ None | — |
| **Tradier** | 13 | 13 | 0 | 0 | ❌ None | — |
| **TOTAL** | **74** | **60** | **10** | **4** | 3 of 6 | 0 of 6 |

### Key Gaps

1. **IB adapter does not exist.** The `IProviderAdapter` contract (getQuote/getCandles/getProfile/healthCheck) maps cleanly to IB's Client Portal API, but no adapter is written. IB's `conid` indirection (you search for a ticker to get a `conid`) adds complexity not present in the current interface.

2. **Trading 212 adapter is mock-only.** All methods return mock data even with `TRADING212_API_KEY` set. The `get_quote` and `ws_market_data` endpoints are flagged `uncertain` because Trading 212 does not publicly document these.

3. **No Polygon or Tradier adapter.** Both have excellent, well-documented REST APIs and WebSocket streams. These are strong candidates for next adapter implementations.

4. **Payload normalization gap.** The `IProviderAdapter` interface returns normalized types (`MarketBar`, `ProviderQuote`, `ProviderProfile`), but the catalog's `payloadClasses` describe raw provider shapes. An adapter normalization layer mapping exists only in mock code.

---

## 3. Rate-Limit Assumptions

### 3.1 Methodology

Rate limits were sourced from:
- **Official docs** for Alpaca, Alpha Vantage, Polygon, Tradier (confidence: `confirmed`)
- **Community reports & inference** for Trading 212 and Interactive Brokers (confidence: `uncertain`/`likely`)

### 3.2 Provider Rate-Limit Profiles

| Provider | Free RPM | Paid RPM | WS Limit | Window Type | Notes |
|---|---|---|---|---|---|
| **Trading 212** | N/A (no free tier) | ~60 RPM | Unknown | `sliding` _(inferred)_ | No published docs; inferred from community |
| **Interactive Brokers** | N/A (no free tier) | ~50 RPM REST | 1 conn / 100 subs | `sliding` _(inferred)_ | Client Portal only; TWS API has different limits |
| **Alpaca** | 200 RPM | Unlimited (fair use) | 1 conn | `sliding` | Returns `Retry-After` on 429 |
| **Alpha Vantage** | 5 RPM / 500/day | 75 RPM+ | N/A | `fixed` | Most restrictive free tier |
| **Polygon** | 5 RPM | Unlimited (fair use) | 1 conn / cluster | `unknown` | Rate limits not published for paid tiers |
| **Tradier** | N/A (no free tier) | 120 RPM | 1 conn | `sliding` | Uniform across all endpoints |

### 3.3 Endpoint Weight Classes

Some providers use a weighted cost model. The catalog captures this via `rateLimitCategory.costPerRequest`:

- **Polygon Snapshot**: estimated `costPerRequest: 10` (massive responses)
- **All other endpoints**: `costPerRequest: 1` (standard)

---

## 4. Auth Type Breakdown

| Provider | Auth Method | Header/Param | Credential Names |
|---|---|---|---|
| Trading 212 | `api_key_header` | `Authorization` header (no prefix) | `TRADING212_API_KEY` |
| Interactive Brokers | `oauth2` | `Authorization: Bearer {token}` | `IB_GATEWAY_URL`, `IB_OAUTH_CLIENT_ID`, `IB_OAUTH_CLIENT_SECRET` |
| Alpaca | `api_key_header` | `APCA-API-KEY-ID` + `APCA-API-SECRET-KEY` headers | `ALPACA_API_KEY`, `ALPACA_API_SECRET` |
| Alpha Vantage | `api_key_query` | `?apikey={key}` query param | `ALPHA_VANTAGE_API_KEY` |
| Polygon | `api_key_query` | `?apiKey={key}` query param | `POLYGON_API_KEY` |
| Tradier | `bearer_token` | `Authorization: Bearer {token}` header | `TRADIER_ACCESS_TOKEN` |

### Auth Implementation Notes

1. **IB OAuth2 complexity.** IB's Client Portal gateway runs on `localhost:5000` and requires a browser-based OAuth flow. This makes it unsuitable for headless queue-based ingestion. The TWS API (socket-based) is a more practical alternative but uses a completely different auth model.

2. **Alpaca uses two headers** not one. The current `IProviderAdapter` has no provision for multi-header auth. The `auth.credentialFields` array captures this, but the adapter constructor must handle it.

3. **Alpha Vantage and Polygon use query-param keys.** This means keys appear in URLs. Ensure HTTPS enforcement and avoid logging full URLs.

---

## 5. Freshness SLA Alignment

The `FreshnessService` in `nest/src/modules/market-data/freshness.service.ts` uses:
- Market hours threshold: 60 minutes (1h)
- Off-hours threshold: 1440 minutes (24h)
- Statuses: `fresh` | `stale` | `missing`

The catalog's `freshnessSLA.staleThresholdMinutes` field is designed to feed directly into this system. Recommended per-endpoint thresholds:

| Data Type | Recommended Stale Threshold | Rationale |
|---|---|---|
| Real-time quotes (WebSocket) | 1 min | "Fresh" means sub-minute |
| Real-time quotes (REST polling) | 2 min | Allow for polling interval + API latency |
| Intraday candles | 15 min | Bars accumulate; last bar may be incomplete |
| Daily candles | 1440 min (24h) | New bar only at session end |
| Fundamentals/Profiles | 10080 min (7d) | Updates weekly or slower |
| Reference data (ticker lists) | 10080 min (7d) | Changes infrequently |
| News | 60 min | Rolling window |

---

## 6. Known Uncertainties & Open Questions

> ⚠️ **All open questions were closed or deferred on 2026-09-13.** They lived here as 15 `- [ ]`
> checkboxes; a document is not a tracker, so they now resolve to issues:

| Was | Disposition |
|---|---|
| **Q1-Q4 — Trading212** (single-symbol REST quote, public WebSocket, rate limits, trailing stops via API) | **Closed - moot.** Trading212 development is discontinued and it is a **view-only portfolio source** (#696, decision 2026-08-27). None affect a read-only import. |
| **Q5-Q7 — Interactive Brokers** (API surface, `conid` indirection, fundamentals path) | **Deferred.** No IB work in scope; the active broker tracks are Alpaca (#697) and multi-broker MT5 (#592). |
| **Q8-Q12 — catalog design** (normalizationMap, codegen, dataElementId cross-ref, WS subscription params, RFC 6570 path templates) | **Deferred - design questions, not tasks.** Revisit if the catalog grows beyond its current consumers. |
| **Q13-Q15 — process** (review cadence, `lastVerified`, extract script) | **Deferred.** Add maintenance when the catalog becomes a live surface. |

The field dictionary in §1-§5 is the part that carries value.
## 7. React Table Rendering Compatibility

The catalog is designed for direct consumption by `PlatformComparisonsPage.jsx` or a new `EndpointCatalogPage.jsx`. Key design decisions:

1. **Flat endpoint array per provider** — suitable for React table rows where each endpoint is a row and providers are columns.
2. **`displayName` field** — short labels for table headers and chips.
3. **`category` enum** — maps to the existing category dropdown pattern in `PlatformComparisonsPage.jsx`.
4. **`confidence` field** — can render as color-coded badges (green=confirmed, yellow=likely, orange=uncertain, red=unknown).
5. **`deprecated` flag** — can render strikethrough or warning styling.
6. **Nested `parameters`** — can render expandable parameter detail rows.

### Suggested Component Structure

```
EndpointCatalogPage
├── ProviderSelector (reuse pill pattern from PlatformComparisonsPage)
├── CategoryFilter (reuse dropdown pattern)
├── EndpointTable
│   ├── Row: endpoint.id, method badge, path, category chip, rate limit, confidence badge
│   └── Expandable: description, parameters table, payload class, freshness SLA
└── ProviderAuthSummary (cards showing auth method + credential fields per provider)
```

---

## 8. Next Steps

> ⚠️ **Replaced 2026-09-13** - this was a 7-item task list inside a specification. Work items belong
> on issues, not here:
> - Catalog validation + a future `EndpointCatalogPage.jsx` -> provider/broker surface work (#697)
> - IB adapter -> deferred (§6)
> - Freshness-SLA wiring -> provider maintenance
>
> §1-§5 and §7 remain the reference.

---

