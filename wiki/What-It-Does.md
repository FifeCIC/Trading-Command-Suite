# What It Does

**Status:** active
**Category:** E (product / user)
**Created:** 2026-10-31
**Last updated:** 2026-10-31
**Owner:** TCS team

<!--
  Source for the published GitHub wiki page of the same name. Generated into the wiki by
  scripts/publish-public-docs.cjs — edits here, never in the wiki.
  It lives in the repository because a wiki page cannot be reviewed in a pull request, and a public
  page that nobody can propose a fix to stays wrong. (See documentation-standards: category E usually
  goes to the doc store; this is the stated exception for the public wiki source.)
-->

Trading Command Suite is a **self-hosted** trading application. It scores markets, gates those scores
through explicit rules, and — if you let it — places orders through your own broker. Everything below
runs on your machine, against your accounts.

> 🛑 It is **not configured to profit by default** and no strategy it ships has been shown to be
> profitable. Read the [Financial Disclaimer](Financial-Disclaimer) first.

---

## The areas of the app

| Area | What it is for |
|---|---|
| **Scoring** | The META.Stack engine. Protocols are built from directives; a protocol scores a symbol and everything downstream is gated on that score |
| **Signals** | What the engine currently rates highest, with the reason and the ladder of every symbol it looked at |
| **Protocols** | Build and inspect protocols — which directives they include, their thresholds, and their recorded performance |
| **Trading** | Bots, positions, trade journal, exit signals. A bot binds a protocol to a symbol with sizing and limits |
| **Portfolio & accounts** | Balances, equity, exposure and per-position state across every connected broker |
| **Watchlists** | Which symbols are monitored, and by what |
| **Research** | Symbols, fundamentals, earnings calendar, provider comparisons |
| **Lab** | Backtesting, protocol and strategy comparison, theory registry, live data playground |
| **Planner** | Trading style, objectives, capital — the constraints a bot must respect |
| **Status** | Health of every subsystem: database, providers, bridges, queue, architecture maps |
| **Settings** | Automation, risk, scoring defaults, appearance and accessibility |
| **Development** | Engineering tooling: pipeline graph, trace inspector, QA checklist, page walkthrough |

## What makes it unusual

**A decision trail, per trade.** Every dispatched order can be traced back through the gate that
allowed it, the score that produced it, and the directive that moved the score. `GET
/api/automation/decision-trail`. Most retail systems cannot answer *"why did it buy that?"* — this one
records it as a first-class object.

**Explicit gating, not vibes.** A score alone does not cause a trade. It must clear the protocol's
gates, the bot's thresholds, the risk chain and the broker's capability check for that symbol. Each
refusal is recorded with a reason rather than swallowed.

**"Cannot judge" is a real answer.** The app distinguishes *fine* from *could not determine* — an
empty list, a failed query and a genuine zero are three different things, and they render differently.
This is the single most repeated lesson in the codebase: plausible output with no error is the
defect class that costs money.

**Honest failure over convenient success.** A prebuild gate list (`39` validators, counted in
[`docs/GENERATED-FACTS.md`](https://github.com/FifeCIC/Trading-Command-Suite/blob/master/docs/GENERATED-FACTS.md))
fails the build on contract violations, duplicated implementation, undocumented decisions and stale
generated docs.

**Backtesting and A/B comparison as the measurement floor.** Protocol variants can be compared
side-by-side, and a verdict refuses to name a winner on a sample too small to support one.

## What it does not do

- **It does not give advice.** A score is an opinion computed from data.
- **It does not hold money.** It is not a broker; it places orders through yours.
- **It does not guarantee data.** Prices, fundamentals and calendars come from third parties that have
  no obligation to be right or on time.
- **It does not claim profitability.** See the disclaimer, and the [FAQ](FAQ).
