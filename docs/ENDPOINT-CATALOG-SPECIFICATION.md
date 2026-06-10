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

### 6.1 Trading 212

- [ ] **Q1**: Does Trading 212 have a REST endpoint for single-symbol quotes (`GET /equity/quote/{ticker}`)? The official docs only document portfolio, orders, instruments, and history. Flagged `confidence: uncertain`.
- [ ] **Q2**: Is there a public WebSocket API? The seed data says "No" but references to `wss://live.trading212.com/streaming/events` exist in community code. Needs verification with a funded account.
- [ ] **Q3**: Exact rate limit numbers are unpublished. Community estimates of 60 RPM and 20 RPM for order writes need live testing.
- [ ] **Q4**: Are trailing stops available via API? Seed data says "No". Confirm against latest API docs.

### 6.2 Interactive Brokers

- [ ] **Q5**: Which API surface should TCS target? Options:
  - **Client Portal REST** (runs on localhost, requires OAuth browser flow, ~50 RPM)
  - **TWS API** (socket connection to TWS/IB Gateway, mature, complex)
  - **IBKR Web API** (newer REST + WebSocket, OAuth, cloud-capable)
  - **Recommendation**: IBKR Web API is the future, but TWS API is the most reliable for now.
- [ ] **Q6**: `conid` indirection is a significant architectural concern. The `IProviderAdapter.getQuote(string symbol)` takes a ticker, but IB requires a conid. The adapter must internally resolve ticker→conid, which adds latency and a cache requirement.
- [ ] **Q7**: Path for fundamentals endpoint is approximate. IB's Client Portal API has `/fundamentals` but exact path structure varies by data type.

### 6.3 All Providers

- [ ] **Q8**: Should we add a `normalizationMap` field to the catalog that maps raw provider field names to `IProviderAdapter` return types (`MarketBar`, `ProviderQuote`, `ProviderProfile`)? Example: `{ "providerField": "o", "adapterField": "open" }`.
- [ ] **Q9**: Should the catalog drive adapter code generation? The structured endpoint/parameter/payload definitions are rich enough to generate TypeScript adapter stubs. Feasibility depends on IB `conid` complexity.
- [ ] **Q10**: Should we add a `dataElementId` cross-reference to `DATA-ELEMENTS-SPECIFICATION.md` in each endpoint entry? This would enable automatic data-element-to-provider-capability mapping.
- [ ] **Q11**: WebSocket subscription models differ significantly. Alpaca uses `authenticate` + `subscribe`, Polygon uses per-channel auth, Tradier uses session tokens, and IB uses a totally different protocol. The `WS` endpoints need per-provider subscription parameter specs.
- [ ] **Q12**: The catalog currently uses flat strings for `path`. Should we switch to RFC 6570 URI Templates for more precise parameter binding?

### 6.4 Process

- [ ] **Q13**: What's the update cadence? Provider APIs change. Recommend: review and re-extract quarterly, with automated checks for deprecated endpoints.
- [ ] **Q14**: Should we add a `lastVerified` timestamp per endpoint to track staleness of our catalog data?
- [ ] **Q15**: Should the `extract-provider-comparisons.cjs` script be extended to also extract from this catalog JSON and generate adapter stubs?

---

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

1. **Validate** the catalog JSON against the schema (use `ajv` or similar).
2. **Resolve Q5** (IB API surface selection) — this blocks the IB adapter.
3. **Implement adapters** for Polygon and Tradier — both are high-confidence, well-documented.
4. **Convert mock adapters to real** — Alpaca, Alpha Vantage, and Trading 212 adapters need real API calls.
5. **Build `EndpointCatalogPage.jsx`** — React component rendering this catalog.
6. **Wire freshness SLA values** into `FreshnessService` — use catalog thresholds instead of hardcoded constants.
7. **Set up quarterly review** — provider APIs change; catalog needs maintenance.

---

*End of specification. For questions, refer to the open questions list in Section 6.*
