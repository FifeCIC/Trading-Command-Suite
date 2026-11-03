# Start here

**Status:** active
**Category:** E (product / user)
**Created:** 2026-11-03
**Last updated:** 2026-11-03
**Owner:** TCS team

<!-- Source for the published wiki page. Published by scripts/publish-public-docs.cjs — edit here. -->

Trading Command Suite is a self-hosted algorithmic trading platform: a scoring engine built from
named rules, protocol-gated signals, and a per-trade decision trail you can audit.

Choose the path that matches why you are here.

---

## 1 · I want to know what this is (5 minutes)

Read in this order — each page is short, and none of them assumes you have run anything yet.

| Page | Answers |
|---|---|
| [What it does](What-It-Does) | What the app actually does, and what it deliberately does not |
| [How it works](How-It-Works) | The pipeline: directives → protocol → gate → signal → order |
| [Glossary](Glossary) | Directive, protocol, gate, composite, snapshot — the words used everywhere else |
| [FAQ](FAQ) | The questions people ask first, including *"is it profitable?"* |

⚠️ **Before you connect any account**, read the [Financial Disclaimer](Financial-Disclaimer). It is
short, and it is not boilerplate: the app ships unconfigured and no shipped strategy has been shown
to be profitable.

---

## 2 · I want to run it

| Step | Where |
|---|---|
| 1. Decide how far you are going | [Installing](Installing) — **Track A** is web + API (~10 minutes, MySQL + Node.js). **Track B** adds Windows, MetaTrader 5 and a broker, and with it live prices and order placement |
| 2. Follow the full instructions | [SETUP.md](https://github.com/FifeCIC/Trading-Command-Suite/blob/master/SETUP.md) — the authoritative guide, versioned with the code |
| 3. Run it on a **demo** account first | Not negotiable. Use a demo account until you can explain every order the system places |
| 4. Check it is healthy | `/status/health-check` in the app, or [Troubleshooting](Troubleshooting) if something looks wrong |

⚠️ MetaTrader 5 is **not** required to run the app — only to trade through it.

---

## 3 · Something is wrong

| Symptom | Start with |
|---|---|
| It will not start, or a page is blank | [Troubleshooting](Troubleshooting) — the first section covers install and startup |
| A number looks wrong, or nothing is scoring | [Troubleshooting](Troubleshooting), then the [Scoring architecture](Scoring-Architecture) |
| A trading feature behaves unexpectedly | [Risk controls](Risk-Controls) and [How a bot becomes a trade](Trading-Bot-Model) |
| You think you found a defect | [Open an issue](https://github.com/FifeCIC/Trading-Command-Suite/issues/new/choose) — reproducible steps beat a description, and a screenshot of the number that looked wrong is worth both |

⚠️ **This project has a known failure mode: plausible output with no error.** A number on screen is
not evidence that it is the right number. If something looks *fine* but you cannot explain it, that
is worth reporting — it is the class of bug this project spends most of its time closing.

---

## What this wiki is, and what it is not

| It is | It is not |
|---|---|
| How the system works, in enough depth to reason about it | Marketing — the [project website](https://fifecic.github.io/Trading-Command-Suite/) does that |
| The vocabulary, so a discussion can be precise | A tutorial series; `SETUP.md` is the install path |
| Honest about what is proven and what is not | A claim that any strategy is profitable — there is no such claim anywhere here |

**Where to talk:** [Discussions](https://github.com/FifeCIC/Trading-Command-Suite/discussions) for
questions and ideas · [Discord](https://discord.gg/8gRFkhbbfg) for quick answers from other testers ·
[Issues](https://github.com/FifeCIC/Trading-Command-Suite/issues) for reproducible defects.
