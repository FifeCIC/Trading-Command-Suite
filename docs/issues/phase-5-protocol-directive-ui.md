# Phase 5 — Per-Protocol Directive Config UI

> **Status:** Planned  
> **Labels:** `ui`, `scoring`, `directives`, `protocols`  
> **Priority:** P2  

---

## Background

Directive config is now DB-backed via the `global_setting` table (Phase 2 complete). Global defaults for all 122 directives are seeded on startup. Users can adjust values via `PATCH /api/directives/:id/config`.

## Goal

Build a UI on the Protocols Registry page that allows per-protocol override of directive weights. A protocol should be able to tune a directive's `maxScore` (and eventually bracket thresholds) independently from the global default.

---

## DB Key Pattern

| Scope | Key | Example |
|-------|-----|---------|
| Global default | `directive:{id}:{field}` | `directive:rsi-oversold:maxScore` = `140` |
| Protocol override | `protocol:{protoId}:{directiveId}:{field}` | `protocol:btc-speed-v1:rsi-oversold:maxScore` = `180` |

The override only needs to exist when it differs from the global default. Missing keys fall back to global.

---

## API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/directives/:id/config` | Read global config for one directive |
| `PATCH` | `/api/directives/:id/config` | Update global config |
| `GET` | `/api/protocols/:slug/directive-config` | Read per-protocol overrides (new) |
| `PATCH` | `/api/protocols/:slug/directive-config` | Update per-protocol overrides (new) |

---

## UI — Protocols Registry Page

Add a section to the protocol detail panel (right side of `/protocols/protocols-registry`) that lists the protocol's directives with their current effective weight.

### Wireframe

```
┌─ Protocol Detail ──────────────────────────┐
│ btc-speed-v1                    [Active]   │
│ ─────────────────────────────────────────── │
│ Style: Scalp    Timeframe: M5               │
│ Directives: 8    Total Weight: 1,000        │
│ ─────────────────────────────────────────── │
│ Directive Weights                           │
│ ┌─────────────────────────────────────────┐ │
│ │ speed-momentum       120  [global ▾]    │ │
│ │ rsi-oversold         140  [global ▾]    │ │
│ │ bollinger-squeeze     90  [override ▾]  │ │
│ │ ...                                     │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ── Override: bollinger-squeeze ──           │
│   Weight: [90] [Save] [Reset to global]     │
└─────────────────────────────────────────────┘
```

### Behavior

1. Each directive row shows: name, effective weight, source badge (global/override)
2. Click a directive → opens inline weight editor
3. Change weight → saves via `PATCH /api/protocols/:slug/directive-config`
4. "Reset to global" deletes the protocol-specific key
5. Total Weight stat recalculates when overrides change

---

## Backend — Protocol Directive Config Endpoint

New endpoints in `protocols.controller.ts` (or a new `protocol-directive-config.controller.ts`):

```typescript
@Get(':slug/directive-config')
async getProtocolDirectiveConfig(@Param('slug') slug: string) {
  // Read all keys matching "protocol:{slug}:*" from global_setting
  // Return as { [directiveId]: { maxScore, ... } }
}

@Patch(':slug/directive-config')
async updateProtocolDirectiveConfig(
  @Param('slug') slug: string,
  @Body() body: { directiveId: string; config: Record<string, any> }
) {
  // Write "protocol:{slug}:{directiveId}:{field}" keys
}
```

---

## Files to Change

| File | Change |
|------|--------|
| `src/pages/ProtocolsPageB.jsx` | Add directive weight section to detail panel |
| `src/pages/protocols.css` | Styles for weight editor |
| `nest/src/modules/scoring/protocols.controller.ts` | New config endpoints |
| `nest/src/modules/scoring/directive-config.service.ts` | Add protocol-scoped read/write methods |

---

## Acceptance Criteria

- [ ] Protocol detail panel shows list of directives with current weights
- [ ] Weight source badge (global vs override) visible per directive
- [ ] Click directive to edit weight inline
- [ ] Save writes to DB with proper key pattern
- [ ] Reset removes the override key
- [ ] Total Weight recalculates after changes
- [ ] Builds clean (both NestJS and Vite)
