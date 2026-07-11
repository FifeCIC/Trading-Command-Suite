## From UI/UX Review (2026-07-11)

### Current State
`http://localhost:5173/qa/order-testing` lives under QA but should be part of a Trading212 integration area.

### Phase 1 (NOW)
Move Order Testing to a new **Trading212** area in navigation. This area is only displayed when Trading212 is activated.

### Phase 2 (FUTURE — do NOT build yet)
- Like-for-like representation of the Trading212 account data
- Apply M.E.T.A. Stack on each Trading212 view
- UI shows suggested decisions when not fully automated:
  - If strategy allows averaging, show alongside a losing position: shares to buy, what averaging looks like, and why
  - Display protocol score + key values (forecast, etc.)

### Acceptance Criteria (Phase 1)
- [ ] New "Trading212" nav area created
- [ ] Only visible when Trading212 provider is activated
- [ ] Order Testing moved into this area
- [ ] Phase 2 gated behind phase flag (DO NOT build)

### Related
- Reopened #217 (Theme & UX Standards)
