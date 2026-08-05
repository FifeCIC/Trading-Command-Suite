## Source

`/scoring/protocols` — Protocols page
Also affects: `/scoring/sees-arena` protocol toggles, and all other protocol pickers

## Problem

There's no way to disable/hide a protocol. Protocols appear on every interface that lists them (SEES Arena toggles, Signals Workbench, etc.) even if they're experimental, deprecated, or not currently in use.

## Expected

Add a disable/hide control on the Protocols page (`/scoring/protocols`) that:
- Removes the protocol from all selection interfaces (arena toggles, workbench, etc.)
- Does NOT delete the protocol — just hides it from active use
- Can be re-enabled

Check if there's already an `active`/`enabled` field on the protocol configuration — if so, wire it to the UI. If not, add one.

## Discussion

This may overlap with the existing `active` field on protocols. Verify whether protocols already have enabled/disabled state and the UI just isn't exposing it.

## Element (where control should go)

View: Protocols — `/scoring/protocols`
