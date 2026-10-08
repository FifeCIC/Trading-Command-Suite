# Epic — the AI phase

Owner, on `/research/earnings-calendar`: *"The AI phase is not actually defined so we might need to create
an epic sprint issue that references other related issues."*

This is that issue. It exists because **two Page Walkthrough items cannot be started until it is
defined**, and they should not stay invisible just because the phase does not exist yet:

| View | The ask, verbatim |
|---|---|
| `/research/stock-investigation` | *"This is essentially like a report on a stock. It will require the AI phase to be started."* |
| `/research/research-notes` | *"When AI is fully integrated I would add a toggle for automatic AI response to note submission but we arent in the AI phase yet."* |

## What is being asked for, gathered from the views that raised it

These are existing requests, not a new wish-list. Collected so the phase has a scope:

1. **Stock investigation reports** — a per-symbol write-up: what the company is, what is moving it, and
   which protocol/bot fits.
2. **News analysis** — on `/research/news-intel`: *"in the case of news thats more important"* — the
   catalyst named in an article is the natural input to a symbol-level AI view.
3. **Earnings-calendar analysis** — on `/research/earnings-calendar`: *"add an option for AI analysis of
   the stock, to establish the best protocol and bot and to advise on scheduling an entry, within app and
   a limit order."* ⚠️ The limit-order half depends on a levels mechanism that does not exist yet — see
   **#1095**, which proposes building a Levels view *before* anything places a limit order against one.
4. **Automatic response to notes** — on `/research/research-notes`: a toggle for an AI response to a
   submitted note.
5. **Register-symbol suggestions** — implied by the shared overlay built on 2026-10-08: the owner noted
   that symbol selection should eventually be *"AI suggestions based on the context"*.

## What this epic must settle before any of it is built

⚠️ The reason the two views are blocked is not that nobody got to them — it is that **these are
undefined**: which provider, whether requests leave the machine, what is stored, what the app does when
the provider is unavailable, and who pays per call. A feature built before those are answered is a
feature that has to be rebuilt.

- **Provider and boundary** — local model versus a hosted API, and whether symbol, position and P&L data
  may be sent outside the machine. This one decision determines the shape of the rest.
- **Unavailable is a state, not an error** — every one of the five asks above sits on a page that already
  works without AI. Each must degrade to what it does today, not to a broken panel.
- **Provenance** — an AI claim on a page that also shows real scores needs to be visibly distinct from a
  measured figure. This repo's most repeated defect is a number that looks measured and is not.
- **Cost and cadence** — these are per-call features on pages that refresh on intervals.

## Dependencies / related

- **#1076** — AI tracking referenced from the walkthrough notes.
- **#1095** — the levels-before-limit-orders sequencing that item 3 depends on.
- **The shared register-symbol overlay** (built 2026-10-08, handoff written) — the surface AI suggestions
  would attach to.

## Not decided here

Nothing is scoped, estimated or assigned. This issue exists so the phase is **defined as a decision to
be made** rather than remaining an assumption in three separate view notes.
