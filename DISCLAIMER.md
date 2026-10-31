# Financial Disclaimer

**Status:** active
**Category:** F (build / setup — ships publicly at the repo root)
**Created:** 2026-10-31
**Last updated:** 2026-10-31
**Owner:** Ryan Bayne / FifeCIC

---

**Trading Command Suite is research and engineering software. It is not financial advice, it is not a
trading signal service, and it is not configured to make money for you.**

Read this before you connect an account — especially a live one.

---

## The short version

1. **Use a demo account.** Connecting a funded account to software in this state is a way to lose
   money, not a way to make it.
2. **Nothing here has been shown to be profitable.** The shipped configuration is a baseline for
   studying and building strategies. "It places orders" is not "it is worth letting place orders".
3. **The software is pre-release.** Features are unfinished, behaviour changes without notice, and
   defects that produce *plausible output with no error* have been found in this codebase more than
   once. A number on screen is not evidence that it is the right number.
4. **Every order is yours.** You choose the account, the size, the strategy and the risk. No human
   here reviews your trades, and no one is responsible for their outcome but you.

---

## What this software is

A self-hosted trading application: a scoring engine, a gating pipeline, an automation loop, a
backtesting and comparison lab, and a dashboard. It connects to brokers and data providers **using
credentials you supply**, and it places orders **through your own broker and your own MetaTrader 5
terminal**. It holds no money, is not a broker, and settles nothing.

## What it is not

- **Not financial, investment, tax or legal advice.** No content, score, signal, or output of this
  software constitutes a recommendation to buy or sell any instrument.
- **Not a managed service.** Nobody operates this on your behalf. There is no account manager, no
  support contract, and no obligation to warn you about anything.
- **No fiduciary relationship.** FifeCIC and the project's authors owe you no duty of care in respect
  of your trading decisions, and receive no share of your profits or losses.
- **Not validated for live trading.** It has not been reviewed against any broker's terms of service,
  any regulator's rules, or any jurisdiction's requirements for automated trading. **Verifying that
  is your responsibility before you place an order.**

## Performance

**No claim of profitability is made, and none should be inferred.**

- Scoring output is an *opinion computed from data*, not a prediction. It can be confidently wrong.
- Backtest and A/B results are historical simulations. They are subject to overfitting, survivorship
  and data errors, and **they do not predict future returns**.
- The default configuration reflects engineering decisions about correctness and safety, not
  optimisation for profit.
- Any figure this software reports — balance, P&L, win rate, drawdown, score — depends on data
  supplied by third parties, which may be delayed, incomplete, or wrong.

## Risk

Trading leveraged instruments can lose more than your initial deposit. Prices gap. Liquidity
disappears. Brokers reject orders, disconnect terminals, and change contract specifications. Software
faults add a further risk on top of market risk: **an automated system can repeat a mistake faster
than a person can notice it.**

## Data and third parties

Market data and account state come from external providers and brokers. This project does not control
them, does not verify their accuracy, and is not responsible for outages, errors, rate limits, or
charges they impose. Provider credentials you enter are stored in **your** environment — protect them.

## Warranty and liability

This program is free software distributed under the **GNU Affero General Public License v3.0**, and it
comes with **ABSOLUTELY NO WARRANTY**, to the extent permitted by law — see sections 15 and 16 of
[`LICENSE`](LICENSE) for the exact terms. In no event, unless required by applicable law or agreed to
in writing, shall any copyright holder or any other party be liable to you for damages arising out of
the use of, or inability to use, this program — see section 17. Those terms apply with full force to
**any financial loss** arising from use of this software.

Nothing in this document limits or excludes any liability that cannot lawfully be limited or
excluded.

## Practical recommendations

| Do | Because |
|---|---|
| Start on a **demo account**, and stay there until you can explain every order the system places | you cannot judge a strategy you do not understand |
| Set explicit **risk limits** (max positions, max size, max daily loss) before enabling automation | they are the only thing between a bug and your balance |
| Read the **log**, not just the dashboard | this project's recurring failure mode is plausible output with no error |
| Treat every score, badge and chart as **unverified** until you have checked its source | data comes from third parties under no obligation to be right |
| Never run it on an account you cannot afford to empty | leverage plus a software defect is an unrecoverable combination |

---

**If you do not accept these terms, do not use this software.** If you connect a live account, you
are confirming that you accept them.

*This project is pre-release. Both this document and the software it describes may change without
notice; the revision above is the one an acknowledgement should be recorded against.*
