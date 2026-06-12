"""
MT5 Bridge — HTTP bridge between NestJS and MetaTrader 5.
Runs as a Flask server on localhost:5000.
Connects to MT5 terminal via the MetaTrader5 Python package.

Usage:
    pip install -r requirements-mt5.txt
    python mt5_bridge.py

Environment variables (optional — uses defaults if not set):
    MT5_ACCOUNT, MT5_PASSWORD, MT5_SERVER, BRIDGE_PORT
"""

import os
import sys
import json
import logging
from logging.handlers import RotatingFileHandler
from datetime import datetime, timedelta

import flask
from flask import Flask, jsonify, request

# Configure logging
log_dir = os.path.dirname(os.path.abspath(__file__))
log_file = os.path.join(log_dir, 'bridge.log')
handler = RotatingFileHandler(log_file, maxBytes=5_242_880, backupCount=5)  # 5MB per file
handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))

logger = logging.getLogger('mt5_bridge')
logger.setLevel(logging.DEBUG)
logger.addHandler(handler)
logger.addHandler(logging.StreamHandler())

app = Flask(__name__)

# MT5 connection state
mt5_available = False
mt5_initialized = False
last_connection_attempt = None
connection_errors = 0

# Try to import MetaTrader5
try:
    import MetaTrader5 as mt5
    mt5_available = True
    logger.info('MetaTrader5 package loaded successfully')
except ImportError:
    mt5_available = False
    logger.warning('MetaTrader5 package not installed. Run: pip install MetaTrader5')


def initialize_mt5():
    """Initialize connection to MT5 terminal."""
    global mt5_initialized, last_connection_attempt, connection_errors

    if not mt5_available:
        return False

    if mt5_initialized:
        # Check if still connected
        if mt5.terminal_info() is not None:
            return True
        logger.info('MT5 connection lost — reconnecting...')
        mt5_initialized = False

    last_connection_attempt = datetime.now()

    account = os.environ.get('MT5_ACCOUNT', '')
    password = os.environ.get('MT5_PASSWORD', '')
    server = os.environ.get('MT5_SERVER', 'ICMarkets-Demo')

    if not account or not password:
        logger.warning('MT5_ACCOUNT and MT5_PASSWORD not set in environment')
        return False

    try:
        login = int(account)
    except ValueError:
        logger.error(f'Invalid MT5_ACCOUNT: {account} — must be an integer')
        return False

    logger.info(f'Connecting to MT5: server={server}, account={account}')
    initialized = mt5.initialize(login=login, password=password, server=server)

    if initialized:
        mt5_initialized = True
        connection_errors = 0
        account_info = mt5.account_info()
        if account_info:
            logger.info(f'MT5 connected: balance={account_info.balance}, server={account_info.server}')
        else:
            logger.info('MT5 connected (no account info available)')
        return True
    else:
        error = mt5.last_error()
        connection_errors += 1
        logger.error(f'MT5 initialization failed: {error}')
        return False


def ensure_mt5():
    """Ensure MT5 is connected, return error response if not."""
    if not mt5_available:
        return jsonify({'error': 'MetaTrader5 package not installed'}), 503
    if not initialize_mt5():
        return jsonify({
            'connected': False,
            'error': 'MT5 terminal not running or credentials invalid',
            'connectionErrors': connection_errors,
        }), 503
    return None


def timeframe_to_mt5(tf):
    """Convert string timeframe to MT5 constant."""
    mapping = {
        '1m': mt5.TIMEFRAME_M1,
        '5m': mt5.TIMEFRAME_M5,
        '15m': mt5.TIMEFRAME_M15,
        '30m': mt5.TIMEFRAME_M30,
        '1h': mt5.TIMEFRAME_H1,
        '4h': mt5.TIMEFRAME_H4,
        '1d': mt5.TIMEFRAME_D1,
        '1w': mt5.TIMEFRAME_W1,
        '1mn': mt5.TIMEFRAME_MN1,
    }
    return mapping.get(tf.lower(), mt5.TIMEFRAME_H1)


# ─── Endpoints ─────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    """Check MT5 connection status."""
    if not mt5_available:
        return jsonify({
            'connected': False,
            'mt5Package': False,
            'reason': 'MetaTrader5 package not installed',
        })

    connected = initialize_mt5()
    account_info = mt5.account_info() if connected else None

    return jsonify({
        'connected': connected,
        'mt5Package': True,
        'account': str(account_info.login) if account_info else None,
        'server': account_info.server if account_info else None,
        'balance': float(account_info.balance) if account_info else None,
        'equity': float(account_info.equity) if account_info else None,
        'connectionErrors': connection_errors,
    })


@app.route('/quote', methods=['GET'])
def get_quote():
    """Get latest bid/ask for a symbol."""
    symbol = request.args.get('symbol', '').upper()
    if not symbol:
        return jsonify({'error': 'symbol parameter required'}), 400

    err = ensure_mt5()
    if err:
        return err

    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        logger.warning(f'Symbol {symbol} not found in MT5')
        return jsonify({'error': f'Symbol {symbol} not found'}), 404

    logger.info(f'Quote for {symbol}: bid={tick.bid}, ask={tick.ask}')
    return jsonify({
        'symbol': symbol,
        'bid': tick.bid,
        'ask': tick.ask,
        'last': tick.last or tick.bid,
        'timestamp': datetime.now().isoformat(),
    })


@app.route('/candles', methods=['GET'])
def get_candles():
    """Get OHLCV candles for a symbol."""
    symbol = request.args.get('symbol', '').upper()
    tf = request.args.get('timeframe', '1h')
    limit = int(request.args.get('limit', 100))

    if not symbol:
        return jsonify({'error': 'symbol parameter required'}), 400

    err = ensure_mt5()
    if err:
        return err

    mt5_tf = timeframe_to_mt5(tf)
    rates = mt5.copy_rates_from_pos(symbol, mt5_tf, 0, min(limit, 1000))

    if rates is None or len(rates) == 0:
        logger.warning(f'No candles for {symbol} ({tf})')
        return jsonify({'symbol': symbol, 'timeframe': tf, 'bars': []})

    logger.info(f'Fetched {len(rates)} candles for {symbol} ({tf})')

    bars = []
    for r in rates:
        bars.append({
            'timestamp': datetime.fromtimestamp(r['time']).isoformat(),
            'open': float(r['open']),
            'high': float(r['high']),
            'low': float(r['low']),
            'close': float(r['close']),
            'volume': int(r['tick_volume']),
        })

    return jsonify({'symbol': symbol, 'timeframe': tf, 'bars': bars})


@app.route('/symbols', methods=['GET'])
def list_symbols():
    """List all available symbols from MT5."""
    err = ensure_mt5()
    if err:
        return err

    symbols = mt5.symbols_get()
    if symbols is None:
        return jsonify({'symbols': []})

    result = []
    for s in symbols:
        result.append({
            'name': s.name,
            'path': s.path,
            'tradeMode': s.trade_mode,
        })

    return jsonify({'symbols': result, 'count': len(result)})


@app.route('/account', methods=['GET'])
def account_info():
    """Get MT5 account information."""
    err = ensure_mt5()
    if err:
        return err

    info = mt5.account_info()
    if info is None:
        return jsonify({'error': 'No account info available'}), 500

    return jsonify({
        'login': info.login,
        'server': info.server,
        'balance': float(info.balance),
        'equity': float(info.equity),
        'margin': float(info.margin),
        'marginFree': float(info.margin_free),
        'marginLevel': float(info.margin_level) if info.margin_level else None,
        'currency': info.currency,
        'leverage': info.leverage,
        'name': info.name,
    })


if __name__ == '__main__':
    port = int(os.environ.get('BRIDGE_PORT', 5000))
    logger.info(f'Starting MT5 Bridge on port {port}...')
    logger.info(f'MT5 package available: {mt5_available}')

    # Attempt initial connection
    if mt5_available:
        initialize_mt5()

    app.run(host='127.0.0.1', port=port, debug=False)
