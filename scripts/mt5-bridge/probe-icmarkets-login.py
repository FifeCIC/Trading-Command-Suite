"""
Probe: can the IC Markets demo credentials in the machine credentials file actually log in?

Answers three questions in one run, and prints NO secret:
  1. do the credentials authenticate (`mt5.initialize` / `mt5.login`)?
  2. if they do, what account is this (balance, currency, trade_mode)?
  3. does this broker list any CRYPTO instrument, and under what native name?

The credentials file is FREE TEXT (not KEY=value), so this parses the blocks the owner wrote:
    MT5 Demo <login>
    Password <password>
    SERVER   <server> Currency <cur>

Run:  python logs/probe-icmarkets-login.py
"""
import re
import sys

try:
    import MetaTrader5 as mt5
except ImportError:
    print('FAILED: MetaTrader5 python package not installed for this interpreter')
    sys.exit(2)

CRED = r'c:\wamp64\www\.secrets\credentials.env'
# The IC Markets terminal install — the only one that plausibly carries crypto CFDs
# (MetaQuotes and Pepperstone were measured to expose none).
TERMINAL = r'C:\Program Files\MetaTrader 5 IC Markets Global\terminal64.exe'


def parse_accounts(path):
    accounts, cur = [], None
    with open(path, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            m = re.match(r'^\s*MT5 Demo\s+(\d+)', line)
            if m:
                cur = {'login': int(m.group(1)), 'password': None, 'server': None, 'currency': None}
                accounts.append(cur)
                continue
            if cur is None:
                continue
            m = re.match(r'^\s*Password\s+(\S+)', line)
            if m:
                cur['password'] = m.group(1)
                continue
            m = re.match(r'^\s*SERVER\s+(\S+)(?:\s+Currency\s+(\S+))?', line)
            if m:
                cur['server'] = m.group(1)
                cur['currency'] = m.group(2)
    return accounts


def probe(acc):
    print(f"\n=== login {acc['login']}  server={acc['server']}  "
          f"password={'set' if acc['password'] else 'MISSING'}  declared={acc['currency']}")
    if not acc['password'] or not acc['server']:
        print('  SKIPPED: incomplete block (needs Password and SERVER lines)')
        return

    ok = mt5.initialize(path=TERMINAL, login=acc['login'], password=acc['password'],
                        server=acc['server'], timeout=90000, portable=False)
    print(f"  initialize() -> {ok}   last_error={mt5.last_error()}")

    if ok:
        ai = mt5.account_info()
        # ⚠️ A terminal that is ALREADY RUNNING is attached to, and the login/password args
        # above are IGNORED. So verify identity, and only then call login() explicitly.
        if ai is None or ai.login != acc['login']:
            got = 'none' if ai is None else ai.login
            print(f"  attached to a terminal already on login {got} -> calling mt5.login() explicitly")
            print(f"  login() -> {mt5.login(acc['login'], password=acc['password'], server=acc['server'])}"
                  f"   last_error={mt5.last_error()}")
            ai = mt5.account_info()

        if ai is None:
            print('  RESULT: initialised but NO account_info — cannot judge this login')
        else:
            print(f"  RESULT: LOGGED IN  login={ai.login}  server={ai.server}  currency={ai.currency}  "
                  f"balance={ai.balance}  equity={ai.equity}  leverage=1:{ai.leverage}  "
                  f"trade_mode={ai.trade_mode} (0=demo,1=contest,2=real)  trade_allowed={ai.trade_allowed}")
            ti = mt5.terminal_info()
            if ti:
                print(f"  terminal: connected={ti.connected}  trade_allowed={ti.trade_allowed}  build={ti.build}")

            syms = mt5.symbols_get() or []
            crypto = [s.name for s in syms if 'crypto' in (s.path or '').lower()]
            # Also look for the canonical CFD names, whatever folder the broker files them under.
            named = [s.name for s in syms if re.match(r'^(BTC|ETH|SOL|DOGE|XRP|ADA|LTC)[A-Z]{0,4}USD$', s.name)]
            print(f"  symbols total={len(syms)}  crypto-path={len(crypto)}  BTC/ETH-style names={len(named)}")
            if crypto:
                print(f"    crypto-path sample: {crypto[:12]}")
            if named:
                print(f"    named sample: {named[:12]}")
                for nm in named[:6]:
                    si = mt5.symbol_info(nm)
                    if si:
                        print(f"      {nm}: path={si.path}  trade_mode={si.trade_mode}  "
                              f"min_lot={si.volume_min}  spread={si.spread}")
    else:
        code = mt5.last_error()
        hints = {
            -6: 'Authorization failed — account number/password/server combination rejected '
                '(expired demo, wrong password, or wrong server name)',
            -2: 'Invalid params',
            -3: 'Invalid time',
        }
        hint = hints.get(code[0] if isinstance(code, tuple) else code, '')
        print(f"  RESULT: COULD NOT LOG IN  ({hint or 'see code'})")

    mt5.shutdown()


if __name__ == '__main__':
    print('Probe start — IC Markets demo credentials vs MT5')
    print(f'  credentials: {CRED}')
    print(f'  terminal:    {TERMINAL}')
    accounts = parse_accounts(CRED)
    print(f'  parsed {len(accounts)} account block(s)')
    if not accounts:
        print('  NOTHING PARSED — the file has no lines of the form "MT5 Demo <login>"')
        sys.exit(1)
    for a in accounts:
        probe(a)

    # ── Crossed pairing ──────────────────────────────────────────────────────────────
    # A hand-written block can pair a login with the OTHER block's password. That is
    # indistinguishable from "expired" at the server (-6), so test it rather than assume.
    if '--crossed' in sys.argv and len(accounts) >= 2:
        for i, a in enumerate(accounts):
            other = accounts[(i + 1) % len(accounts)]
            print(f"\n=== CROSSED: login {a['login']} with the password from login {other['login']}")
            probe({**a, 'password': other['password']})
    print('\nProbe done. No password was printed.')
