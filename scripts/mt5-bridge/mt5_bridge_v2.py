"""
MT5 Bridge v2 — HTTP bridge between NestJS and MetaTrader 5.
Uses Python's built-in http.server (single-threaded, no Flask).
Connects to MT5 terminal ONCE at startup — all requests use the same connection.

Usage:
    pip install -r requirements-mt5.txt
    python mt5_bridge_v2.py
"""

import os, json, logging, time
from logging.handlers import RotatingFileHandler
from datetime import datetime, timedelta
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

log_dir = os.path.dirname(os.path.abspath(__file__))
log_file = os.path.join(log_dir, 'bridge.log')
handler = RotatingFileHandler(log_file, maxBytes=5_242_880, backupCount=5)
handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
logger = logging.getLogger('mt5_bridge_v2')
logger.setLevel(logging.DEBUG)
logger.addHandler(handler)
logger.addHandler(logging.StreamHandler())

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

def connect_mt5():
    """Initialize MT5 connection — called at startup and on /reconnect."""
    global connection_errors
    if check_circuit_breaker():
        return False, 'Circuit breaker open — too many connection failures, cooling down'
    account, password, server, active, path = get_active_credentials()
    path_str = f', path={path}' if path else ''
    logger.info(f'Initializing MT5: server={server}, account={account} (account #{active}){path_str}')
    kwargs = dict(login=int(account), password=password, server=server)
    if path:
        kwargs['path'] = path
    initialized = mt5.initialize(**kwargs)
    if initialized:
        connection_errors = 0
        reset_circuit_breaker()
        info = mt5.account_info()
        logger.info(f'MT5 connected: {info.login} @ {info.server}, balance={info.balance}')
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

# Connect MT5 once at startup
logger.info('Connecting to MT5 at startup...')
ok, err = connect_mt5()
if not ok:
    logger.warning(f'MT5 not connected at startup: {err}')

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
                return json_response(self, {
                    'connected': connected, 'mt5Package': True,
                    'activeAccount': active_num,
                    'account': str(acc.login) if acc else None,
                    'server': acc.server if acc else None,
                    'balance': float(acc.balance) if acc else None,
                    'equity': float(acc.equity) if acc else None,
                    'connectionErrors': connection_errors,
                    'circuitBreaker': {'state': circuit_state, 'failures': circuit_failures, 'threshold': CIRCUIT_BREAKER_THRESHOLD, 'cooldown': CIRCUIT_BREAKER_COOLDOWN},
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
                return json_response(self, {'symbol': symbol, 'bid': tick.bid, 'ask': tick.ask, 'last': tick.last or tick.bid, 'timestamp': datetime.now().isoformat()})

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
                bars = [{'timestamp': datetime.fromtimestamp(r['time']).isoformat(), 'open': float(r['open']),
                         'high': float(r['high']), 'low': float(r['low']), 'close': float(r['close']),
                         'volume': int(r['tick_volume'])} for r in rates]
                return json_response(self, {'symbol': symbol, 'timeframe': tf, 'bars': bars})

            # /symbols
            if path == '/symbols':
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'connected': False, 'error': str(err)}, 503)
                syms = mt5.symbols_get()
                result = [{'name': s.name, 'path': s.path, 'tradeMode': s.trade_mode} for s in (syms or [])]
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
                        result.append({'ticket': p.ticket, 'symbol': p.symbol, 'type': 'buy' if p.type==0 else 'sell',
                            'volume': float(p.volume), 'priceOpen': float(p.price_open), 'priceCurrent': float(p.price_current),
                            'sl': float(p.sl) if p.sl else None, 'tp': float(p.tp) if p.tp else None,
                            'profit': float(p.profit), 'swap': float(p.swap),
                            'openTime': datetime.fromtimestamp(p.time).isoformat(), 'magic': p.magic, 'comment': p.comment})
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
                            'volume': float(o.volume), 'price': float(o.price_open),
                            'time': datetime.fromtimestamp(o.time_setup).isoformat(), 'comment': o.comment})
                if deals:
                    for d in deals:
                        deal_list.append({'ticket': d.ticket, 'symbol': d.symbol, 'type': 'buy' if d.type==0 else 'sell',
                            'volume': float(d.volume), 'price': float(d.price), 'profit': float(d.profit),
                            'time': datetime.fromtimestamp(d.time).isoformat(), 'comment': d.comment})
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
                    'swapLong': info.swap_long, 'swapShort': info.swap_short, 'swapMode': info.swap_mode})

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
                            'importance': e.importance, 'time': datetime.fromtimestamp(e.time).isoformat() if e.time else None})
                return json_response(self, {'events': result, 'count': len(result)})

            # /positions/sync — force-refresh from broker
            if path == '/positions/sync':
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'connected': False, 'error': str(err)}, 503)
                positions = mt5.positions_get()
                result = []
                if positions:
                    for p in positions:
                        result.append({'ticket': p.ticket, 'symbol': p.symbol, 'type': 'buy' if p.type==0 else 'sell',
                            'volume': float(p.volume), 'priceOpen': float(p.price_open), 'priceCurrent': float(p.price_current),
                            'sl': float(p.sl) if p.sl else None, 'tp': float(p.tp) if p.tp else None,
                            'profit': float(p.profit), 'swap': float(p.swap),
                            'openTime': datetime.fromtimestamp(p.time).isoformat(), 'magic': p.magic, 'comment': p.comment})
                journal_trade('positions_sync', {'count': len(result)})
                return json_response(self, {'positions': result, 'count': len(result), 'syncedAt': datetime.now().isoformat()})

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
                        'openTime': datetime.fromtimestamp(p.time).isoformat(),
                        'status': 'open', 'comment': p.comment})
                # Check pending orders
                orders = mt5.orders_get(ticket=ticket)
                if orders:
                    o = orders[0]
                    return json_response(self, {'ticket': o.ticket, 'symbol': o.symbol,
                        'type': 'buy' if o.type in (0,2,4) else 'sell', 'volume': float(o.volume),
                        'priceOpen': float(o.price_open), 'priceCurrent': float(o.price_current),
                        'sl': float(o.sl) if o.sl else None, 'tp': float(o.tp) if o.tp else None,
                        'openTime': datetime.fromtimestamp(o.time_setup).isoformat(),
                        'status': 'pending', 'comment': o.comment})
                # Check history
                from_date = datetime.now() - timedelta(days=7)
                to_date = datetime.now() + timedelta(days=1)
                history = mt5.history_orders_get(ticket=ticket, date_from=from_date, date_to=to_date)
                if history:
                    h = history[0]
                    return json_response(self, {'ticket': h.ticket, 'symbol': h.symbol,
                        'type': 'buy' if h.type in (0,2,4) else 'sell', 'volume': float(h.volume),
                        'priceOpen': float(h.price_open), 'priceCurrent': float(h.price_current),
                        'openTime': datetime.fromtimestamp(h.time_setup).isoformat(),
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
                            'time': datetime.fromtimestamp(d.time).isoformat(), 'comment': d.comment})
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
            # /order
            if path == '/order':
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'success': False, 'error': str(err)}, 503)
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
                            'duplicate': True, 'clientOrderId': client_order_id,
                            'message': f'Duplicate order — existing ticket {existing["ticket"]}'})

                # ── Risk Limits ──
                # Max position size
                if volume > MAX_POSITION_SIZE:
                    return json_response(self, {'error': f'Volume {volume} exceeds max position size {MAX_POSITION_SIZE}'}, 400)
                # Max open positions
                existing_positions = mt5.positions_get()
                current_count = len(existing_positions) if existing_positions else 0
                if current_count >= MAX_OPEN_POSITIONS:
                    return json_response(self, {'error': f'Max open positions ({MAX_OPEN_POSITIONS}) reached — {current_count} currently open'}, 400)
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

                tick = mt5.symbol_info_tick(symbol)
                if not tick: return json_response(self, {'error': f'No quote for {symbol}'}, 400)

                # ── Pre-flight symbol validation ──
                sym_info = mt5.symbol_info(symbol)
                if sym_info:
                    # Check trade mode — reject if market closed
                    if sym_info.trade_mode != mt5.SYMBOL_TRADE_MODE_FULL:
                        return json_response(self, {'error': f'{symbol} not tradeable (trade mode: {sym_info.trade_mode})'}, 400)
                    # Check volume limits
                    if volume < sym_info.volume_min:
                        return json_response(self, {'error': f'Volume {volume} below {symbol} minimum ({sym_info.volume_min})'}, 400)
                    if sym_info.volume_max > 0 and volume > sym_info.volume_max:
                        return json_response(self, {'error': f'Volume {volume} exceeds {symbol} maximum ({sym_info.volume_max})'}, 400)
                    # Check spread is reasonable (< 5% of price)
                    spread_pct = (tick.ask - tick.bid) / tick.bid * 100 if tick.bid > 0 else 0
                    if spread_pct > 5:
                        return json_response(self, {'error': f'Spread too wide for {symbol}: {spread_pct:.2f}%'}, 400)
                else:
                    logger.warning(f'symbol_info({symbol}) returned None — skipping tradeability checks')

                # Check margin
                account = mt5.account_info()
                if account and account.margin_free is not None:
                    required_margin = sym_info.margin_initial if sym_info else (volume * 1000)
                    if account.margin_free < required_margin:
                        return json_response(self, {'error': f'Insufficient margin: need {required_margin:.2f}, have {account.margin_free:.2f}'}, 400)
                # ── End pre-flight validation ──

                price = body.get('price') or (tick.ask if mt5_type in (mt5.ORDER_TYPE_BUY, mt5.ORDER_TYPE_BUY_LIMIT, mt5.ORDER_TYPE_BUY_STOP) else tick.bid)
                is_market = order_type in ('buy','sell','market_buy','market_sell')

                req = {'action': mt5.TRADE_ACTION_DEAL if is_market else mt5.TRADE_ACTION_PENDING,
                       'symbol': symbol, 'volume': volume, 'type': mt5_type, 'price': price,
                       'deviation': 20, 'magic': 234000, 'comment': comment,
                       'type_time': mt5.ORDER_TIME_GTC}
                if sl: req['sl'] = float(sl)
                if tp: req['tp'] = float(tp)

                result = mt5.order_send(req)
                if not result or result.retcode != mt5.TRADE_RETCODE_DONE:
                    error = mt5.last_error() if not result else result.comment
                    journal_trade('order_failed', {'symbol': symbol, 'type': order_type, 'volume': volume, 'error': str(error), 'clientOrderId': client_order_id or None})
                    return json_response(self, {'success': False, 'error': str(error)}, 400)

                # Store idempotency key
                if client_order_id:
                    recent_orders[client_order_id] = {
                        'ticket': result.order, 'symbol': symbol,
                        'volume': volume, 'time': time.time(), 'status': 'filled'}

                journal_trade('order_placed', {'ticket': result.order, 'symbol': symbol, 'type': order_type, 'volume': volume, 'price': price, 'clientOrderId': client_order_id or None})
                return json_response(self, {'success': True, 'ticket': result.order, 'volume': volume, 'symbol': symbol, 'price': price, 'type': order_type, 'clientOrderId': client_order_id or None})

            # /close/<ticket>
            if len(parts) == 2 and parts[0] == 'close':
                ticket = int(parts[1])
                ok, err = ensure_mt5()
                if not ok: return json_response(self, {'success': False, 'error': str(err)}, 503)
                positions = mt5.positions_get(ticket=ticket)
                if not positions: return json_response(self, {'error': f'Position {ticket} not found'}, 404)
                pos = positions[0]; is_buy = pos.type == 0
                tick = mt5.symbol_info_tick(pos.symbol)
                if not tick: return json_response(self, {'error': f'No quote for {pos.symbol}'}, 400)
                close_price = tick.bid if is_buy else tick.ask
                req = {'action': mt5.TRADE_ACTION_DEAL, 'symbol': pos.symbol, 'volume': float(pos.volume),
                       'type': mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY, 'position': ticket,
                       'price': close_price, 'deviation': 20, 'magic': 234000, 'comment': 'Close by TCS',
                       'type_time': mt5.ORDER_TIME_GTC}
                result = mt5.order_send(req)
                if not result or result.retcode != mt5.TRADE_RETCODE_DONE:
                    error = mt5.last_error() if not result else result.comment
                    return json_response(self, {'success': False, 'error': str(error)}, 400)
                return json_response(self, {'success': True, 'ticket': ticket, 'symbol': pos.symbol, 'closePrice': close_price, 'profit': float(pos.profit)})

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
                if not result or result.retcode != mt5.TRADE_RETCODE_DONE:
                    error = mt5.last_error() if not result else result.comment
                    return json_response(self, {'success': False, 'error': str(error)}, 400)
                return json_response(self, {'success': True, 'ticket': ticket, 'sl': req['sl'], 'tp': req['tp']})

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
                result = mt5.order_send(req)
                if not result or result.retcode != mt5.TRADE_RETCODE_DONE:
                    error = mt5.last_error() if not result else result.comment
                    return json_response(self, {'success': False, 'error': str(error)}, 400)
                return json_response(self, {'success': True, 'ticket': ticket, 'closed': vol, 'remaining': float(pos.volume)-vol, 'closePrice': cp})

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
                            res = mt5.order_send(req)
                            ok_res = res and res.retcode == mt5.TRADE_RETCODE_DONE
                            results.append({'index': i, 'success': ok_res,
                                'ticket': res.order if ok_res else None, 'symbol': sym, 'action': 'place',
                                'error': None if ok_res else (res.comment if res else str(mt5.last_error()))})
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
                            res = mt5.order_send(req)
                            ok_res = res and res.retcode == mt5.TRADE_RETCODE_DONE
                            results.append({'index': i, 'success': ok_res,
                                'ticket': ticket, 'symbol': pos.symbol, 'action': 'close',
                                'error': None if ok_res else (res.comment if res else str(mt5.last_error()))})
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

            # /reconnect
            if path == '/reconnect':
                mt5.shutdown()
                time.sleep(1)
                ok, err = connect_mt5()
                if ok:
                    info = mt5.account_info()
                    return json_response(self, {'success': True, 'account': str(info.login) if info else None, 'balance': float(info.balance) if info else None})
                return json_response(self, {'success': False, 'error': str(err)}, 500)

            # /switch/<num>
            if len(parts) == 2 and parts[0] == 'switch':
                num = parts[1]
                mt5.shutdown()
                acct = os.environ.get(f'MT5_ACCOUNT_{num}','')
                pw = os.environ.get(f'MT5_PASSWORD_{num}','')
                srv = os.environ.get(f'MT5_SERVER_{num}','')
                mpath = os.environ.get(f'MT5_PATH_{num}','') or None
                if not acct or not pw: return json_response(self, {'success': False, 'error': f'Account #{num} not configured'}, 400)
                kwargs = dict(login=int(acct), password=pw, server=srv)
                if mpath:
                    kwargs['path'] = mpath
                ok = mt5.initialize(**kwargs)
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
    port = int(os.environ.get('BRIDGE_PORT', 5000))
    logger.info(f'Starting MT5 Bridge v2 on port {port} (http.server, no Flask)...')
    server = HTTPServer(('127.0.0.1', port), BridgeHandler)
    logger.info(f'MT5 Bridge v2 listening on http://127.0.0.1:{port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info('Bridge shutting down...')
        server.shutdown()
        mt5.shutdown()
