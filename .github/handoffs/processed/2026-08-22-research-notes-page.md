---
date: 2026-08-22
area: research
type: feature
---

# Research Notes page with ticker detection

## What Changed

- **New page** `src/pages/ResearchNotesPage.jsx` (+ `research-notes.css`) at
  `/research/research-notes`, registered in the Research nav area.
- **Backend**: new `research_note` table (Prisma model + additive bootstrap
  DDL in prisma.service.ts — backend restart creates it) and
  `ResearchNotesController` (`/api/research/notes`) with GET / POST / PATCH
  `:id` / DELETE `:id` / PUT `reorder`. DTOs use class-validator
  (whitelist-safe).
- **Features**:
  - Paste free-text notes (news, email, social, discord).
  - Accordion open/close per note (newest auto-opens once on first load).
  - Drag reorder via `motion/react` Reorder + persisted sortOrder.
  - Delete with confirm.
  - Ticker detection: uppercase 2–5 letter tokens (common words filtered)
    highlighted; hover opens a popout with:
    - **Registered — Open** → `/research/symbol/:ticker` (SymbolFocusPage)
    - **Register + import** (unregistered) → POST /api/symbols +
      POST /api/imports/refresh/:id
    - **Gemini** (prompt-prefilled external link) and **Google** search.

## What Was Verified

- API CRUD + reorder live (create/list/reorder/delete round-trip).
- Browser E2E: 4/4 tickers detected, registered vs unregistered popout
  variants, accordion toggle fixed (one-shot auto-open ref), builds clean.

## Deliberately Delayed (per user)

- AI analysis request in popout (needs AI phase).
- Popout price/movement info for non-registered symbols.
- Position monitoring re-evaluation on high-impact news — part of the
  ongoing Research-area news-foundation review.
