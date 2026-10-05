## Pre-Close Verification

The issue carries no acceptance-criteria checkboxes, so this checklist is derived from **its own repro**, which is the acceptance test it provides.

- [x] **`printf '/* var(--not-a-real-token, 1s) */\n' >> <a css file>` no longer fails the gate**
      — Observed: `✅ OK — no NEW undefined CSS tokens. 8348 var() references checked, 152 tokens defined.` `EXIT=0`
- [x] **A REAL undefined token is still caught** (the fix must not turn the gate off)
      — Observed with `var(--definitely-not-a-token, 1s)` OUTSIDE a comment: flagged at **line 12**, `EXIT=1`
- [x] **Line numbers still point at the real file** — the reported line for the real finding was correct, because `stripComments()` keeps line breaks by contract
- [x] **Uses the canonical stripper rather than a new one** — `nest/scripts/lib/comment-stripper.cjs`, the one other validators already use. No second implementation.

### Canaried BOTH directions

| Direction | Input | Result |
|---|---|---|
| probe | `var(--not-a-real-token, 1s)` **inside a comment** | **ignored** — gate passes |
| probe | `var(--definitely-not-a-token, 1s)` **outside a comment** | **caught** — `EXIT=1`, line 12 |

The canary file was deleted afterwards and its removal verified (`Test-Path` → gone), with the gate re-run green on the clean tree (8,347 references).

### ⚠️ The fix went to THREE read sites, and the one that matters most is not the obvious one

The issue names the **reference** collector. The **definition** collector had the same flaw, and there it is *worse*: a commented-out declaration would falsely **define** a token and **mask** a real missing one. That trades a false positive for a false negative — the worse direction for a gate to be wrong in. Stripping was applied to all three sites (CSS definitions, JS definitions, CSS references).

### Found while doing it

The first canary run **failed** — but for a different reason than expected: the file used `var(--color-text, …)`, which is **not a token this repo defines**. The comment on line 4 was already being ignored correctly; the finding was my own real rule on line 8. Recorded because a canary that "fails" for the wrong reason is indistinguishable from one that passes for the wrong reason — the same trap as the inert canary on #1068.

### Not done

- **No new build guard added.** This *is* the guard — it is a `prebuild` gate that was over-firing. Adding a second one to check the first would be the extra layer this repo explicitly warns against.
- **The issue's suggested alternative — describing the pattern instead of showing it — is now unnecessary.** Comments may quote `var()` syntax freely again.
