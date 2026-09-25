"""
MT5 Bridge v2 — HTTP bridge between NestJS and MetaTrader 5.
Uses Python's built-in http.server (single-threaded, no Flask).
Connects to MT5 terminal ONCE at startup — all requests use the same connection.

Usage:
    pip install -r requirements-mt5.txt
    python mt5_bridge_v2.py
"""

import os, json, logging, threading, time
from logging.handlers import RotatingFileHandler
from datetime import datetime, timedelta, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# ─── Config ───────────────────────────────────────────────

try:
    import dotenv
    env_path = os.path.join(os.path.dirname(__file__), '..', '..', 'nest', '.env')
    if os.path.exists(env_path):
        dotenv.load_dotenv(env_path)
        print(f'Loaded credentials from {env_path}')
except ImportError:
    print('python-dotenv not installed')

# ─── Instance identity (multi-bridge, #747) ───────────────
# Each bridge instance targets ONE MT5 account slot. Resolve identity EARLY —
# before logging is configured — so every log line is tagged with the broker id,
# and so --port / --broker-id CLI flags work alongside env vars.

import sys as _sys

def _cli_arg(flag):
    if flag in _sys.argv:
        i = _sys.argv.index(flag)
        if i + 1 < len(_sys.argv):
            return _sys.argv[i + 1]
    return None

_cli_port = _cli_arg('--port')
_cli_broker = _cli_arg('--broker-id')
if _cli_port:
    os.environ['BRIDGE_PORT'] = _cli_port
if _cli_broker:
    os.environ['BRIDGE_ACCOUNT'] = _cli_broker

BRIDGE_PORT = int(os.environ.get('BRIDGE_PORT', 5000))
# BRIDGE_ACCOUNT lets multiple instances target different account slots
# (e.g. 2=MetaQuotes, 3=Pepperstone) — applied before anything reads credentials.
if os.environ.get('BRIDGE_ACCOUNT'):
    os.environ['MT5_ACTIVE_ACCOUNT'] = os.environ['BRIDGE_ACCOUNT']

BROKER_ID = (os.environ.get('MT5_BROKER_ID')
             or os.environ.get('MT5_ACTIVE_ACCOUNT')
             or '?')
BROKER_TAG = f'broker{BROKER_ID}'

log_dir = os.path.dirname(os.path.abspath(__file__))
# One log file per instance so multiple bridges never interleave or race rotation.
log_file = os.path.join(log_dir, f'bridge-{BROKER_TAG}.log')
handler = RotatingFileHandler(log_file, maxBytes=5_242_880, backupCount=5)
handler.setFormatter(logging.Formatter(f'%(asctime)s [%(levelname)s] [{BROKER_TAG}] %(message)s'))
_stream = logging.StreamHandler()
_stream.setFormatter(logging.Formatter(f'%(asctime)s [%(levelname)s] [{BROKER_TAG}] %(message)s'))
logger = logging.getLogger('mt5_bridge_v2')
logger.setLevel(logging.DEBUG)
logger.addHandler(handler)
logger.addHandler(_stream)

# ─── Timestamp helpers (UTC) ──────────────────────────────
# TWO clocks reach this file, and conflating them is a bug:
#
#   1. The MACHINE clock — `datetime.now(timezone.utc)`, true UTC.
#   2. The BROKER SERVER clock — everything MT5 returns (rate['time'],
#      position.time, order.time_setup, deal.time, calendar .time) is a Unix
#      epoch in SERVER time, NOT UTC. MetaQuotes-Demo runs UTC+3, so those
#      epochs read ~3h ahead of true UTC.
#
# 2026-08-15 (#625) made the output unambiguous (ISO-8601 'Z') but assumed MT5
# epochs were already UTC, so every MT5 timestamp became a *false* UTC claim
# ~3h in the future. Measured 2026-09-10: this bridge returned 5m bars stamped
# 11:55Z while true UTC was 09:02Z (+2h57m). Consequence: stored bars looked
# "fresh" for three extra hours, `ageMs` went negative, and the market-status
# staleness gate (`computeMarketStatus`, market-status.ts) could NEVER report a
# market closed — a tradability gate failing open on stale data.
#
# RULE: MT5-sourced epochs go through `utc_iso()` (which subtracts the measured
# server offset). Only the machine clock goes through `utc_now_iso()`.

SERVER_UTC_OFFSET_SECONDS = 0
_SERVER_OFFSET_MEASURED_AT = 0.0
_SERVER_OFFSET_TTL_SECONDS = 1800  # re-measure twice an hour — DST moves twice a year

# The rounding step used when deriving the offset from a tick, and the tolerance it
# implies. Rounded to 900s (15 min) because MT5 gives no cleaner source, but a
# rounding step is a TOLERANCE BUDGET: it absorbs tick lag only up to half a step,
# i.e. 450s. Past that the measurement is out of tolerance and must be rejected
# rather than applied — see the guard in `detect_server_utc_offset()` (#845).
ROUNDING_STEP_SECONDS = 900
ROUNDING_HALF_STEP_SECONDS = ROUNDING_STEP_SECONDS // 2

def detect_server_utc_offset(force=False):
    """Measure how far the broker's server clock runs ahead of true UTC.

    MT5 exposes no server-timezone field, so it is derived from the one pair of
    clocks readable at the same instant: a fresh tick's server epoch and the
    machine's true epoch.

    ⚠️ #845 — WHY THIS IS GUARDED, AND WHY THE ROUNDING IS A TOLERANCE BUDGET
    ------------------------------------------------------------------------
    `tick.time` is the timestamp of the **last tick**, NOT of the current instant.
    The expression therefore measures:

        (true_UTC + server_offset) - true_UTC_now  =  server_offset - tick_age

    so the offset is UNDER-measured by however old the tick is. Rounding to 900s
    absorbs that error only up to half a step, i.e. **450s**. Beyond that the
    measurement is out of tolerance and the residue becomes a FUTURE lead on every
    MT5-sourced timestamp:

        utc_iso(epoch) = (true_UTC + offset) - measured_offset
                       = true_UTC + rounding_residue

    MEASURED 2026-09-16: the MetaQuotes bridge reported 9900s (2h45m) against a
    true 10800s (3h) — exactly one 900s step short — while its terminal was
    DISCONNECTED, so the tick it probed could not have been fresh. That skew put
    `position.openedAt` and `trade.closedAt` up to 784s in the future and kept
    `INV-NO-FUTURE-ROWS` permanently HELD.

    Two guards follow, and both are correctness, not politeness:

      1. **Never measure while disconnected.** A probe with no live feed cannot
         produce a fresh tick. Previously this ran anyway and could OVERWRITE a
         known-good offset with a worse one — a diagnostic actively degrading the
         system it measures.
      2. **Reject a measurement beyond the tolerance budget.** If the freshest tick
         available is older than half a rounding step, the result is out of
         tolerance; keep the previous value rather than applying a known-bad one.

    Retaining a stale-but-last-known-good offset is strictly better than replacing
    it with a value that is measurably wrong: the retained value was correct when
    measured, and the offset only moves at a DST boundary (twice a year).

    ⚠️ STILL OPEN (#845): rounding to 900s is finer than the granularity brokers
    actually use (whole/half hours). Snapping to that granularity would make the
    probe robust to tick lag by construction, but it would break the rare
    `UTC+5:45`-style offset, so it is a DECISION rather than a cleanup. Guarded
    here against the two measurable failure modes only; the heuristic change is
    deliberately NOT made silently.
    """
    global SERVER_UTC_OFFSET_SECONDS, _SERVER_OFFSET_MEASURED_AT, _OFFSET_PROBE_WARNED
    now = time.time()
    if not force and _SERVER_OFFSET_MEASURED_AT and (now - _SERVER_OFFSET_MEASURED_AT) < _SERVER_OFFSET_TTL_SECONDS:
        return SERVER_UTC_OFFSET_SECONDS

    # ── Guard 1: no live feed means no valid measurement (issue #845) ──────────
    # `connected` is the terminal's own view of its link; `symbol_info_tick` can
    # still return a cached tick while the link is down, which is exactly how the
    # 9900s value was produced.
    try:
        terminal = mt5.terminal_info()
        if terminal is None or not getattr(terminal, 'connected', False):
            # ⚠️ #992 — ONCE PER STATE CHANGE, and it names the remedy.
            # This exact line appeared **4,325 times** in a single outage and never once
            # said what to do about it. The watchdog owns the messaging; this echoes the
            # edge only, and the flag is cleared the moment the link comes back so the
            # next genuine outage is still reported.
            if not _OFFSET_PROBE_WARNED:
                _OFFSET_PROBE_WARNED = True
                logger.warning(
                    'Server UTC offset probe SKIPPED — terminal not connected; '
                    f'retaining {SERVER_UTC_OFFSET_SECONDS}s. '
                    f'Remedy: POST http://127.0.0.1:{BRIDGE_PORT}/reconnect '
                    '(further occurrences suppressed until the state changes)'
                )
            return SERVER_UTC_OFFSET_SECONDS
        _OFFSET_PROBE_WARNED = False
    except Exception as err:  # pragma: no cover - defensive, never fail a request
        logger.debug(f'Server UTC offset probe could not read terminal_info: {err}')
        return SERVER_UTC_OFFSET_SECONDS

    # ── Guard 2: prefer the FRESHEST tick, and enforce the tolerance budget ────
    # One probe symbol can be illiquid while the rest of the market is ticking.
    # Take the newest tick across a small spread of liquid symbols; the newest is
    # the least-biased measurement available.
    probe_symbols = [
        s.strip()
        for s in os.environ.get('MT5_OFFSET_PROBE_SYMBOLS', 'EURUSD,GBPUSD,USDJPY,XAUUSD').split(',')
        if s.strip()
    ]
    offset_probe = os.environ.get('MT5_OFFSET_PROBE_SYMBOL')
    if offset_probe:
        probe_symbols.insert(0, offset_probe)  # explicit override still wins

    freshest_epoch = None
    freshest_symbol = None
    for symbol in probe_symbols:
        try:
            tick = mt5.symbol_info_tick(symbol)
        except Exception:
            continue
        if tick and tick.time and (freshest_epoch is None or tick.time > freshest_epoch):
            freshest_epoch = tick.time
            freshest_symbol = symbol

    if freshest_epoch is None:
        logger.debug('Server UTC offset probe SKIPPED — no tick available; retaining previous value')
        return SERVER_UTC_OFFSET_SECONDS

    # `>= 0` guards against a tick that is genuinely ahead of the wall clock.
    tick_age = max(0, now - (freshest_epoch - SERVER_UTC_OFFSET_SECONDS))
    if tick_age > ROUNDING_HALF_STEP_SECONDS:
        logger.warning(
            f'Server UTC offset probe REJECTED — freshest tick ({freshest_symbol}) is '
            f'{tick_age:.0f}s old, beyond the {ROUNDING_HALF_STEP_SECONDS}s tolerance budget '
            f'of the {ROUNDING_STEP_SECONDS}s rounding step. Retaining '
            f'{SERVER_UTC_OFFSET_SECONDS}s rather than applying a biased measurement (#845).'
        )
        return SERVER_UTC_OFFSET_SECONDS

    measured = int(round((freshest_epoch - now) / ROUNDING_STEP_SECONDS) * ROUNDING_STEP_SECONDS)
    if measured != SERVER_UTC_OFFSET_SECONDS:
        logger.info(
            f'Server UTC offset measured: {measured}s ({measured / 3600.0:.2f}h) from '
            f'{freshest_symbol} tick {tick_age:.0f}s old — was {SERVER_UTC_OFFSET_SECONDS}s'
        )
    SERVER_UTC_OFFSET_SECONDS = measured
    _SERVER_OFFSET_MEASURED_AT = now
    return SERVER_UTC_OFFSET_SECONDS

def utc_iso(epoch_seconds):
    """MT5 SERVER-clock epoch seconds -> true-UTC ISO-8601 string with 'Z'.

    All 12 call sites are MT5-sourced (rates, positions, orders, deals,
    calendar), so the server offset is applied here rather than at each call.
    """
    if epoch_seconds is None:
        return None
    return datetime.fromtimestamp(
        epoch_seconds - detect_server_utc_offset(), tz=timezone.utc
    ).isoformat().replace('+00:00', 'Z')

def utc_now_iso():
    """Current MACHINE time -> ISO-8601 string with 'Z' suffix (already true UTC)."""
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

# ─── MT5 Connection ───────────────────────────────────────

import MetaTrader5 as mt5
logger.info('MetaTrader5 package loaded')

connection_errors = 0
last_connection_attempt = None

# ─── Risk Limits (from env) ──────────────────────────────

MAX_POSITION_SIZE = float(os.environ.get('MT5_MAX_POSITION_SIZE', '5.0'))       # max volume per position
MAX_DAILY_LOSS = float(os.environ.get('MT5_MAX_DAILY_LOSS', '500.0'))            # stop if daily loss exceeded
MAX_OPEN_POSITIONS = int(os.environ.get('MT5_MAX_OPEN_POSITIONS', '10'))         # cap total positions

# ─── Idempotency Store ────────────────────────────────────

recent_orders = {}  # key: clientOrderId → {ticket, symbol, volume, time, status}
IDEMPOTENCY_WINDOW_SEC = 60  # deduplication window

# ─── Circuit Breaker ──────────────────────────────────────

CIRCUIT_BREAKER_THRESHOLD = int(os.environ.get('MT5_CIRCUIT_BREAKER_THRESHOLD', '10'))  # failures before trip
CIRCUIT_BREAKER_COOLDOWN = int(os.environ.get('MT5_CIRCUIT_BREAKER_COOLDOWN', '300'))    # seconds to stay open
circuit_state = 'closed'       # closed | open | half-open
circuit_failures = 0
circuit_opened_at = None       # timestamp when tripped

def is_duplicate_order(client_order_id):
    """Check if a clientOrderId was already used in the idempotency window."""
    if not client_order_id:
        return False, None
    now = time.time()
    # Clean expired entries
    expired = [k for k, v in recent_orders.items() if now - v['time'] > IDEMPOTENCY_WINDOW_SEC]
    for k in expired:
        del recent_orders[k]
    if client_order_id in recent_orders:
        return True, recent_orders[client_order_id]
    return False, None

# ─── Trade Journal ────────────────────────────────────────

def journal_trade(action, details):
    """Structured trade journal entry to bridge log."""
    entry = {'timestamp': datetime.now().isoformat(), 'action': action}
    entry.update(details)
    logger.info(f'[TRADE JOURNAL] {json.dumps(entry)}')

# ─── Order filling mode (#824) ────────────────────────────
#
# ⚠️ ALWAYS put `type_filling` on a market (TRADE_ACTION_DEAL) request. When the
# field is absent MT5 applies its own default (FOK), and a broker that does not
# accept FOK for that instrument refuses the order with retcode 10030
# "Unsupported filling mode" — a message that names neither the symbol, the
# attempted mode, nor the modes that WOULD work.
#
# Measured 2026-09-15 (issue #824): the Pepperstone account failed EVERY order
# this way (0 placed / 2 failed) while MetaQuotes-Demo filled normally
# (8 placed / 0 failed), because MetaQuotes accepts the FOK default. The defect
# is therefore invisible unless the order goes through the restricted broker.
#
# `symbol_info().filling_mode` is a BITMASK of what the broker allows:
#   SYMBOL_FILLING_FOK = 1
#   SYMBOL_FILLING_IOC = 2
# RETURN is not represented in the mask (it is assumed available).

def pick_filling_name(mask):
    """Pure decision: a symbol filling_mode bitmask -> 'IOC' | 'FOK' | 'RETURN'.

    Deliberately free of the MT5 API and of all module state, so the policy can
    be tested without a terminal — see scripts/mt5-bridge/test_filling_modes.py.
    IOC is preferred: it is the mode ECN-style brokers (Pepperstone) allow on
    instruments they will not FOK.
    """
    if mask & 2:      # SYMBOL_FILLING_IOC
        return 'IOC'
    if mask & 1:      # SYMBOL_FILLING_FOK
        return 'FOK'
    return 'RETURN'


def symbol_filling(symbol):
    """(mode name, raw mask, allowed names) the broker permits for `symbol`."""
    info = mt5.symbol_info(symbol)
    mask = int(getattr(info, 'filling_mode', 0) or 0) if info else 0
    allowed = [n for n, bit in (('FOK', 1), ('IOC', 2)) if mask & bit]
    return pick_filling_name(mask), mask, allowed


def apply_filling(req, symbol):
    """Set `type_filling` on a market-order request. Returns (name, mask).

    Falls back cleanly when the mt5 module exposes no matching constant, so a
    missing attribute can never stop an order outright.
    """
    name, mask, _ = symbol_filling(symbol)
    const = getattr(mt5, 'ORDER_FILLING_' + name, None)
    if const is not None:
        req['type_filling'] = const
    return name, mask


def order_rejected(result, symbol, filling_name, mask):
    """Diagnostic error text for a refused order (#824).

    The bridge used to return the broker's bare `result.comment`, so the Signals
    card showed "Unsupported filling mode" with no symbol, no retcode and no
    remedy. Keep the broker's text, but add the three facts needed to act on it.
    """
    allowed = [n for n, bit in (('FOK', 1), ('IOC', 2)) if mask & bit]
    retcode = getattr(result, 'retcode', None)
    comment = getattr(result, 'comment', None) or str(mt5.last_error())
    return (f"{symbol} rejected (retcode {retcode}, filling={filling_name}): {comment}. "
            f"Broker allows: {', '.join(allowed) if allowed else 'none reported'}.")

# ─── Notice codes (#826 Phase 3) ──────────────────────────
#
# The bridge is Python and CANNOT import the JS registry (src/core/notices/registry.js), so it
# emits the CODE plus the DATA and the client renders the wording. A code used here but missing
# from the registry FAILS THE BUILD: scripts/validate-notices.cjs scans scripts/ for `TCS-…`
# literals and checks every one is registered. That scan is the guard against the two lists
# drifting apart, which is the whole risk of a two-language code list.
NOTICE_NOT_CONNECTED    = 'TCS-INTEG-001'
NOTICE_CIRCUIT_OPEN     = 'TCS-INTEG-002'
NOTICE_FILLING          = 'TCS-TRADE-001'
NOTICE_NOT_TRADEABLE    = 'TCS-TRADE-004'
NOTICE_ORDER_REJECTED   = 'TCS-TRADE-005'
NOTICE_NO_QUOTE         = 'TCS-TRADE-010'
NOTICE_VOLUME_MIN       = 'TCS-TRADE-011'
NOTICE_VOLUME_MAX       = 'TCS-TRADE-012'
NOTICE_SPREAD           = 'TCS-TRADE-013'
NOTICE_POSITION_MISSING = 'TCS-TRADE-014'
NOTICE_DUPLICATE        = 'TCS-TRADE-015'
NOTICE_SIZE_CAP         = 'TCS-TRADE-016'
NOTICE_POSITION_CAP     = 'TCS-TRADE-017'
NOTICE_MARGIN           = 'TCS-TRADE-003'


def refusal(code, message, params=None, external=None):
    """Error body for a refusal: the CODE identifies the condition, `params` carry the data, and
    `message` keeps the bridge/broker wording for the log and for anyone reading raw JSON."""
    out = {'success': False, 'error': message, 'code': code}
    if params:
        out['params'] = params
    if external:
        out['external'] = external
    return out


def mt5_external(result):
    """The broker's own retcode as a look-up-able external code (MT5 documents these)."""
    rc = getattr(result, 'retcode', None)
    if rc is None:
        return None
    names = {getattr(mt5, n): n for n in dir(mt5) if n.startswith('TRADE_RETCODE_')}
    return {'system': 'MetaTrader 5', 'code': rc, 'name': names.get(rc, 'UNKNOWN')}


def rejection_code(result):
    """Map a broker RETCODE to a notice code.

    ⚠️ This reads a STRUCTURED field, never the broker's free-text comment. Matching on prose
    breaks the moment a broker rewords, and removing that class of guesswork is why the registry
    exists — see the note in src/core/notices/from-error.js.
    """
    invalid_fill = getattr(mt5, 'TRADE_RETCODE_INVALID_FILL', 10030)
    return NOTICE_FILLING if getattr(result, 'retcode', None) == invalid_fill else NOTICE_ORDER_REJECTED


def rejection_params(symbol, filling_name, mask):
    """Params for a broker rejection.

    TRADE-001 needs all four of these; TRADE-005 ignores the extras, so one call site can serve
    both codes without knowing which one it will get. `broker` comes from the terminal, not from
    config, so a multi-broker setup reports the account it actually sent to.
    """
    acct = mt5.account_info()
    allowed = [n for n, bit in (('FOK', 1), ('IOC', 2)) if mask & bit]
    return {
        'symbol': symbol,
        'mode': filling_name,
        'broker': getattr(acct, 'server', None) or 'the broker',
        'allowed': ', '.join(allowed) if allowed else 'none reported',
    }


def unavailable_response(err):
    """503 body for 'the bridge cannot serve this request'.

    The circuit breaker and 'terminal not connected' are DIFFERENT conditions, and the difference
    is read from circuit STATE — not by inspecting the message text.
    """
    code = NOTICE_CIRCUIT_OPEN if circuit_state == 'open' else NOTICE_NOT_CONNECTED
    return refusal(code, str(err), {'detail': str(err)})


def get_active_credentials():
    active = os.environ.get('MT5_ACTIVE_ACCOUNT', '1')
    account = os.environ.get(f'MT5_ACCOUNT_{active}', os.environ.get('MT5_ACCOUNT', ''))
    password = os.environ.get(f'MT5_PASSWORD_{active}', os.environ.get('MT5_PASSWORD', ''))
    server = os.environ.get(f'MT5_SERVER_{active}', os.environ.get('MT5_SERVER', 'MetaQuotes-Demo'))
    path = os.environ.get(f'MT5_PATH_{active}', os.environ.get('MT5_PATH', '')) or None
    return account, password, server, active, path

def list_accounts():
    accounts = []
    active_slot = os.environ.get('MT5_ACTIVE_ACCOUNT', '1')
    for i in range(1, 100):
        acc = os.environ.get(f'MT5_ACCOUNT_{i}', '')
        if not acc:
            continue
        # Validate: MT5 logins must be numeric
        try:
            int(acc)
        except (ValueError, TypeError):
            logger.warning(f'Skipping invalid account #{i}: "{acc}" is not a numeric MT5 login')
            continue
        accounts.append({
            'number': i,
            'login': acc,
            'server': os.environ.get(f'MT5_SERVER_{i}', ''),
            'path': os.environ.get(f'MT5_PATH_{i}', '') or None,
            'active': str(i) == str(active_slot),
        })
    return accounts

def get_env_path():
    """Resolve the .env file path (same logic as startup)."""
    return os.path.join(os.path.dirname(__file__), '..', '..', 'nest', '.env')

def save_env_file():
    """Persist current os.environ MT5 account entries back to .env file.
    Preserves non-MT5 lines and updates only MT5_ACCOUNT/PASSWORD/SERVER/ACTIVE entries.
    """
    env_path = get_env_path()
    if not os.path.exists(env_path):
        logger.warning(f'.env file not found at {env_path} — skipping persistence')
        return

    # Collect current MT5 env entries
    mt5_keys = set()
    for key in os.environ:
        if key.startswith('MT5_ACCOUNT_') or key.startswith('MT5_PASSWORD_') or key.startswith('MT5_SERVER_') or key == 'MT5_ACTIVE_ACCOUNT':
            mt5_keys.add(key)

    with open(env_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # Remove old MT5 entries, append new ones at the end of the MT5 block
    new_lines = []
    in_mt5_block = False
    mt5_written = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('# --- MT5') or stripped.startswith('MT5_BRIDGE_URL='):
            in_mt5_block = True
            new_lines.append(line)
            continue
        if in_mt5_block and (stripped.startswith('# Account') or stripped.startswith('MT5_ACCOUNT_') or
                             stripped.startswith('MT5_PASSWORD_') or stripped.startswith('MT5_SERVER_') or
                             stripped.startswith('MT5_ACTIVE_ACCOUNT=') or stripped.startswith('# Active')):
            if not mt5_written:
                # Write all current accounts in slot order
                active_slot = os.environ.get('MT5_ACTIVE_ACCOUNT', '1')
                for i in range(1, 100):
                    acc = os.environ.get(f'MT5_ACCOUNT_{i}', '')
                    if not acc:
                        continue
                    try:
                        int(acc)
                    except (ValueError, TypeError):
                        continue
                    server = os.environ.get(f'MT5_SERVER_{i}', '')
                    new_lines.append(f'# Account {i}: {server or acc}\n')
                    new_lines.append(f'MT5_ACCOUNT_{i}={acc}\n')
                    new_lines.append(f'MT5_PASSWORD_{i}={os.environ.get(f"MT5_PASSWORD_{i}", "")}\n')
                    new_lines.append(f'MT5_SERVER_{i}={server}\n')
                    new_lines.append('\n')
                new_lines.append(f'# Active account\n')
                new_lines.append(f'MT5_ACTIVE_ACCOUNT={active_slot}\n')
                new_lines.append('\n')
                mt5_written = True
            continue
        if in_mt5_block and stripped == '' and not mt5_written:
            new_lines.append(line)
            continue
        # End of MT5 block (empty line after MT5 entries, or next section)
        if in_mt5_block and mt5_written and (stripped.startswith('#') and not stripped.startswith('# Account') and not stripped.startswith('# Active')):
            in_mt5_block = False
        new_lines.append(line)

    with open(env_path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

    logger.info(f'Persisted {sum(1 for k in mt5_keys if k.startswith("MT5_ACCOUNT_"))} accounts to {env_path}')


def timeframe_to_mt5(tf):
    mapping = {'1m': mt5.TIMEFRAME_M1,'5m': mt5.TIMEFRAME_M5,'15m': mt5.TIMEFRAME_M15,
               '30m': mt5.TIMEFRAME_M30,'1h': mt5.TIMEFRAME_H1,'4h': mt5.TIMEFRAME_H4,
               '1d': mt5.TIMEFRAME_D1,'1w': mt5.TIMEFRAME_W1,'1mn': mt5.TIMEFRAME_MN1}
    return mapping.get(tf.lower(), mt5.TIMEFRAME_H1)

def check_circuit_breaker():
    """Returns True if circuit is open (requests blocked). Handles auto-reset."""
    global circuit_state, circuit_failures, circuit_opened_at
    if circuit_state == 'open':
        if circuit_opened_at and (time.time() - circuit_opened_at) >= CIRCUIT_BREAKER_COOLDOWN:
            circuit_state = 'half-open'
            logger.info('Circuit breaker: half-open (cooldown expired, testing connection)')
            return False  # allow one attempt
        return True  # still blocking
    return False

def trip_circuit_breaker():
    """Trip the circuit breaker after threshold failures."""
    global circuit_state, circuit_failures, circuit_opened_at
    circuit_failures += 1
    if circuit_failures >= CIRCUIT_BREAKER_THRESHOLD and circuit_state != 'open':
        circuit_state = 'open'
        circuit_opened_at = time.time()
        logger.warning(f'Circuit breaker TRIPPED: {circuit_failures} consecutive failures, blocking for {CIRCUIT_BREAKER_COOLDOWN}s')

def reset_circuit_breaker():
    """Reset circuit breaker after successful connection."""
    global circuit_state, circuit_failures, circuit_opened_at
    if circuit_state != 'closed':
        logger.info('Circuit breaker: reset (connection restored)')
    circuit_state = 'closed'
    circuit_failures = 0
    circuit_opened_at = None

# ── Bounded MT5 connect (#1000) ───────────────────────────────────────────────
# `mt5.initialize()` accepts a `timeout` in MILLISECONDS and defaults to 60s — but when the
# terminal is unreachable it can hold the interpreter far longer, and NOTHING else in this process
# runs while it does.
#
# ⚠️ MEASURED 2026-09-25, and this is why the constant exists. A canary bridge on :5002 pointed at
# a bogus server: the log reached `Initializing MT5:` and STOPPED. The socket WAS bound (the server
# is started before the connect now) so the kernel accepted the TCP connection — but `GET /health`
# never answered, timing out after 15s. **The native call does not release the GIL**, so the
# serving thread never runs. Binding the port first is necessary and NOT sufficient; the connect
# itself must be BOUNDED, which is what this timeout does.
#
# Setting it makes a failed connect RETURN instead of hanging, which is the difference between a
# bridge that can report its own state and one that can only be killed.
MT5_INIT_TIMEOUT_MS = int(os.environ.get('MT5_INIT_TIMEOUT_MS', '20000'))


def connect_mt5():
    """Initialize MT5 connection — called at startup and on /reconnect."""
    global connection_errors
    if check_circuit_breaker():
        return False, 'Circuit breaker open — too many connection failures, cooling down'
    account, password, server, active, path = get_active_credentials()
    path_str = f', path={path}' if path else ''
    logger.info(f'Initializing MT5: server={server}, account={account} (account #{active}){path_str}')

    initialized = False
    if path:
        # Terminal-specific path: connect to an already-running broker terminal
        # without credentials (it should already be logged in). Launching with
        # login+password+path fails with "Process create failed" if terminal
        # is already running — the path is for targeting, not launching.
        initialized = mt5.initialize(path=path, timeout=MT5_INIT_TIMEOUT_MS)
        if not initialized:
            # Fallback: try launching the terminal with full credentials
            logger.info(f'Path-only init failed, trying with credentials: {mt5.last_error()}')
            initialized = mt5.initialize(login=int(account), password=password, server=server, path=path, timeout=MT5_INIT_TIMEOUT_MS)
    else:
        initialized = mt5.initialize(login=int(account), password=password, server=server, timeout=MT5_INIT_TIMEOUT_MS)

    if initialized:
        connection_errors = 0
        reset_circuit_breaker()
        info = mt5.account_info()
        logger.info(f'MT5 connected: {info.login} @ {info.server}, balance={info.balance}')
        # Re-measure the broker's clock offset on every (re)connect. MT5 epochs
        # are SERVER time; stamping them as UTC put every timestamp ~3h in the
        # future and defeated the market-status staleness gate (2026-09-10).
        offset = detect_server_utc_offset(force=True)
        logger.info(
            f'Broker server clock offset: {offset}s ({offset / 3600:+.2f}h) vs true UTC '
            f'— applied to all MT5-sourced timestamps'
        )
        return True, None
    error = mt5.last_error()
    connection_errors += 1
    trip_circuit_breaker()
    logger.error(f'MT5 initialization failed: {error}')
    return False, str(error)

def ensure_mt5():
    """Check MT5 is connected. NEVER reinitialize from request handlers."""
    global connection_errors
    try:
        if mt5.terminal_info() is not None and mt5.account_info() is not None:
            return True, None
    except (RuntimeError, Exception):
        pass
    connection_errors += 1
    return False, 'MT5 not connected'


# ── Connection health + auto-reconnect watchdog (#992) ─────────────────────
#
# ⚠️ WHY THIS EXISTS, AND WHY IT IS NOT IN A REQUEST HANDLER.
#
# Measured 2026-09-25: an MT5 terminal session dropped AFTER a successful startup.
# The bridge had connected fine (it logged the balance), then lost the handle. From
# then on it wrote 'terminal not connected' **4,325 times** and attempted NOTHING.
# Trading on that broker was halted until a human called POST /reconnect, which fixed
# it in ONE call (connectionErrors 485 -> 0).
#
# `ensure_mt5()` above is RIGHT to refuse reinitializing from a request handler — a
# handler must not tear a session down while another thread is mid-order. But that
# refusal left **no component responsible for recovery**. This watchdog is that
# component. It runs on its own daemon thread, so a rebuild cannot race a request.
#
# ⚠️ IT MUST NOT FIGHT A GENUINELY-CLOSED TERMINAL. Reconnecting on a loop against a
# terminal that is simply switched off is the restart-thrash this repo already paid
# for once. So it backs off, and once it has established the terminal itself is
# ABSENT it stops escalating — reconnecting cannot help there, and saying so is the
# honest output rather than another attempt.

STATE_OK = 'ok'
STATE_SESSION_LOST = 'session-lost'
STATE_TERMINAL_DOWN = 'terminal-down'
STATE_ACCOUNT_UNAVAILABLE = 'account-unavailable'

# The last state the watchdog OBSERVED. Logging is driven by CHANGES in this, which is
# what turns 4,325 identical lines into one line with the remedy (#992).
_CONNECTION_STATE = None
_CONNECTION_STATE_DETAIL = None

# Throttle for the offset probe's 'terminal not connected' line (#992). The probe is
# called on every request, so an unthrottled line is 4x/minute forever.
_OFFSET_PROBE_WARNED = False

WATCHDOG_POLL_SECONDS = float(os.environ.get('MT5_WATCHDOG_POLL_SECONDS', '30'))
WATCHDOG_FAILURES_BEFORE_RECONNECT = int(os.environ.get('MT5_WATCHDOG_FAILURES', '3'))
WATCHDOG_MAX_BACKOFF_SECONDS = float(os.environ.get('MT5_WATCHDOG_MAX_BACKOFF_SECONDS', '1800'))


def probe_connection_state():
    """Classify the MT5 link WITHOUT changing it. Returns (state, detail).

    ⚠️ THIS IS THE DISTINCTION #992 ASKS FOR, AND IT DID NOT EXIST. `reachable:false`
    collapsed two unrelated faults into one flag:

      * the terminal is RUNNING but its session dropped  -> `session-lost`
        ...and `/reconnect` is the remedy.
      * the terminal is ABSENT (switched off / not running) -> `terminal-down`
        ...and reconnecting CANNOT help; the remedy is to start it.

    Those need different actions, so they must not read the same.
    """
    try:
        terminal = mt5.terminal_info()
    except Exception as err:  # pragma: no cover - defensive
        return STATE_TERMINAL_DOWN, f'terminal_info() raised: {err}'
    if terminal is None:
        return STATE_TERMINAL_DOWN, 'terminal_info() is None — terminal not running or not reachable'
    if not getattr(terminal, 'connected', False):
        return STATE_SESSION_LOST, 'terminal is running but its session is not connected'
    try:
        if mt5.account_info() is None:
            return STATE_ACCOUNT_UNAVAILABLE, 'terminal connected, account_info() is None'
    except Exception as err:  # pragma: no cover - defensive
        return STATE_ACCOUNT_UNAVAILABLE, f'account_info() raised: {err}'
    return STATE_OK, None


def reconnect_mt5(reason):
    """The SAME sequence `POST /reconnect` runs, callable from the watchdog (#992).

    Extracted so there is ONE reconnect implementation. A second copy would drift,
    and only one of them would receive the next fix — the failure mode this repo
    warns about most often.
    """
    logger.warning(f'Reconnecting MT5: {reason}')
    try:
        mt5.shutdown()
    except Exception as err:  # a failed shutdown must not block the re-init
        logger.warning(f'Reconnect: shutdown() raised, continuing: {err}')
    time.sleep(1)
    ok, err = connect_mt5()
    if ok:
        info = mt5.account_info()
        logger.warning(
            f'MT5 reconnect SUCCEEDED — account={info.login if info else "?"} '
            f'balance={info.balance if info else "?"}'
        )
        return True, None
    logger.error(f'MT5 reconnect FAILED: {err}')
    return False, err


def _log_state_change(state, detail):
    """Log ONCE per state change, and ALWAYS name the remedy (#992).

    The defect was not that the bridge logged too little — it logged the same benign
    condition 4,325 times and never once said what to do about it. A log line that
    cannot be acted on is noise; the remedy is the part that matters.
    """
    if state == STATE_OK:
        logger.info('MT5 connection state -> ok (recovered).')
        return
    remedy = f'POST http://127.0.0.1:{BRIDGE_PORT}/reconnect'
    if state == STATE_TERMINAL_DOWN:
        remedy += ' — or START THE MT5 TERMINAL: reconnecting cannot help while it is absent'
    logger.error(f'MT5 connection state -> {state}: {detail}. Remedy: {remedy}')


def connection_watchdog():
    """Daemon thread: observe the MT5 link and recover a dropped session (#992).

    Deliberately conservative. It waits for WATCHDOG_FAILURES_BEFORE_RECONNECT
    consecutive bad polls (so a single blip never triggers a rebuild), backs off
    exponentially up to WATCHDOG_MAX_BACKOFF_SECONDS, and stops escalating entirely
    once the terminal itself is absent.

    ── DECISION (2026-09-25, primary) ────────────────────────────────────────────
    WHAT:      This thread recovers a dropped SESSION. It is NOT capable of
               recovering the bridge from a blocking native call, and it must not
               be treated as if it were.
    WHY:       This process is SINGLE-THREADED BY DESIGN (http.server, no Flask),
               and `mt5.initialize()` / `mt5.terminal_info()` BLOCK THE INTERPRETER
               when the terminal is unreachable. Measured live on broker 2,
               2026-09-25: the watchdog classified terminal-down -> ok (recovered)
               -> session-lost correctly, then WEDGED. No auto-recovery fired, the
               log froze, and :5000 began refusing connections while the process
               stayed alive (13 threads, 22.8s CPU). The HTTP server had stopped
               accepting, and the watchdog's own probe was blocked inside
               mt5.terminal_info() - it can hang at exactly the moment it is needed.
               Independently reproduced on a throwaway :5002 bridge: with the
               watchdog started BEFORE the connect, the log stops at
               'Initializing MT5' and never advances.
    INSTEAD OF: Making this thread more aggressive, adding a second in-process
               watchdog, or lowering WATCHDOG_FAILURES_BEFORE_RECONNECT. All three
               assume the thread gets to run, which is the thing in question.
    SUPERSEDED IN PART (2026-09-25, measured - do not drop this line):
               The connect is now BOUNDED. `MT5_INIT_TIMEOUT_MS` is passed to every
               `mt5.initialize()` (it was never passed before, which is why the call
               could hold the interpreter forever), and the :5002 canary shows the
               connect RETURNING after ~9s and `/health` then ANSWERING with
               `state=terminal-down` and the remedy. So the STARTUP hang is covered
               IN-PROCESS, no supervisor is needed, and `scripts/tcs-launch.ps1` is
               untouched.
               WHAT IS *NOT* SUPERSEDED: an in-process thread still cannot act
               DURING a blocking call, so nothing here licenses a SECOND in-process
               watchdog; and a bridge that wedges AFTER a successful connect is still
               uncovered - this removes the startup hold, not every hold.
    REVERSE BY: Removing the `timeout=` argument, or shrinking the default below a
               real connect's cost (measured ~11ms on a live bridge, so the 20s
               default has ~2000x headroom). Re-run the :5002 canary to see the
               connect hang again.
    REGISTER:  docs/SETTLED-DECISIONS.md row 37
    GUARD:     scripts/mt5-bridge/test_connection_watchdog.py (13 tests - canaried
               both directions, but they cover CLASSIFICATION ONLY; nothing here
               fails if this limitation is forgotten)
    """
    global _CONNECTION_STATE, _CONNECTION_STATE_DETAIL
    failures = 0
    backoff = WATCHDOG_POLL_SECONDS
    next_attempt_at = 0.0
    while True:
        time.sleep(WATCHDOG_POLL_SECONDS)
        try:
            state, detail = probe_connection_state()
        except Exception as err:  # pragma: no cover - the watchdog must never die
            logger.warning(f'Connection watchdog probe failed: {err}')
            continue

        if state != _CONNECTION_STATE:
            _log_state_change(state, detail)
            _CONNECTION_STATE = state
            _CONNECTION_STATE_DETAIL = detail

        if state == STATE_OK:
            failures = 0
            backoff = WATCHDOG_POLL_SECONDS
            next_attempt_at = 0.0
            continue

        failures += 1

        # ⚠️ A terminal that is ABSENT is not a session we can rebuild. Say so and
        # stop escalating rather than reconnecting forever against nothing.
        if state == STATE_TERMINAL_DOWN:
            continue

        if failures < WATCHDOG_FAILURES_BEFORE_RECONNECT:
            continue
        if time.time() < next_attempt_at:
            continue

        ok, _err = reconnect_mt5(f'watchdog: {failures} consecutive bad polls in state {state} ({detail})')
        if ok:
            failures = 0
            backoff = WATCHDOG_POLL_SECONDS
            next_attempt_at = 0.0
        else:
            next_attempt_at = time.time() + backoff
            backoff = min(backoff * 2, WATCHDOG_MAX_BACKOFF_SECONDS)
            logger.warning(f'Next auto-reconnect attempt in {int(backoff)}s (backing off).')

# ─── JSON Helpers ─────────────────────────────────────────

def json_response(handler, data, status=200):
    body = json.dumps(data, default=str).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json')
    handler.send_header('Content-Length', str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)

def read_body(handler):
    length = int(handler.headers.get('Content-Length', 0))
    if length == 0: return {}
    return json.loads(handler.rfile.read(length))

# ─── Bulk helpers (symbol-count agnostic — scales to hundreds/thousands) ──────

def _parse_symbols(q, body=None):
    """Collect a symbol list from a POST body (`symbols`) or GET query
    (`symbols=A,B,C` or repeated `symbol=A`). Uppercased + de-duped, order kept."""
    raw = []
    if body:
        raw = body.get('symbols') or []
    if not raw:
        joined = q.get('symbols', [''])[0]
        if joined:
            raw = joined.split(',')
    if not raw:
        raw = q.get('symbol', [])
    seen, out = set(), []
    for s in raw:
        sym = str(s).strip().upper()
        if sym and sym not in seen:
            seen.add(sym)
            out.append(sym)
    return out

def quote_payload(symbol):
    """(payload, error) for one symbol's tick. payload is None on failure."""
    symbol = (symbol or '').upper()
    if not symbol:
        return None, 'symbol required'
    tick = mt5.symbol_info_tick(symbol)
    if not tick:
        mt5.symbol_select(symbol, True)
        tick = mt5.symbol_info_tick(symbol)
    if not tick:
        return None, f'{symbol} not available'
    return {'symbol': symbol, 'bid': tick.bid, 'ask': tick.ask,
            'last': tick.last or tick.bid, 'timestamp': utc_now_iso()}, None

def candles_payload(symbol, tf='1h', limit=100):
    """(payload, error) for one symbol's OHLCV. Always returns a payload shape
    (empty bars) when the symbol exists but has no data."""
    symbol = (symbol or '').upper()
    if not symbol:
        return None, 'symbol required'
    try:
        limit = max(1, min(int(limit), 1000))
    except (TypeError, ValueError):
        limit = 100
    mt5.symbol_select(symbol, True)
    rates = mt5.copy_rates_from_pos(symbol, timeframe_to_mt5(tf), 0, limit)
    if rates is None or len(rates) == 0:
        return {'symbol': symbol, 'timeframe': tf, 'bars': []}, None
    bars = [{'timestamp': utc_iso(r['time']), 'open': float(r['open']),
             'high': float(r['high']), 'low': float(r['low']), 'close': float(r['close']),
             'volume': int(r['tick_volume'])} for r in rates]
    return {'symbol': symbol, 'timeframe': tf, 'bars': bars}, None

def handle_bulk_quotes(handler, q, body=None):
    """Bulk quotes: {quotes:[...], errors:[{symbol,error}], count}"""
    ok, err = ensure_mt5()
    if not ok:
        return json_response(handler, {'connected': False, 'error': str(err)}, 503)
    symbols = _parse_symbols(q, body)
    if not symbols:
        return json_response(handler, {'error': 'symbols required (body.symbols or ?symbols=A,B)'}, 400)
    quotes, errors = [], []
    for s in symbols:
        payload, perr = quote_payload(s)
        if payload:
            quotes.append(payload)
        else:
            errors.append({'symbol': s, 'error': perr})
    return json_response(handler, {'quotes': quotes, 'errors': errors, 'count': len(quotes)})

def handle_bulk_candles(handler, q, body=None):
    """Bulk candles: {results:[{symbol,timeframe,bars}], errors:[...], count}.
    Supports a shared timeframe/limit, plus per-symbol overrides via
    body.perSymbol = { 'SYM': { 'timeframe': '1d', 'limit': 200 } } so any
    symbol can carry its own requirements."""
    ok, err = ensure_mt5()
    if not ok:
        return json_response(handler, {'connected': False, 'error': str(err)}, 503)
    symbols = _parse_symbols(q, body)
    if not symbols:
        return json_response(handler, {'error': 'symbols required (body.symbols or ?symbols=A,B)'}, 400)
    body = body or {}
    tf = body.get('timeframe') or q.get('timeframe', ['1h'])[0]
    limit = body.get('limit') or q.get('limit', ['100'])[0]
    per_symbol = body.get('perSymbol') or {}
    results, errors = [], []
    for s in symbols:
        override = per_symbol.get(s) or {}
        s_tf = override.get('timeframe', tf)
        s_limit = override.get('limit', limit)
        payload, perr = candles_payload(s, s_tf, s_limit)
        if payload is not None:
            results.append(payload)
        else:
            errors.append({'symbol': s, 'error': perr})
    return json_response(handler, {'results': results, 'errors': errors, 'count': len(results)})

# ─── HTTP Handler ─────────────────────────────────────────

class BridgeHandler(BaseHTTPRequestHandler):

    def do_GET(self):
        p = urlparse(self.path)
        q = parse_qs(p.query)
        path = p.path.rstrip('/')
        parts = [x for x in path.split('/') if x]

        try:
            # /health
            if path == '/health':
                connected, err = ensure_mt5()
                acc = mt5.account_info() if connected else None
                acct, _, _, active_num, _ = get_active_credentials()
                # ⚠️ #992 — `connected:false` named the SYMPTOM and nothing else, so a caller
                # could not tell "the terminal is switched off" from "the bridge lost its
                # handle and could fix itself if asked". These fields are that distinction,
                # and `connectionState` is what lets the watchdog be judged from OUTSIDE the
                # Python log — which is where its evidence used to live and rot.
                conn_state, conn_detail = probe_connection_state()
                return json_response(self, {
                    'connected': connected, 'mt5Package': True,
                    'connectionState': conn_state,
                    'connectionStateDetail': conn_detail,
                    'remedy': None if conn_state == STATE_OK else (
                        f'POST http://127.0.0.1:{BRIDGE_PORT}/reconnect'
                        + (' — or start the MT5 terminal' if conn_state == STATE_TERMINAL_DOWN else '')
                    ),
                    'serverUtcOffsetSeconds': detect_server_utc_offset(),
                    'serverUtcOffsetHours': round(detect_server_utc_offset() / 3600.0, 2),
                    'activeAccount': active_num,
                    'account': str(acc.login) if acc else None,
                    'server': acc.server if acc else None,
                    'balance': float(acc.balance) if acc else None,
                    'equity': float(acc.equity) if acc else None,
                    'connectionErrors': connection_errors,
                    'circuitBreaker': {'state': circuit_state, 'failures': circuit_failures, 'threshold': CIRCUIT_BREAKER_THRESHOLD, 'cooldown': CIRCUIT_BREAKER_COOLDOWN},
                    # ⚠️ Effective risk limits (#773).
                    #
                    # These are read from the environment at IMPORT (see the constants at the
                    # top of this file), so editing `.env` does NOT take effect until this
                    # process is restarted. Nothing used to expose that.
                    #
                    # MEASURED 2026-09-19: `nest/.env` said MT5_MAX_OPEN_POSITIONS=20 while
                    # the RUNNING bridge still enforced 5 — the two were written 6.5 hours
                    # apart and there was no way to tell from outside. The app's own cap
                    # (`risk.maxOpenPositions`) was already 20, so the two silently disagreed
                    # and the bridge was the binding constraint: 28 orders refused in 12h
                    # with 'Max open positions (5) reached'.
                    #
                    # Publishing them here is what makes a stale read VISIBLE. A limit that
                    # disagrees with the app is a config bug you otherwise cannot see.
                    'riskLimits': {
                        'maxOpenPositions': MAX_OPEN_POSITIONS,
                        'maxPositionSize': MAX_POSITION_SIZE,
                        'maxDailyLoss': MAX_DAILY_LOSS,
                    },
                })

            # /broker — instance identity + capability (#747)
            if path == '/broker':
                ok, err = ensure_mt5()
                acc = mt5.account_info() if ok else None
                return json_response(self, {
                    'brokerId': BROKER_ID,
                    'brokerTag': BROKER_TAG,
                    'port': BRIDGE_PORT,
                    'connected': ok,
                    'activeAccount': os.environ.get('MT5_ACTIVE_ACCOUNT'),
                    'account': str(acc.login) if acc else None,
                    'server': acc.server if acc else None,
                    'currency': acc.currency if acc else None,
                    'leverage': acc.leverage if acc else None,
                    'features': {'bulkQuotes': True, 'bulkCandles': True, 'perSymbolOverrides': True},
                })

            # /quote?symbol=X
            if path == '/quote':
                symbol = q.get('symbol', [''])[0].upper()
                if not symbol: return json_response(self, {'error': 'symbol required'}, 400)
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'connected': False, 'error': str(err)}, 503)
                tick = mt5.symbol_info_tick(symbol)
                if not tick:
                    mt5.symbol_select(symbol, True)
                    tick = mt5.symbol_info_tick(symbol)
                if not tick: return json_response(self, {'error': f'{symbol} not available'}, 404)
                return json_response(self, {'symbol': symbol, 'bid': tick.bid, 'ask': tick.ask, 'last': tick.last or tick.bid, 'timestamp': utc_now_iso()})

            # /candles?symbol=X&timeframe=1d&limit=100
            if path == '/candles':
                symbol = q.get('symbol', [''])[0].upper()
                tf = q.get('timeframe', ['1h'])[0]
                limit = min(int(q.get('limit', ['100'])[0]), 1000)
                if not symbol: return json_response(self, {'error': 'symbol required'}, 400)
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'connected': False, 'error': str(err)}, 503)
                mt5.symbol_select(symbol, True)
                rates = mt5.copy_rates_from_pos(symbol, timeframe_to_mt5(tf), 0, limit)
                if rates is None or len(rates) == 0:
                    return json_response(self, {'symbol': symbol, 'timeframe': tf, 'bars': []})
                bars = [{'timestamp': utc_iso(r['time']), 'open': float(r['open']),
                         'high': float(r['high']), 'low': float(r['low']), 'close': float(r['close']),
                         'volume': int(r['tick_volume'])} for r in rates]
                return json_response(self, {'symbol': symbol, 'timeframe': tf, 'bars': bars})

            # /quotes?symbols=A,B,C   (bulk — scales to hundreds by URL or use POST)
            if path == '/quotes':
                return handle_bulk_quotes(self, q)

            # /candles/batch?symbols=A,B&timeframe=1h&limit=100   (bulk)
            if path == '/candles/batch':
                return handle_bulk_candles(self, q)

            # /symbols
            if path == '/symbols':
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'connected': False, 'error': str(err)}, 503)
                syms = mt5.symbols_get()
                # ⚠️ These are the PER-SYMBOL BROKER CONSTRAINTS, and the /order pre-flight
                # below tests exactly two of them: `tradeMode != FULL` and
                # `volume < volume_min`. They MUST travel with the name, because a name
                # alone only proves the symbol is LISTED — which is not the same fact as
                # the broker ACCEPTING A TRADE for it.
                #
                # Measured 2026-09-15 (#US500): US500 reports `tradeMode 0` (disabled) on
                # :5000 and `tradeMode 4` on :5001, and `volumeMin 0.1` on BOTH while the
                # manual-trade default size is 0.01. The app therefore offered a trade
                # that the bridge refused at click time, twice over.
                #
                # ⚠️ Keep this list in step with the /order pre-flight. A constraint
                # tested there but missing here is a constraint the app cannot see.
                result = [{'name': s.name, 'path': s.path, 'tradeMode': s.trade_mode,
                           'volumeMin': float(s.volume_min), 'volumeMax': float(s.volume_max),
                           'digits': s.digits} for s in (syms or [])]
                return json_response(self, {'symbols': result, 'count': len(result)})

            # /account
            if path == '/account':
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'connected': False, 'error': str(err)}, 503)
                info = mt5.account_info()
                if not info: return json_response(self, {'error': 'No account info'}, 500)
                return json_response(self, {'login': info.login, 'server': info.server, 'balance': float(info.balance),
                    'equity': float(info.equity), 'margin': float(info.margin), 'marginFree': float(info.margin_free),
                    'marginLevel': float(info.margin_level) if info.margin_level else None, 'currency': info.currency,
                    'leverage': info.leverage, 'name': info.name})

            # /positions
            if path == '/positions':
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'connected': False, 'error': str(err)}, 503)
                positions = mt5.positions_get()
                result = []
                if positions:
                    for p in positions:
                        info = mt5.symbol_info(p.symbol)
                        result.append({'ticket': p.ticket, 'symbol': p.symbol, 'type': 'buy' if p.type==0 else 'sell',
                            'volume': float(p.volume), 'priceOpen': float(p.price_open), 'priceCurrent': float(p.price_current),
                            'sl': float(p.sl) if p.sl else None, 'tp': float(p.tp) if p.tp else None,
                            'profit': float(p.profit), 'swap': float(p.swap),
                            'contractSize': float(info.trade_contract_size) if info else None,
                            'currencyBase': info.currency_base if info else None,
                            'currencyProfit': info.currency_profit if info else None,
                            'openTime': utc_iso(p.time), 'magic': p.magic, 'comment': p.comment})
                return json_response(self, {'positions': result, 'count': len(result)})

            # /history?days=7
            if path == '/history':
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'connected': False, 'error': str(err)}, 503)
                days = int(q.get('days', ['7'])[0])
                from_date = datetime.now() - timedelta(days=days)
                to_date = datetime.now() + timedelta(days=1)
                orders = mt5.history_orders_get(from_date, to_date)
                deals = mt5.history_deals_get(from_date, to_date)
                history, deal_list = [], []
                if orders:
                    for o in orders:
                        history.append({'ticket': o.ticket, 'symbol': o.symbol, 'type': 'buy' if o.type in (0,2,4) else 'sell',
                            'volume': float(o.volume_initial), 'price': float(o.price_open),
                            'time': utc_iso(o.time_setup), 'comment': o.comment})
                if deals:
                    for d in deals:
                        deal_list.append({'ticket': d.ticket, 'symbol': d.symbol, 'type': 'buy' if d.type==0 else 'sell',
                            'volume': float(d.volume), 'price': float(d.price), 'profit': float(d.profit),
                            'positionId': d.position_id, 'orderId': d.order,
                            'commission': float(d.commission), 'swap': float(d.swap), 'fee': float(d.fee),
                            'time': utc_iso(d.time), 'comment': d.comment,
                            # ⚠️ `reason` is the broker's OWN statement of WHY the deal happened, and it is
                            # the only authoritative answer to "what closed this position?" (2026-09-18).
                            #
                            # ⚠️ THIS is the route that matters: `Mt5Adapter.getDeals()` calls `/history`,
                            # NOT `/history/deals`. Both now carry the field, but attributing an exit from
                            # the wrong route is how a fix looks done and changes nothing.
                            #
                            # Without it the app cannot distinguish a stop-loss fill from a stop-out, a
                            # manual close, or our own time-stop. Measured consequence: 15 of 16 bot trades
                            # closed at 3-18% of their configured SL/TP distance, three inside five seconds,
                            # and every closing deal's `comment` was EMPTY — so an hour of elimination
                            # produced suspects and no cause.
                            #
                            # Values are the mt5.DEAL_REASON_* constants:
                            #   0 client | 1 mobile | 2 web | 3 expert | 4 SL | 5 TP | 6 stop-out
                            #   7 rollover | 8 vmargins | 9 split
                            # Mapped to `trade.closeReason` by nest/src/common/trading/close-reason.ts.
                            'reason': int(d.reason) if d.reason is not None else None})
                return json_response(self, {'orders': history, 'deals': deal_list, 'orderCount': len(history), 'dealCount': len(deal_list)})

            # /symbol/X/info
            if len(parts) == 3 and parts[0] == 'symbol' and parts[2] == 'info':
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'connected': False, 'error': str(err)}, 503)
                sym = parts[1].upper()
                info = mt5.symbol_info(sym)
                if not info:
                    mt5.symbol_select(sym, True)
                    info = mt5.symbol_info(sym)
                if not info: return json_response(self, {'error': f'{sym} not available'}, 404)
                return json_response(self, {'name': info.name, 'description': info.description,
                    'digits': info.digits, 'contractSize': info.trade_contract_size,
                    'volumeMin': info.volume_min, 'volumeMax': info.volume_max, 'spread': info.spread,
                    'swapLong': info.swap_long, 'swapShort': info.swap_short, 'swapMode': info.swap_mode,
                    # ⚠️ WHY the profit currency is here (#865, 2026-09-18): the per-symbol
                    # allocation cap needs `volume × contractSize × price` converted into the
                    # ACCOUNT currency. Without `currencyProfit` the conversion cannot be built for
                    # any symbol whose name does not state its quote currency — index CFDs such as
                    # US500 / GER40 / UK100 carry no currency in their name, so the estimator must
                    # return "unavailable" and refuse rather than assume one.
                    # `info` already holds both, so this is a payload change, not new work.
                    'currencyProfit': info.currency_profit, 'currencyBase': info.currency_base})

            # /accounts
            if path == '/accounts':
                return json_response(self, {'accounts': list_accounts(), 'active': os.environ.get('MT5_ACTIVE_ACCOUNT','1'), 'connected': mt5.terminal_info() is not None})

            # /terminal/info
            if path == '/terminal/info':
                t = mt5.terminal_info()
                return json_response(self, {'connected': t is not None, 'build': t.build if t else None, 'path': t.path if t else None,
                    'tradeAllowed': t.trade_allowed if t else None, 'connectedAt': last_connection_attempt.isoformat() if last_connection_attempt else None})

            # /calendar
            if path == '/calendar':
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'connected': False, 'error': str(err)}, 503)
                from_date = datetime.now()
                to_date = from_date + timedelta(days=7)
                events = mt5.calendar_get(from_date, to_date)
                result = []
                if events:
                    for e in events[:50]:
                        result.append({'id': e.id, 'name': e.name, 'country': e.country, 'currency': e.currency,
                            'importance': e.importance, 'time': utc_iso(e.time) if e.time else None})
                return json_response(self, {'events': result, 'count': len(result)})

            # /positions/sync — force-refresh from broker
            if path == '/positions/sync':
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'connected': False, 'error': str(err)}, 503)
                positions = mt5.positions_get()
                result = []
                if positions:
                    for p in positions:
                        info = mt5.symbol_info(p.symbol)
                        result.append({'ticket': p.ticket, 'symbol': p.symbol, 'type': 'buy' if p.type==0 else 'sell',
                            'volume': float(p.volume), 'priceOpen': float(p.price_open), 'priceCurrent': float(p.price_current),
                            'sl': float(p.sl) if p.sl else None, 'tp': float(p.tp) if p.tp else None,
                            'profit': float(p.profit), 'swap': float(p.swap),
                            'contractSize': float(info.trade_contract_size) if info else None,
                            'currencyBase': info.currency_base if info else None,
                            'currencyProfit': info.currency_profit if info else None,
                            'openTime': utc_iso(p.time), 'magic': p.magic, 'comment': p.comment})
                journal_trade('positions_sync', {'count': len(result)})
                return json_response(self, {'positions': result, 'count': len(result), 'syncedAt': utc_now_iso()})

            # /order/<ticket> — order/position status
            if len(parts) == 2 and parts[0] == 'order':
                ticket = int(parts[1])
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'connected': False, 'error': str(err)}, 503)
                # Check open positions first
                positions = mt5.positions_get(ticket=ticket)
                if positions:
                    p = positions[0]
                    return json_response(self, {'ticket': p.ticket, 'symbol': p.symbol,
                        'type': 'buy' if p.type==0 else 'sell', 'volume': float(p.volume),
                        'priceOpen': float(p.price_open), 'priceCurrent': float(p.price_current),
                        'sl': float(p.sl) if p.sl else None, 'tp': float(p.tp) if p.tp else None,
                        'profit': float(p.profit), 'swap': float(p.swap),
                        'openTime': utc_iso(p.time),
                        'status': 'open', 'comment': p.comment})
                # Check pending orders
                orders = mt5.orders_get(ticket=ticket)
                if orders:
                    o = orders[0]
                    return json_response(self, {'ticket': o.ticket, 'symbol': o.symbol,
                        'type': 'buy' if o.type in (0,2,4) else 'sell', 'volume': float(o.volume_initial),
                        'priceOpen': float(o.price_open), 'priceCurrent': float(o.price_current),
                        'sl': float(o.sl) if o.sl else None, 'tp': float(o.tp) if o.tp else None,
                        'openTime': utc_iso(o.time_setup),
                        'status': 'pending', 'comment': o.comment})
                # Check history
                from_date = datetime.now() - timedelta(days=7)
                to_date = datetime.now() + timedelta(days=1)
                history = mt5.history_orders_get(ticket=ticket, date_from=from_date, date_to=to_date)
                if history:
                    h = history[0]
                    return json_response(self, {'ticket': h.ticket, 'symbol': h.symbol,
                        'type': 'buy' if h.type in (0,2,4) else 'sell', 'volume': float(h.volume_initial),
                        'priceOpen': float(h.price_open), 'priceCurrent': float(h.price_current),
                        'openTime': utc_iso(h.time_setup),
                        'status': h.state == 3 and 'filled' or h.state == 4 and 'cancelled' or 'closed',
                        'comment': h.comment})
                return json_response(self, {'error': f'Order {ticket} not found'}, 404)

            # /history/deals?days=30
            if path == '/history/deals':
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'connected': False, 'error': str(err)}, 503)
                days = int(q.get('days', ['30'])[0])
                sym = q.get('symbol', [''])[0].upper()
                from_date = datetime.now() - timedelta(days=days)
                to_date = datetime.now() + timedelta(days=1)
                deals = mt5.history_deals_get(from_date, to_date)
                result = []
                if deals:
                    for d in deals:
                        if sym and d.symbol.upper() != sym: continue
                        result.append({'ticket': d.ticket, 'symbol': d.symbol, 'type': 'buy' if d.type==0 else 'sell',
                            'volume': float(d.volume), 'price': float(d.price), 'profit': float(d.profit),
                            'positionId': d.position_id, 'orderId': d.order,
                            'commission': float(d.commission), 'swap': float(d.swap), 'fee': float(d.fee),
                            'time': utc_iso(d.time), 'comment': d.comment,
                            # ⚠️ `reason` is the broker's OWN statement of WHY the deal happened, and it is
                            # the only authoritative answer to "what closed this position?" (2026-09-18).
                            #
                            # Without it the app could not distinguish a stop-loss fill from a stop-out,
                            # a manual close, or our own time-stop. Measured consequence: 15 of 16 bot
                            # trades closed at 3-18% of their configured SL/TP distance, three inside five
                            # seconds, and every closing deal's `comment` was EMPTY - so an hour of
                            # elimination produced suspects and no cause.
                            #
                            # Values are the mt5.DEAL_REASON_* constants:
                            #   0 client | 1 mobile | 2 web | 3 expert | 4 SL | 5 TP | 6 stop-out
                            #   7 rollover | 8 vmargins | 9 split
                            # Mapped to `trade.closeReason` by nest/src/common/trading/close-reason.ts.
                            'reason': int(d.reason) if d.reason is not None else None})
                return json_response(self, {'deals': result, 'count': len(result)})

            return json_response(self, {'error': 'not found'}, 404)
        except Exception as e:
            logger.error(f'Error handling {path}: {e}')
            return json_response(self, {'error': str(e)}, 500)

    def do_POST(self):
        p = urlparse(self.path)
        q = parse_qs(p.query)
        path = p.path.rstrip('/')
        parts = [x for x in path.split('/') if x]
        body = read_body(self)

        try:
            # /quotes   (bulk quotes — POST body {symbols:[...]}; preferred at scale)
            if path == '/quotes':
                return handle_bulk_quotes(self, q, body)

            # /candles/batch   (bulk candles — POST body {symbols, timeframe, limit, perSymbol})
            if path == '/candles/batch':
                return handle_bulk_candles(self, q, body)

            # /order
            if path == '/order':
                ok, err = ensure_mt5()
                if not ok: return json_response(self, unavailable_response(err), 503)
                symbol = body.get('symbol', '').upper()
                order_type = body.get('type', 'buy').lower()
                volume = float(body.get('volume', 0.01))
                sl = body.get('sl'); tp = body.get('tp')
                comment = body.get('comment', 'TCS Trade')
                client_order_id = body.get('clientOrderId', '').strip()
                if not symbol: return json_response(self, {'error': 'Symbol required'}, 400)

                # ── Idempotency check ──
                if client_order_id:
                    dup, existing = is_duplicate_order(client_order_id)
                    if dup:
                        logger.info(f'Duplicate order blocked: {client_order_id} → existing ticket {existing["ticket"]}')
                        return json_response(self, {'success': True, 'ticket': existing['ticket'],
                            'symbol': existing['symbol'], 'volume': existing['volume'],
                            'filledVolume': existing['volume'], 'status': existing['status'],
                            'duplicate': True, 'clientOrderId': client_order_id,
                            'code': NOTICE_DUPLICATE, 'params': {'ticket': existing['ticket']},
                            'message': f'Duplicate order — existing ticket {existing["ticket"]}'})

                # ── Risk Limits ──
                # Max position size
                if volume > MAX_POSITION_SIZE:
                    return json_response(self, refusal(NOTICE_SIZE_CAP,
                        f'Volume {volume} exceeds max position size {MAX_POSITION_SIZE}',
                        {'volume': volume, 'maximum': MAX_POSITION_SIZE}), 400)
                # Max open positions
                existing_positions = mt5.positions_get()
                current_count = len(existing_positions) if existing_positions else 0
                if current_count >= MAX_OPEN_POSITIONS:
                    return json_response(self, refusal(NOTICE_POSITION_CAP,
                        f'Max open positions ({MAX_OPEN_POSITIONS}) reached — {current_count} currently open',
                        {'open': current_count, 'maximum': MAX_OPEN_POSITIONS}), 400)
                # Daily loss check
                if MAX_DAILY_LOSS > 0:
                    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
                    deals_today = mt5.history_deals_get(today_start, datetime.now() + timedelta(days=1))
                    daily_pnl = sum(float(d.profit) for d in deals_today) if deals_today else 0
                    if daily_pnl < -MAX_DAILY_LOSS:
                        return json_response(self, {'error': f'Daily loss limit exceeded: {daily_pnl:.2f} vs -{MAX_DAILY_LOSS:.2f}'}, 400)

                mt5_type = {'buy': mt5.ORDER_TYPE_BUY, 'market_buy': mt5.ORDER_TYPE_BUY,
                           'sell': mt5.ORDER_TYPE_SELL, 'market_sell': mt5.ORDER_TYPE_SELL,
                           'buy_limit': mt5.ORDER_TYPE_BUY_LIMIT, 'sell_limit': mt5.ORDER_TYPE_SELL_LIMIT,
                           'buy_stop': mt5.ORDER_TYPE_BUY_STOP, 'sell_stop': mt5.ORDER_TYPE_SELL_STOP}.get(order_type)
                if mt5_type is None: return json_response(self, {'error': f'Unknown type: {order_type}'}, 400)

                mt5.symbol_select(symbol, True)
                tick = mt5.symbol_info_tick(symbol)
                if not tick: return json_response(self, refusal(NOTICE_NO_QUOTE,
                    f'No quote for {symbol}', {'symbol': symbol}), 400)

                # ── Pre-flight symbol validation ──
                sym_info = mt5.symbol_info(symbol)
                if sym_info:
                    # Check trade mode — reject if market closed
                    if sym_info.trade_mode != mt5.SYMBOL_TRADE_MODE_FULL:
                        return json_response(self, refusal(NOTICE_NOT_TRADEABLE,
                            f'{symbol} not tradeable (trade mode: {sym_info.trade_mode})',
                            {'symbol': symbol, 'tradeMode': sym_info.trade_mode}), 400)
                    # Check volume limits
                    if volume < sym_info.volume_min:
                        return json_response(self, refusal(NOTICE_VOLUME_MIN,
                            f'Volume {volume} below {symbol} minimum ({sym_info.volume_min})',
                            {'symbol': symbol, 'volume': volume, 'minimum': sym_info.volume_min}), 400)
                    if sym_info.volume_max > 0 and volume > sym_info.volume_max:
                        return json_response(self, refusal(NOTICE_VOLUME_MAX,
                            f'Volume {volume} exceeds {symbol} maximum ({sym_info.volume_max})',
                            {'symbol': symbol, 'volume': volume, 'maximum': sym_info.volume_max}), 400)
                    # Check spread is reasonable (< 5% of price)
                    spread_pct = (tick.ask - tick.bid) / tick.bid * 100 if tick.bid > 0 else 0
                    if spread_pct > 5:
                        return json_response(self, refusal(NOTICE_SPREAD,
                            f'Spread too wide for {symbol}: {spread_pct:.2f}%',
                            {'symbol': symbol, 'spread': round(spread_pct, 2)}), 400)
                else:
                    logger.warning(f'symbol_info({symbol}) returned None — skipping tradeability checks')

                # Check margin — margin_initial is per 1.0 lot, so scale by volume.
                account = mt5.account_info()
                if account and account.margin_free is not None:
                    required_margin = (sym_info.margin_initial * volume) if sym_info else (volume * 1000)
                    if account.margin_free < required_margin:
                        return json_response(self, refusal(NOTICE_MARGIN,
                            f'Insufficient margin: need {required_margin:.2f}, have {account.margin_free:.2f}',
                            {'symbol': symbol, 'required': round(required_margin, 2),
                             'free': round(account.margin_free, 2)}), 400)
                # ── End pre-flight validation ──

                price = body.get('price') or (tick.ask if mt5_type in (mt5.ORDER_TYPE_BUY, mt5.ORDER_TYPE_BUY_LIMIT, mt5.ORDER_TYPE_BUY_STOP) else tick.bid)
                is_market = order_type in ('buy','sell','market_buy','market_sell')

                req = {'action': mt5.TRADE_ACTION_DEAL if is_market else mt5.TRADE_ACTION_PENDING,
                       'symbol': symbol, 'volume': volume, 'type': mt5_type, 'price': price,
                       'deviation': 20, 'magic': 234000, 'comment': comment,
                       'type_time': mt5.ORDER_TIME_GTC}
                if sl: req['sl'] = float(sl)
                if tp: req['tp'] = float(tp)

                # #824 — a market order with no filling mode is refused by brokers
                # that will not FOK the instrument (Pepperstone). Pending orders
                # do not use filling mode, so only market orders get it.
                if is_market:
                    filling_name, filling_mask = apply_filling(req, symbol)
                else:
                    filling_name, filling_mask = 'n/a (pending)', 0

                result = mt5.order_send(req)
                successful_retcodes = (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_DONE_PARTIAL)
                if not result or result.retcode not in successful_retcodes:
                    error = order_rejected(result, symbol, filling_name, filling_mask)
                    code = rejection_code(result)
                    external = mt5_external(result)
                    journal_trade('order_failed', {'symbol': symbol, 'type': order_type, 'volume': volume,
                        'error': error, 'code': code, 'retcode': getattr(result, 'retcode', None),
                        'externalCode': (external or {}).get('code'), 'externalName': (external or {}).get('name'),
                        'fillingMode': filling_name, 'clientOrderId': client_order_id or None})
                    return json_response(self, refusal(code, error,
                        rejection_params(symbol, filling_name, filling_mask), external), 400)

                # Store idempotency key
                fill_status = 'partially_filled' if result.retcode == mt5.TRADE_RETCODE_DONE_PARTIAL else 'filled'
                filled_volume = float(result.volume or volume)
                if client_order_id:
                    recent_orders[client_order_id] = {
                        'ticket': result.order, 'symbol': symbol,
                        'volume': filled_volume, 'time': time.time(), 'status': fill_status}

                journal_trade('order_placed', {'ticket': result.order, 'symbol': symbol, 'type': order_type, 'volume': volume, 'price': price, 'clientOrderId': client_order_id or None})
                return json_response(self, {'success': True, 'ticket': result.order, 'volume': volume,
                    'filledVolume': filled_volume, 'partial': fill_status == 'partially_filled',
                    'status': fill_status, 'retcode': result.retcode, 'symbol': symbol,
                    'price': float(result.price or price), 'type': order_type,
                    'clientOrderId': client_order_id or None})

            # /close/<ticket>
            if len(parts) == 2 and parts[0] == 'close':
                ticket = int(parts[1])
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'success': False, 'error': str(err)}, 503)
                positions = mt5.positions_get(ticket=ticket)
                if not positions: return json_response(self, refusal(NOTICE_POSITION_MISSING,
                    f'Position {ticket} not found', {'ticket': ticket}), 404)
                pos = positions[0]; is_buy = pos.type == 0
                tick = mt5.symbol_info_tick(pos.symbol)
                if not tick: return json_response(self, refusal(NOTICE_NO_QUOTE,
                    f'No quote for {pos.symbol}', {'symbol': pos.symbol}), 400)
                close_price = tick.bid if is_buy else tick.ask
                # ⚠️ `origin` NAMES THE CLOSER (2026-09-20, #916). Attribution used to be impossible:
                # the comment was the fixed string 'Close by TCS', so a bridge close could not be
                # told from a desktop-terminal close once only the deal record survived.
                # Measured: 33 of 41 closed trades had EMPTY comments with deal reason 0 (client) —
                # small winners closed in batches seconds apart, with no API call to account for it.
                # The closing deal's comment is the durable answer, so it must carry the actor.
                close_origin = (q.get('origin', ['manual'])[0] or 'manual').strip()[:24]
                req = {'action': mt5.TRADE_ACTION_DEAL, 'symbol': pos.symbol, 'volume': float(pos.volume),
                       'type': mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY, 'position': ticket,
                       'price': close_price, 'deviation': 20, 'magic': 234000, 'comment': f'TCS:{close_origin}',
                       'type_time': mt5.ORDER_TIME_GTC}
                # #824 — closing is a market deal, so it carries a filling mode too.
                filling_name, filling_mask = apply_filling(req, pos.symbol)
                result = mt5.order_send(req)
                if not result or result.retcode not in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_DONE_PARTIAL):
                    error = order_rejected(result, pos.symbol, filling_name, filling_mask)
                    journal_trade('order_failed', {'symbol': pos.symbol, 'action': 'close', 'ticket': ticket,
                        'error': error, 'code': rejection_code(result),
                        'retcode': getattr(result, 'retcode', None)})
                    return json_response(self, refusal(rejection_code(result), error,
                        rejection_params(pos.symbol, filling_name, filling_mask), mt5_external(result)), 400)

                # ── Report the REALISED outcome, not pre-close floating values ──
                #
                # ⚠️ DO NOT return `pos.profit` / `tick.bid|ask` here. Both are
                # read BEFORE order_send, so they describe the position as it was
                # about to be closed, not the close itself:
                #   - `pos.profit` is FLOATING profit (excludes the exit deal).
                #   - `tick.bid|ask` is a pre-fill quote, not the fill price.
                #
                # Real damage (discovered 2026-09-10): a bulk close of 26 EURUSD
                # positions recorded exitPrice=1.16257 and pnl=-9.02 on EVERY row,
                # with a byte-identical closedAt. Buys and sells alike took the
                # same negative value, because the fallback was shared. That made
                # the whole book's P&L unreadable and looked like strategy losses.
                #
                # The authoritative source is the closed deal itself. Match the
                # entry deal(s) for this position and sum profit/commission/swap
                # for the realised figure; use the exit deal's own price.
                realized_profit = None
                realized_price = None
                try:
                    deals = mt5.history_deals_get(position=ticket)
                    if deals:
                        entries = [d for d in deals if d.entry == 0]   # DEAL_ENTRY_IN
                        exits = [d for d in deals if d.entry == 1]     # DEAL_ENTRY_OUT
                        if exits:
                            realized_price = float(exits[-1].price)
                        realized_profit = float(sum(d.profit + d.commission + d.swap for d in deals))
                except Exception:
                    # History may lag a just-filled close by a moment; fall back
                    # to the send result rather than to pre-close floating values.
                    pass

                # result.price is the actual fill price from the trade server —
                # far better than the pre-fill quote we used to return.
                fill_price = None
                try:
                    if getattr(result, 'price', None):
                        fill_price = float(result.price)
                except Exception:
                    pass

                return json_response(self, {
                    'success': True, 'ticket': ticket, 'symbol': pos.symbol,
                    'closePrice': realized_price if realized_price is not None else (fill_price or close_price),
                    'price': realized_price if realized_price is not None else (fill_price or close_price),
                    'profit': realized_profit,
                    'realized': realized_profit is not None,
                    'retcode': result.retcode,
                    'partial': result.retcode == mt5.TRADE_RETCODE_DONE_PARTIAL,
                })

            # /order/modify
            if path == '/order/modify':
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'success': False, 'error': str(err)}, 503)
                ticket = body.get('ticket')
                if not ticket: return json_response(self, {'error': 'ticket required'}, 400)
                positions = mt5.positions_get(ticket=int(ticket))
                if not positions: return json_response(self, {'error': f'Position {ticket} not found'}, 404)
                pos = positions[0]
                req = {'action': mt5.TRADE_ACTION_SLTP, 'position': int(ticket), 'symbol': pos.symbol,
                       'sl': float(body.get('sl', 0)) or float(pos.sl or 0),
                       'tp': float(body.get('tp', 0)) or float(pos.tp or 0)}
                result = mt5.order_send(req)
                if not result or result.retcode not in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_DONE_PARTIAL):
                    error = mt5.last_error() if not result else result.comment
                    return json_response(self, {'success': False, 'error': str(error)}, 400)
                return json_response(self, {'success': True, 'ticket': ticket, 'sl': req['sl'],
                    'tp': req['tp'], 'retcode': result.retcode})

            # /close/partial/<ticket>
            if len(parts) == 3 and parts[0] == 'close' and parts[1] == 'partial':
                ticket = int(parts[2])
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'success': False, 'error': str(err)}, 503)
                positions = mt5.positions_get(ticket=ticket)
                if not positions: return json_response(self, {'error': f'Position {ticket} not found'}, 404)
                pos = positions[0]; is_buy = pos.type == 0
                vol = float(body.get('volume', 0.01))
                if vol >= float(pos.volume): return json_response(self, {'error': 'Volume exceeds position'}, 400)
                tick = mt5.symbol_info_tick(pos.symbol)
                if not tick: return json_response(self, {'error': f'No quote'}, 400)
                cp = tick.bid if is_buy else tick.ask
                req = {'action': mt5.TRADE_ACTION_DEAL, 'symbol': pos.symbol, 'volume': vol,
                       'type': mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY, 'position': ticket,
                       'price': cp, 'deviation': 20, 'magic': 234000, 'comment': 'Partial close',
                       'type_time': mt5.ORDER_TIME_GTC}
                # #824 — partial close is a market deal as well.
                filling_name, filling_mask = apply_filling(req, pos.symbol)
                result = mt5.order_send(req)
                if not result or result.retcode not in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_DONE_PARTIAL):
                    error = order_rejected(result, pos.symbol, filling_name, filling_mask)
                    return json_response(self, refusal(rejection_code(result), error,
                        rejection_params(pos.symbol, filling_name, filling_mask), mt5_external(result)), 400)
                return json_response(self, {'success': True, 'ticket': ticket, 'closed': vol,
                    'remaining': float(pos.volume)-vol, 'closePrice': cp, 'price': cp,
                    'retcode': result.retcode, 'partial': result.retcode == mt5.TRADE_RETCODE_DONE_PARTIAL})

            # /orders/bulk — place/modify/close multiple orders
            if path == '/orders/bulk':
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'success': False, 'error': str(err)}, 503)
                operations = body.get('operations', [])
                if not operations or not isinstance(operations, list):
                    return json_response(self, {'error': 'operations array required'}, 400)
                results = []
                for i, op in enumerate(operations):
                    action = op.get('action', 'place')
                    try:
                        if action == 'place':
                            sym = op.get('symbol', '').upper()
                            otype = op.get('type', 'buy').lower()
                            vol = float(op.get('volume', 0.01))
                            mt5.symbol_select(sym, True)
                            tick = mt5.symbol_info_tick(sym)
                            if not tick:
                                results.append({'index': i, 'success': False, 'error': f'No quote for {sym}'})
                                continue
                            mt5_type = {'buy': mt5.ORDER_TYPE_BUY, 'sell': mt5.ORDER_TYPE_SELL}.get(otype)
                            if not mt5_type:
                                results.append({'index': i, 'success': False, 'error': f'Unknown type: {otype}'})
                                continue
                            price = tick.ask if mt5_type == mt5.ORDER_TYPE_BUY else tick.bid
                            req = {'action': mt5.TRADE_ACTION_DEAL, 'symbol': sym, 'volume': vol,
                                   'type': mt5_type, 'price': price, 'deviation': 20, 'magic': 234000,
                                   'comment': op.get('comment', 'TCS Bulk'), 'type_time': mt5.ORDER_TIME_GTC}
                            if op.get('sl'): req['sl'] = float(op['sl'])
                            if op.get('tp'): req['tp'] = float(op['tp'])
                            # #824 — bulk market order needs a filling mode too.
                            filling_name, filling_mask = apply_filling(req, sym)
                            res = mt5.order_send(req)
                            ok_res = res and res.retcode == mt5.TRADE_RETCODE_DONE
                            results.append({'index': i, 'success': ok_res,
                                'ticket': res.order if ok_res else None, 'symbol': sym, 'action': 'place',
                                'code': None if ok_res else rejection_code(res),
                                'error': None if ok_res else order_rejected(res, sym, filling_name, filling_mask)})
                        elif action == 'close':
                            ticket = int(op.get('ticket', 0))
                            positions = mt5.positions_get(ticket=ticket)
                            if not positions:
                                results.append({'index': i, 'success': False, 'error': f'Position {ticket} not found'})
                                continue
                            pos = positions[0]; is_buy = pos.type == 0
                            tick = mt5.symbol_info_tick(pos.symbol)
                            if not tick:
                                results.append({'index': i, 'success': False, 'error': f'No quote'})
                                continue
                            cp = tick.bid if is_buy else tick.ask
                            req = {'action': mt5.TRADE_ACTION_DEAL, 'symbol': pos.symbol,
                                   'volume': float(pos.volume), 'position': ticket,
                                   'type': mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
                                   'price': cp, 'deviation': 20, 'magic': 234000,
                                   'comment': 'TCS Bulk Close', 'type_time': mt5.ORDER_TIME_GTC}
                            # #824 — bulk close is a market deal.
                            filling_name, filling_mask = apply_filling(req, pos.symbol)
                            res = mt5.order_send(req)
                            ok_res = res and res.retcode == mt5.TRADE_RETCODE_DONE
                            results.append({'index': i, 'success': ok_res,
                                'ticket': ticket, 'symbol': pos.symbol, 'action': 'close',
                                'code': None if ok_res else rejection_code(res),
                                'error': None if ok_res else order_rejected(res, pos.symbol, filling_name, filling_mask)})
                        elif action == 'modify':
                            ticket = int(op.get('ticket', 0))
                            positions = mt5.positions_get(ticket=ticket)
                            if not positions:
                                results.append({'index': i, 'success': False, 'error': f'Position {ticket} not found'})
                                continue
                            pos = positions[0]
                            req = {'action': mt5.TRADE_ACTION_SLTP, 'position': ticket,
                                   'symbol': pos.symbol,
                                   'sl': float(op.get('sl', 0)) or float(pos.sl or 0),
                                   'tp': float(op.get('tp', 0)) or float(pos.tp or 0)}
                            res = mt5.order_send(req)
                            ok_res = res and res.retcode == mt5.TRADE_RETCODE_DONE
                            results.append({'index': i, 'success': ok_res,
                                'ticket': ticket, 'symbol': pos.symbol, 'action': 'modify',
                                'error': None if ok_res else (res.comment if res else str(mt5.last_error()))})
                        else:
                            results.append({'index': i, 'success': False, 'error': f'Unknown action: {action}'})
                    except Exception as e:
                        results.append({'index': i, 'success': False, 'error': str(e)})
                journal_trade('bulk_operations', {'total': len(operations), 'succeeded': len([r for r in results if r['success']])})
                return json_response(self, {'results': results, 'total': len(operations),
                    'succeeded': len([r for r in results if r['success']]),
                    'failed': len([r for r in results if not r['success']])})

            # /refresh
            if path == '/refresh':
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'connected': False, 'error': str(err)}, 503)
                syms = q.get('symbols', ['EURUSD,GBPUSD,USDJPY'])[0].split(',')
                results = []
                for s in syms:
                    s = s.strip().upper()
                    sel = mt5.symbol_select(s, True)
                    tick = mt5.symbol_info_tick(s) if sel else None
                    results.append({'symbol': s, 'selected': sel, 'hasQuote': tick is not None})
                return json_response(self, {'refreshed': len([r for r in results if r.get('selected')]), 'total': len(results), 'results': results})

            # /reconnect — ⚠️ #992: this now calls the SAME function the watchdog calls.
            # Two copies of a reconnect would drift, and only one would get the next fix.
            if path == '/reconnect':
                ok, err = reconnect_mt5('explicit POST /reconnect')
                state, detail = probe_connection_state()
                if ok:
                    info = mt5.account_info()
                    return json_response(self, {'success': True, 'state': state, 'account': str(info.login) if info else None, 'balance': float(info.balance) if info else None})
                return json_response(self, {'success': False, 'state': state, 'stateDetail': detail, 'error': str(err)}, 500)

            # /switch/<num>
            if len(parts) == 2 and parts[0] == 'switch':
                num = parts[1]
                mt5.shutdown()
                acct = os.environ.get(f'MT5_ACCOUNT_{num}','')
                pw = os.environ.get(f'MT5_PASSWORD_{num}','')
                srv = os.environ.get(f'MT5_SERVER_{num}','')
                mpath = os.environ.get(f'MT5_PATH_{num}','') or None
                if not acct or not pw: return json_response(self, {'success': False, 'error': f'Account #{num} not configured'}, 400)
                ok = False
                if mpath:
                    ok = mt5.initialize(path=mpath, timeout=MT5_INIT_TIMEOUT_MS)
                    if not ok:
                        ok = mt5.initialize(login=int(acct), password=pw, server=srv, path=mpath, timeout=MT5_INIT_TIMEOUT_MS)
                else:
                    ok = mt5.initialize(login=int(acct), password=pw, server=srv, timeout=MT5_INIT_TIMEOUT_MS)
                if ok:
                    os.environ['MT5_ACTIVE_ACCOUNT'] = num
                    info = mt5.account_info()
                    return json_response(self, {'success': True, 'account': str(info.login) if info else acct, 'balance': float(info.balance) if info else None})
                return json_response(self, {'success': False, 'error': str(mt5.last_error())}, 500)

            # /accounts/add
            if path == '/accounts/add':
                login = str(body.get('login','')).strip()
                password = body.get('password','')
                server = body.get('server','')
                if not login or not password: return json_response(self, {'error': 'login and password required'}, 400)
                # Validate login is numeric
                try:
                    int(login)
                except (ValueError, TypeError):
                    return json_response(self, {'error': f'Invalid login "{login}" — must be a numeric MT5 account ID'}, 400)
                for i in range(1, 100):
                    if not os.environ.get(f'MT5_ACCOUNT_{i}'):
                        os.environ[f'MT5_ACCOUNT_{i}'] = login
                        os.environ[f'MT5_PASSWORD_{i}'] = password
                        os.environ[f'MT5_SERVER_{i}'] = server
                        save_env_file()
                        logger.info(f'Added account #{i} ({login}) — persisted to .env')
                        break
                return json_response(self, {'success': True, 'login': login, 'server': server})

            # /accounts/remove
            if path == '/accounts/remove':
                number = int(body.get('number', 0))
                if not number or number < 1:
                    return json_response(self, {'error': 'Account number required'}, 400)
                login = os.environ.pop(f'MT5_ACCOUNT_{number}', None)
                os.environ.pop(f'MT5_PASSWORD_{number}', None)
                os.environ.pop(f'MT5_SERVER_{number}', None)
                if login:
                    save_env_file()
                    logger.info(f'Removed account #{number} ({login}) — persisted to .env')
                    return json_response(self, {'success': True, 'removed': login, 'number': number})
                return json_response(self, {'error': f'Account #{number} not found'}, 404)

            # /accounts/test
            if path == '/accounts/test':
                login = body.get('login',''); password = body.get('password',''); server = body.get('server','')
                if not login or not password: return json_response(self, {'error': 'login and password required'}, 400)
                try: login_int = int(login)
                except (ValueError, TypeError): return json_response(self, {'error': f'Invalid login: {login}'}, 400)
                mpath = body.get('path','') or None
                mt5.shutdown()
                kwargs = dict(login=login_int, password=str(password), server=str(server))
                if mpath:
                    kwargs['path'] = mpath
                kwargs.setdefault('timeout', MT5_INIT_TIMEOUT_MS)  # #1000 — never hold the interpreter open
                ok = mt5.initialize(**kwargs)
                if ok:
                    info = mt5.account_info()
                    mt5.shutdown()
                    connect_mt5()  # reconnect original
                    return json_response(self, {'success': True, 'login': str(info.login) if info else login, 'balance': float(info.balance) if info else None})
                error = mt5.last_error()
                connect_mt5()
                return json_response(self, {'success': False, 'error': str(error)}, 400)

            return json_response(self, {'error': 'not found'}, 404)
        except Exception as e:
            logger.error(f'Error handling POST {path}: {e}')
            return json_response(self, {'error': str(e)}, 500)

    def log_message(self, format, *args):
        """Suppress default access logging (we use our own logger)."""
        pass

# ─── Main ─────────────────────────────────────────────────

if __name__ == '__main__':
    # Identity (port + account slot + log file) was resolved at import time —
    # supports `--port` / `--broker-id` CLI flags and BRIDGE_PORT / BRIDGE_ACCOUNT env.
    port = BRIDGE_PORT
    account, _, server, active, _ = get_active_credentials()
    logger.info(f'Bridge instance [{BROKER_TAG}] slot #{active}: {account} @ {server} on port {port}')
    logger.info(f'Starting MT5 Bridge v2 on port {port} (http.server, no Flask)...')
    # ⚠️ #992 — THE WATCHDOG STARTS BEFORE THE STARTUP CONNECT. IT IS NECESSARY, AND IT IS
    # ⚠️⚠️ NOT SUFFICIENT — AND SAYING SO IS THE POINT OF THIS COMMENT.
    #
    # WHY IT MOVED. It used to be started AFTER `connect_mt5()`. A live canary on 2026-09-25
    # (a throwaway bridge on :5002 pointed at a bogus server) showed the startup line, then
    # NOTHING — no watchdog, no port, no diagnosis. The same shape as the original defect.
    #
    # ⚠️ WHAT THE CANARY THEN PROVED, WHICH CONTRADICTS THE OBVIOUS CONCLUSION. With the start
    # moved up, the log now reads: watchdog started, then `Connecting to MT5 at startup...`,
    # then `Initializing MT5:` — AND STOPS. It never advances, even with
    # MT5_WATCHDOG_POLL_SECONDS=5 and 100+ seconds elapsed. `mt5.initialize()` against an
    # unreachable server BLOCKS THE INTERPRETER, so the daemon thread never gets to run.
    #
    # So: an async watchdog CANNOT cover a startup hang. Reordering buys two real things — the
    # watchdog's start is now visible in the log before the connect, and a connect that FAILS
    # FAST (rather than blocking) is caught immediately — but a bridge that HANGS at initialize
    # is still undiagnosable from inside this process. Fixing that needs the connect bounded
    # and run OUT OF PROCESS, which is a larger change and is recorded, not hand-waved.
    #
    # It cannot thrash: when the watchdog does run and finds `terminal_info() is None`, that is
    # `terminal-down`, and it deliberately does NOT reconnect in that state.
    threading.Thread(target=connection_watchdog, name='mt5-watchdog', daemon=True).start()
    logger.info(
        f'Connection watchdog started — poll {int(WATCHDOG_POLL_SECONDS)}s, reconnect after '
        f'{WATCHDOG_FAILURES_BEFORE_RECONNECT} consecutive bad polls, '
        f'max backoff {int(WATCHDOG_MAX_BACKOFF_SECONDS)}s'
    )
    # Connect MT5 once at startup (after BRIDGE_ACCOUNT override takes effect)
    #
    # ── SERVE BEFORE CONNECTING (#1000) ───────────────────────────────────────────────────────
    # The HTTP server used to be created AFTER this call. That is why a bridge whose terminal is
    # unreachable is UNDIAGNOSABLE: `mt5.initialize()` blocks the interpreter, the server is never
    # constructed, and the port never opens — so nothing can ask the bridge what is wrong. The
    # `:5002` canary showed exactly that (log stops at `Initializing MT5`, no port).
    #
    # The server is therefore bound and serving FIRST, on its own daemon thread. `/health` then
    # answers while the connect is in flight or hung, which is the difference between "the bridge
    # is wedged" and "something is listening and can tell you its state".
    #
    # ⚠️ This is necessary and may still not be sufficient: whether the serving thread actually gets
    # CPU during `mt5.initialize()` depends on the native call releasing the GIL, which is not
    # documented and is measured by the canary, not assumed here. If the canary shows the port
    # answering, this covers criterion 1 and 3 of #1000; if it shows the port NOT answering, the
    # conclusion is that the connect must also be bounded and run out of process, and that is
    # recorded rather than hand-waved.
    server_obj = HTTPServer(('127.0.0.1', port), BridgeHandler)
    logger.info(f'MT5 Bridge v2 listening on http://127.0.0.1:{port} (binding BEFORE connect, #1000)')
    threading.Thread(target=server_obj.serve_forever, name='mt5-http', daemon=True).start()

    logger.info('Connecting to MT5 at startup...')
    ok, err = connect_mt5()
    if not ok:
        logger.warning(f'MT5 not connected at startup: {err}')
    # ⚠️ Print the EFFECTIVE limits (#773). They come from the environment at import, so
    # this line is the only place a stale `.env` read is visible from the log. If it does
    # not match `nest/.env`, this process predates the edit — restart it.
    logger.info(
        f'Risk limits in force — maxOpenPositions={MAX_OPEN_POSITIONS}, '
        f'maxPositionSize={MAX_POSITION_SIZE}, maxDailyLoss={MAX_DAILY_LOSS}'
    )
    try:
        # The HTTP server owns its own thread now, so park the main thread here. Parking (rather
        # than exiting) keeps a KeyboardInterrupt deliverable and the shutdown orderly — a
        # process whose main thread fell off the end would kill its daemon server mid-request.
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        logger.info('Bridge shutting down...')
        server_obj.shutdown()
        mt5.shutdown()
