# Security Policy

**Status:** active
**Category:** F (build / setup — repo root, ships publicly)
**Created:** 2026-11-01
**Last updated:** 2026-11-01
**Owner:** FifeCIC

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private reporting: **Security → Report a vulnerability** on this repository
(`https://github.com/FifeCIC/Trading-Command-Suite/security/advisories/new`). That opens a private
advisory only the maintainer can see.

If that is unavailable to you, open a **minimal** public issue that says nothing about the mechanism
and asks for a private channel — then share the detail privately.

### What to include

| | |
|---|---|
| **Version** | `curl http://localhost:3201/api/version` |
| **Reproduction** | the exact request or click path — not a description of one |
| **Impact** | what an attacker gains, and whether it can move money |
| **Affected surface** | API, frontend, MT5 bridge, or the published site |

⚠️ A report that names a *risk* without a reproduction is a discussion, not a vulnerability report.
That is not a dismissal — it just cannot be triaged.

## What is in scope

- **Order-path manipulation** — anything that can place, size or close an order without the guards
  the risk chain applies.
- **Credential exposure** — broker or provider credentials readable from an API response, a log, or
  the built frontend.
- **Authorisation bypass** — reaching a mutation without the checks that are supposed to gate it.
- **Remote code execution**, server-side request forgery, or arbitrary file read/write.
- **Leaking one installation's data to another** once multi-user exists.

## What is not in scope

- **"The software can lose money trading."** That is the product's stated risk, not a vulnerability —
  see [DISCLAIMER.md](DISCLAIMER.md).
- **The API binding to localhost with no authentication.** It is a single-user, self-hosted
  application; the threat model is the machine it runs on. **Exposing this app to a network without
  adding authentication is a deployment mistake**, and one worth reporting as a documentation
  problem so the warning gets louder.
- **Automated scanner output** with no reproduction and no named impact.
- **Dependency advisories** that do not affect how this app uses the dependency.

## What to expect

| | |
|---|---|
| Acknowledgement | best effort — one maintainer, no on-call |
| Fix timeline | depends on severity and whether it touches the money path |
| Credit | given in the advisory unless you ask otherwise |
| Bounty | **none** — this is an unfunded open-source project |

## Supported versions

Pre-release. Only the current `master` is supported; there are no maintained back-branches.
