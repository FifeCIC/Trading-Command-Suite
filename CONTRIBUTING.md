# Contributing

**Status:** active
**Category:** F (build / setup — repo root, ships publicly)
**Created:** 2026-11-01
**Last updated:** 2026-11-01
**Owner:** TCS team

Thanks for looking. This project is maintained by **one person**, so a clear, reproducible report is
worth more than a large speculative pull request — and it will be read faster.

The full guide lives in the wiki: **[Contributing](https://github.com/FifeCIC/Trading-Command-Suite/wiki/Contributing)**.
This page covers what you need before your first change.

---

## Before you open anything

| You have | Put it in |
|---|---|
| A question, or "how do I…" | [Discussions → Q&A](https://github.com/FifeCIC/Trading-Command-Suite/discussions) |
| An idea | [Discussions → Ideas](https://github.com/FifeCIC/Trading-Command-Suite/discussions) |
| A reproducible defect | [Issues](https://github.com/FifeCIC/Trading-Command-Suite/issues/new/choose) — the form asks for exactly what makes a fix possible |
| A security problem | **Not** a public issue — see [SECURITY.md](SECURITY.md) |

## The five rules that matter

1. **Evidence over assertion.** *"Score 71, threshold 75, dispatched anyway"* is a bug report.
   *"It behaves oddly"* is not. Say what you ran and what came back.
2. **Run the gates** (below). A change that cannot pass them is not ready.
3. **Never `prisma db push`.** `schema.prisma` is not the complete schema — several tables are
   raw-managed, including the trade execution queue. `db push` drops them with the data inside, and
   does not error. Use `npm --prefix nest run db:check` before any schema change.
4. **Changing scoring maths needs a copied configuration.** Weights, thresholds, gates, sizing — copy
   the configuration and compare, rather than editing the live one. Otherwise there is nothing to
   measure against.
5. **Say what you did *not* do.** A partial change reported as complete is worse than a partial change.

## Build and verify

```powershell
npm run build                       # frontend — fast, always safe
npm --prefix nest run typecheck     # backend types, no Prisma generate
npm --prefix nest run build:api     # backend: stop → build → restart → health
node scripts/validate-site-links.cjs   # the public site has no build step of its own
```

⚠️ Do not run `npm --prefix nest run build` while the API is running — it fails with an `EPERM`
naming a temp file, and never mentions the running process. Use `build:api`.

## Licence of contributions

By contributing you agree your contribution is licensed under the **AGPL-3.0**, the same as the
project. If you run a modified version as a network service, you must publish your changes — that is
deliberate, and it is why improvements come back instead of being resold.
