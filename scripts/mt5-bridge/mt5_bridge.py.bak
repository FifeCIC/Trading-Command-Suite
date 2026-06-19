"""
MT5 Bridge — HTTP bridge between NestJS and MetaTrader 5.
Runs as a Flask server on localhost:5000.
Connects to MT5 terminal via the MetaTrader5 Python package.

Usage:
    pip install -r requirements-mt5.txt
    python mt5_bridge.py

Credentials are read from nest/.env (MT5_ACCOUNT, MT5_PASSWORD, MT5_SERVER).
"""

import os
import sys
import json
import logging
from logging.handlers import RotatingFileHandler
from datetime import datetime, timedelta

import flask
from flask import Flask, jsonify, request

# Try to load .env from the NestJS directory
try:
    import dotenv
    env_path = os.path.join(os.path.dirname(__file__), '..', '..', 'nest', '.env')
    if os.path.exists(env_path):
        dotenv.load_dotenv(env_path)
        print(f'Loaded credentials from {env_path}')
except ImportError:
    print('python-dotenv not installed — reading from system environment only')
    print('Install: pip install python-dotenv')

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


def get_active_credentials():
    """Get the active MT5 account credentials from environment."""
    active = os.environ.get('MT5_ACTIVE_ACCOUNT', '1')
    account = os.environ.get(f'MT5_ACCOUNT_{active}', os.environ.get('MT5_ACCOUNT', ''))
    password = os.environ.get(f'MT5_PASSWORD_{active}', os.environ.get('MT5_PASSWORD', ''))
    server = os.environ.get(f'MT5_SERVER_{active}', os.environ.get('MT5_SERVER', 'ICMarkets-Demo'))
    return account, password, server, active


def list_accounts():
    """List all configured MT5 accounts."""
    accounts = []
    for i in range(1, 10):
        acc = os.environ.get(f'MT5_ACCOUNT_{i}', '')
        if acc:
            active = os.environ.get('MT5_ACTIVE_ACCOUNT', '1')
            accounts.append({
                'number': i,
                'login': acc,
                'server': os.environ.get(f'MT5_SERVER_{i}', ''),
                'active': str(i) == str(active),
            })
    return accounts


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

    account, password, server, active_num = get_active_credentials()

    if not account or not password:
        logger.warning(f'MT5 account #{active_num} not configured — check MT5_ACCOUNT_{active_num} in .env')
        return False

    try:
        login = int(account) if account.isdigit() else account
    except ValueError:
        logger.error(f'Invalid MT5_ACCOUNT_{active_num}: {account}')
        return False

    logger.info(f'Connecting to MT5: server={server}, account={account} (account #{active_num})')
    initialized = mt5.initialize(
        path=r'C:\Program Files\MetaTrader 5\terminal64.exe',
        login=login, password=password, server=server,
    )

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
    active_account, _, _, active_num = get_active_credentials()

    return jsonify({
        'connected': connected,
        'mt5Package': True,
        'activeAccount': active_num,
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
        # Symbol might not be in Market Watch — try selecting it
        logger.info(f'Symbol {symbol} not visible — adding to Market Watch')
        if not mt5.symbol_select(symbol, True):
            logger.warning(f'Failed to select symbol {symbol}')
            return jsonify({'error': f'Symbol {symbol} not available', 'symbol': symbol}), 404
        # Retry after selection
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            return jsonify({'error': f'Symbol {symbol} not available after select', 'symbol': symbol}), 404

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
    # Ensure symbol is selected in Market Watch
    symbol_info = mt5.symbol_info(symbol)
    if symbol_info is None:
        logger.info(f'Symbol {symbol} not in Market Watch — selecting...')
        mt5.symbol_select(symbol, True)
    
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


@app.route('/refresh', methods=['POST'])
def refresh_data():
    """Force refresh — select symbols and download fresh data from broker."""
    global mt5_initialized
    
    err = ensure_mt5()
    if err:
        return err
    
    symbols_str = request.args.get('symbols', 'EURUSD,GBPUSD,USDJPY,AUDUSD,USDCAD,NZDUSD')
    symbols = [s.strip().upper() for s in symbols_str.split(',')]
    
    results = []
    for symbol in symbols:
        # Force select symbol in Market Watch
        selected = mt5.symbol_select(symbol, True)
        
        if selected:
            # Request fresh tick data — this forces MT5 to connect to broker
            tick = mt5.symbol_info_tick(symbol)
            # Also request latest bar to trigger data download
            rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M5, 0, 1)
            has_data = rates is not None and len(rates) > 0
            last_time = datetime.fromtimestamp(rates[0]['time']).isoformat() if has_data else None
            results.append({
                'symbol': symbol,
                'selected': True,
                'hasQuote': tick is not None,
                'hasCandles': has_data,
                'latestBar': last_time,
            })
            logger.info(f'Refresh {symbol}: selected=True, quote={tick is not None}, bars={has_data}')
        else:
            results.append({
                'symbol': symbol,
                'selected': False,
                'error': 'Symbol not available on this server',
            })
            logger.warning(f'Refresh {symbol}: not available')
    
    # Re-check connection after refresh
    terminal = mt5.terminal_info()
    
    return jsonify({
        'refreshed': len([r for r in results if r.get('selected')]),
        'total': len(results),
        'results': results,
        'terminalConnected': terminal is not None,
        'terminalPath': terminal.path if terminal else None,
        'communityConnected': terminal.community_connection if terminal else False,
        'timestamp': datetime.now().isoformat(),
    })


@app.route('/reconnect', methods=['POST'])
def reconnect():
    """Force MT5 to disconnect and reconnect — fixes stale data issues."""
    global mt5_initialized
    
    if mt5_initialized:
        mt5.shutdown()
        mt5_initialized = False
        logger.info('MT5 shutdown for reconnection')
    
    # Short delay
    import time
    time.sleep(1)
    
    account, password, server, active_num = get_active_credentials()
    
    if not account or not password:
        return jsonify({
            'success': False,
            'error': f'Account #{active_num} not configured',
        }), 400
    
    try:
        login = int(account) if account.isdigit() else account
    except ValueError:
        return jsonify({
            'success': False,
            'error': f'Invalid account: {account}',
        }), 400
    
    logger.info(f'Reconnecting to MT5: server={server}, account={account} (account #{active_num})')
    initialized = mt5.initialize(login=login, password=password, server=server)
    
    if initialized:
        mt5_initialized = True
        account_info = mt5.account_info()
        terminal = mt5.terminal_info()
        
        return jsonify({
            'success': True,
            'account': str(account_info.login) if account_info else None,
            'server': account_info.server if account_info else server,
            'balance': float(account_info.balance) if account_info else None,
            'terminalPath': terminal.path if terminal else None,
            'message': 'Reconnected successfully — data should now be fresh',
            'timestamp': datetime.now().isoformat(),
        })
    else:
        error = mt5.last_error()
        logger.error(f'Reconnection failed: {error}')
        return jsonify({
            'success': False,
            'error': str(error),
        }), 500


@app.route('/accounts', methods=['GET'])
def get_accounts():
    """List all configured MT5 accounts."""
    accounts = list_accounts()
    active = os.environ.get('MT5_ACTIVE_ACCOUNT', '1')
    return jsonify({
        'accounts': accounts,
        'active': active,
        'connected': mt5_initialized,
    })


@app.route('/switch/<account_num>', methods=['POST'])
def switch_account(account_num):
    """Switch to a different MT5 account."""
    global mt5_initialized

    if mt5_initialized:
        mt5.shutdown()
        mt5_initialized = False

    account = os.environ.get(f'MT5_ACCOUNT_{account_num}', '')
    password = os.environ.get(f'MT5_PASSWORD_{account_num}', '')
    server = os.environ.get(f'MT5_SERVER_{account_num}', '')

    if not account or not password:
        return jsonify({'success': False, 'error': f'Account #{account_num} not configured'}), 400

    try:
        login = int(account) if account.isdigit() else account
    except ValueError:
        return jsonify({'success': False, 'error': f'Invalid account: {account}'}), 400

    logger.info(f'Switching to account #{account_num}: {account} @ {server}')
    initialized = mt5.initialize(login=login, password=password, server=server)

    if initialized:
        mt5_initialized = True
        os.environ['MT5_ACTIVE_ACCOUNT'] = str(account_num)
        info = mt5.account_info()
        return jsonify({
            'success': True,
            'account': str(info.login) if info else account,
            'server': info.server if info else server,
            'balance': float(info.balance) if info else None,
            'activeAccount': int(account_num),
            'timestamp': datetime.now().isoformat(),
        })
    else:
        error = mt5.last_error()
        return jsonify({'success': False, 'error': str(error)}), 500


# ─── Trading Endpoints ─────────────────────────────────────

@app.route('/positions', methods=['GET'])
def get_positions():
    """List all open MT5 positions."""
    err = ensure_mt5()
    if err:
        return err

    try:
        positions = mt5.positions_get()
        if positions is None:
            return jsonify({'positions': [], 'count': 0})

        result = []
        for p in positions:
            result.append({
                'ticket': p.ticket,
                'symbol': p.symbol,
                'type': 'buy' if p.type == 0 else 'sell',
                'volume': float(p.volume),
                'priceOpen': float(p.price_open),
                'priceCurrent': float(p.price_current),
                'sl': float(p.sl) if p.sl else None,
                'tp': float(p.tp) if p.tp else None,
                'profit': float(p.profit),
                'swap': float(p.swap),
                'commission': float(p.commission) if hasattr(p, 'commission') else 0,
                'openTime': datetime.fromtimestamp(p.time).isoformat(),
                'magic': p.magic,
                'comment': p.comment,
            })
        return jsonify({'positions': result, 'count': len(result)})
    except Exception as e:
        logger.error(f'Failed to get positions: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/order', methods=['POST'])
def place_order():
    """Place a market, limit, or stop order via MT5."""
    err = ensure_mt5()
    if err:
        return err

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    symbol = data.get('symbol', '').strip().upper()
    order_type = data.get('type', 'buy').lower()
    volume = float(data.get('volume', 0.01))
    price = data.get('price')
    sl = data.get('sl')
    tp = data.get('tp')
    comment = data.get('comment', 'TCS Trade')

    if not symbol:
        return jsonify({'error': 'Symbol required'}), 400

    # Determine order type
    if order_type in ('buy', 'market_buy'):
        mt5_type = mt5.ORDER_TYPE_BUY
        price = None  # market order uses current price
    elif order_type in ('sell', 'market_sell'):
        mt5_type = mt5.ORDER_TYPE_SELL
        price = None
    elif order_type == 'buy_limit':
        mt5_type = mt5.ORDER_TYPE_BUY_LIMIT
    elif order_type == 'sell_limit':
        mt5_type = mt5.ORDER_TYPE_SELL_LIMIT
    elif order_type == 'buy_stop':
        mt5_type = mt5.ORDER_TYPE_BUY_STOP
    elif order_type == 'sell_stop':
        mt5_type = mt5.ORDER_TYPE_SELL_STOP
    else:
        return jsonify({'error': f'Unknown order type: {order_type}'}), 400

    # Get current price for market orders
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        return jsonify({'error': f'Cannot get quote for {symbol}'}), 400

    if price is None:
        price = tick.ask if mt5_type in (mt5.ORDER_TYPE_BUY, mt5.ORDER_TYPE_BUY_LIMIT, mt5.ORDER_TYPE_BUY_STOP) else tick.bid

    # Build the trade request
    request_data = {
        'action': mt5.TRADE_ACTION_DEAL if order_type in ('buy', 'sell', 'market_buy', 'market_sell') else mt5.TRADE_ACTION_PENDING,
        'symbol': symbol,
        'volume': volume,
        'type': mt5_type,
        'price': price,
        'deviation': 20,
        'magic': 234000,
        'comment': comment,
        'type_time': mt5.ORDER_TIME_GTC,
        'type_filling': mt5.ORDER_FILLING_IOC,
    }

    if sl is not None:
        request_data['sl'] = float(sl)
    if tp is not None:
        request_data['tp'] = float(tp)

    logger.info(f'Placing order: {order_type} {volume} {symbol} @ {price} (SL={sl}, TP={tp})')

    result = mt5.order_send(request_data)
    if result is None:
        error = mt5.last_error()
        logger.error(f'Order failed: {error}')
        return jsonify({'success': False, 'error': str(error)}), 500

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        logger.error(f'Order rejected: retcode={result.retcode}, comment={result.comment}')
        return jsonify({
            'success': False,
            'retcode': result.retcode,
            'comment': result.comment,
            'error': f'Order rejected (code {result.retcode})',
        }), 400

    logger.info(f'Order placed: ticket={result.order}, {volume} {symbol} @ {price}')
    return jsonify({
        'success': True,
        'ticket': result.order,
        'volume': volume,
        'symbol': symbol,
        'price': price,
        'type': order_type,
    })


@app.route('/close/<int:ticket>', methods=['POST'])
def close_position(ticket):
    """Close an open position by ticket number."""
    err = ensure_mt5()
    if err:
        return err

    # Find the position
    positions = mt5.positions_get(ticket=ticket)
    if positions is None or len(positions) == 0:
        return jsonify({'error': f'Position {ticket} not found'}), 404

    position = positions[0]
    symbol = position.symbol
    is_buy = position.type == 0  # 0=buy, 1=sell

    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        return jsonify({'error': f'Cannot get quote for {symbol}'}), 400

    close_price = tick.bid if is_buy else tick.ask

    close_request = {
        'action': mt5.TRADE_ACTION_DEAL,
        'symbol': symbol,
        'volume': float(position.volume),
        'type': mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
        'position': ticket,
        'price': close_price,
        'deviation': 20,
        'magic': 234000,
        'comment': 'Close by TCS',
        'type_time': mt5.ORDER_TIME_GTC,
        'type_filling': mt5.ORDER_FILLING_IOC,
    }

    logger.info(f'Closing position {ticket}: {symbol} at {close_price}')

    result = mt5.order_send(close_request)
    if result is None:
        error = mt5.last_error()
        logger.error(f'Close failed: {error}')
        return jsonify({'success': False, 'error': str(error)}), 500

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        logger.error(f'Close rejected: retcode={result.retcode}')
        return jsonify({
            'success': False,
            'retcode': result.retcode,
            'error': f'Close rejected (code {result.retcode})',
        }), 400

    logger.info(f'Position {ticket} closed successfully')
    return jsonify({
        'success': True,
        'ticket': ticket,
        'symbol': symbol,
        'closePrice': close_price,
        'profit': float(position.profit),
    })


@app.route('/history', methods=['GET'])
def get_history():
    """Get recent trade history (deals from last 7 days)."""
    err = ensure_mt5()
    if err:
        return err

    days = request.args.get('days', 7, type=int)
    from_date = datetime.now() - timedelta(days=days)
    to_date = datetime.now() + timedelta(days=1)

    try:
        # Get history orders
        orders = mt5.history_orders_get(from_date, to_date)
        deals = mt5.history_deals_get(from_date, to_date)

        history = []
        if orders is not None:
            for o in orders:
                history.append({
                    'ticket': o.ticket,
                    'symbol': o.symbol,
                    'type': 'buy' if o.type in (0, 2, 4) else 'sell',
                    'volume': float(o.volume),
                    'price': float(o.price_open),
                    'sl': float(o.sl) if o.sl else None,
                    'tp': float(o.tp) if o.tp else None,
                    'time': datetime.fromtimestamp(o.time_setup).isoformat(),
                    'timeDone': datetime.fromtimestamp(o.time_done).isoformat() if o.time_done else None,
                    'status': 'done' if o.time_done else 'pending',
                    'comment': o.comment,
                })

        deal_list = []
        if deals is not None:
            for d in deals:
                deal_list.append({
                    'ticket': d.ticket,
                    'symbol': d.symbol,
                    'type': 'buy' if d.type == 0 else 'sell',
                    'volume': float(d.volume),
                    'price': float(d.price),
                    'profit': float(d.profit),
                    'commission': float(d.commission),
                    'swap': float(d.swap),
                    'time': datetime.fromtimestamp(d.time).isoformat(),
                    'comment': d.comment,
                })

        return jsonify({
            'orders': history,
            'deals': deal_list,
            'orderCount': len(history),
            'dealCount': len(deal_list),
            'from': from_date.isoformat(),
            'to': to_date.isoformat(),
        })
    except Exception as e:
        logger.error(f'Failed to get history: {e}')
        return jsonify({'error': str(e)}), 500


# ─── Extended Trading Endpoints (Q237) ─────────────────────

@app.route('/order/modify', methods=['POST'])
def modify_order():
    """Modify SL/TP of an existing position."""
    err = ensure_mt5()
    if err:
        return err

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    ticket = data.get('ticket')
    sl = data.get('sl')
    tp = data.get('tp')

    if not ticket:
        return jsonify({'error': 'ticket required'}), 400

    positions = mt5.positions_get(ticket=int(ticket))
    if positions is None or len(positions) == 0:
        return jsonify({'error': f'Position {ticket} not found'}), 404

    position = positions[0]
    modify_request = {
        'action': mt5.TRADE_ACTION_SLTP,
        'position': int(ticket),
        'symbol': position.symbol,
        'sl': float(sl) if sl is not None else float(position.sl) if position.sl else 0,
        'tp': float(tp) if tp is not None else float(position.tp) if position.tp else 0,
    }

    result = mt5.order_send(modify_request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        error = mt5.last_error() if result is None else result.comment
        return jsonify({'success': False, 'error': str(error)}), 400

    return jsonify({
        'success': True,
        'ticket': ticket,
        'sl': modify_request['sl'],
        'tp': modify_request['tp'],
        'message': 'SL/TP updated',
    })


@app.route('/close/partial/<int:ticket>', methods=['POST'])
def close_partial(ticket):
    """Close a partial volume of an open position."""
    err = ensure_mt5()
    if err:
        return err

    data = request.get_json() or {}
    volume = float(data.get('volume', 0.01))

    positions = mt5.positions_get(ticket=ticket)
    if positions is None or len(positions) == 0:
        return jsonify({'error': f'Position {ticket} not found'}), 404

    position = positions[0]
    if volume >= float(position.volume):
        return jsonify({'error': f'Volume exceeds position size ({position.volume})'}), 400

    symbol = position.symbol
    is_buy = position.type == 0
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        return jsonify({'error': f'Cannot get quote for {symbol}'}), 400

    close_price = tick.bid if is_buy else tick.ask
    close_request = {
        'action': mt5.TRADE_ACTION_DEAL,
        'symbol': symbol,
        'volume': volume,
        'type': mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
        'position': ticket,
        'price': close_price,
        'deviation': 20,
        'magic': 234000,
        'comment': 'Partial close TCS',
        'type_time': mt5.ORDER_TIME_GTC,
        'type_filling': mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(close_request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        error = mt5.last_error() if result is None else result.comment
        return jsonify({'success': False, 'error': str(error)}), 400

    remaining = float(position.volume) - volume
    return jsonify({
        'success': True,
        'ticket': ticket,
        'closed': volume,
        'remaining': remaining,
        'closePrice': close_price,
    })


@app.route('/symbol/<name>/info', methods=['GET'])
def symbol_info(name):
    """Get detailed symbol information (contract size, margin, swaps)."""
    err = ensure_mt5()
    if err:
        return err

    symbol = name.strip().upper()
    info = mt5.symbol_info(symbol)
    if info is None:
        mt5.symbol_select(symbol, True)
        info = mt5.symbol_info(symbol)
    if info is None:
        return jsonify({'error': f'Symbol {symbol} not available'}), 404

    return jsonify({
        'name': info.name,
        'description': info.description,
        'path': info.path,
        'digits': info.digits,
        'tradeMode': info.trade_mode,
        'contractSize': info.trade_contract_size,
        'volumeMin': info.volume_min,
        'volumeMax': info.volume_max,
        'volumeStep': info.volume_step,
        'point': info.point,
        'spread': info.spread,
        'tickSize': info.trade_tick_size,
        'tickValue': info.trade_tick_value,
        'marginInitial': info.margin_initial,
        'marginMaintenance': info.margin_maintenance,
        'swapLong': info.swap_long,
        'swapShort': info.swap_short,
        'swapMode': info.swap_mode,
        'currencyBase': info.currency_base,
        'currencyProfit': info.currency_profit,
        'currencyMargin': info.currency_margin,
    })


@app.route('/terminal/info', methods=['GET'])
def terminal_info():
    """Get MT5 terminal build info and connection status."""
    if not mt5_available:
        return jsonify({'connected': False, 'error': 'MT5 package not installed'}), 503

    connected = mt5_initialized or initialize_mt5()
    terminal = mt5.terminal_info() if connected else None

    return jsonify({
        'connected': connected,
        'build': terminal.build if terminal else None,
        'name': terminal.name if terminal else None,
        'path': terminal.path if terminal else None,
        'communityConnected': terminal.community_connection if terminal else False,
        'dataPath': terminal.data_path if terminal else None,
        'commondir': terminal.commondir if terminal else None,
        'tradeAllowed': terminal.trade_allowed if terminal else None,
        'tradeAPI': terminal.tradeapi_disabled if terminal else None,
        'connectedAt': last_connection_attempt.isoformat() if last_connection_attempt else None,
    })


@app.route('/accounts/add', methods=['POST'])
def add_account():
    """Add a new MT5 account configuration (in-memory for session)."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    login = str(data.get('login', '')).strip()
    password = data.get('password', '')
    server = data.get('server', '')
    label = data.get('label', '')

    if not login or not password:
        return jsonify({'error': 'login and password required'}), 400

    # Find next available account number
    for i in range(1, 100):
        if not os.environ.get(f'MT5_ACCOUNT_{i}'):
            os.environ[f'MT5_ACCOUNT_{i}'] = login
            os.environ[f'MT5_PASSWORD_{i}'] = password
            os.environ[f'MT5_SERVER_{i}'] = server
            break

    return jsonify({
        'success': True,
        'login': login,
        'server': server,
        'label': label,
        'message': 'Account added (session only — persists until bridge restart)',
    })


@app.route('/accounts/test', methods=['POST'])
def test_account():
    """Test connection for an account before adding."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body required'}), 400

    login = data.get('login', '')
    password = data.get('password', '')
    server = data.get('server', '')

    if not login or not password:
        return jsonify({'error': 'login and password required'}), 400

    try:
        login_int = int(login) if str(login).isdigit() else login
    except ValueError:
        return jsonify({'error': f'Invalid login: {login}'}), 400

    # Shutdown current connection temporarily
    global mt5_initialized
    was_initialized = mt5_initialized
    if mt5_initialized:
        mt5.shutdown()
        mt5_initialized = False

    initialized = mt5.initialize(login=login_int, password=str(password), server=str(server))

    if initialized:
        info = mt5.account_info()
        mt5.shutdown()
        mt5_initialized = False

        # Reconnect original
        if was_initialized:
            initialize_mt5()

        return jsonify({
            'success': True,
            'login': str(info.login) if info else login,
            'server': info.server if info else server,
            'balance': float(info.balance) if info else None,
            'currency': info.currency if info else None,
        })

    error = mt5.last_error()
    # Reconnect original
    if was_initialized:
        initialize_mt5()

    return jsonify({
        'success': False,
        'error': str(error),
    }), 400


@app.route('/calendar', methods=['GET'])
def economic_calendar():
    """Get economic calendar events from MT5."""
    err = ensure_mt5()
    if err:
        return err

    country = request.args.get('country', '')
    currency = request.args.get('currency', '').upper()

    try:
        # MT5 calendar — from_date to to_date
        from_date = datetime.now()
        to_date = from_date + timedelta(days=7)
        events = mt5.calendar_get(from_date, to_date)

        result = []
        if events is not None:
            for e in events[:50]:  # Limit to 50
                event_time = datetime.fromtimestamp(e.time) if e.time else None
                result.append({
                    'id': e.id,
                    'name': e.name,
                    'country': e.country,
                    'currency': e.currency,
                    'importance': e.importance,
                    'time': event_time.isoformat() if event_time else None,
                    'actual': e.actual_value if hasattr(e, 'actual_value') else None,
                    'forecast': e.forecast_value if hasattr(e, 'forecast_value') else None,
                    'previous': e.previous_value if hasattr(e, 'previous_value') else None,
                })

            # Filter by currency if requested
            if currency:
                result = [e for e in result if e.get('currency', '').upper() == currency]

        return jsonify({
            'events': result,
            'count': len(result),
            'from': from_date.isoformat(),
            'to': to_date.isoformat(),
        })
    except Exception as ex:
        logger.error(f'Calendar error: {ex}')
        return jsonify({'error': str(ex), 'events': [], 'count': 0})


@app.route('/history/deals', methods=['GET'])
def deal_history():
    """Get deal history with date filtering."""
    err = ensure_mt5()
    if err:
        return err

    days = request.args.get('days', 30, type=int)
    symbol = request.args.get('symbol', '').upper()
    from_date = datetime.now() - timedelta(days=days)
    to_date = datetime.now() + timedelta(days=1)

    try:
        deals = mt5.history_deals_get(from_date, to_date)
        result = []
        if deals is not None:
            for d in deals:
                if symbol and d.symbol.upper() != symbol:
                    continue
                result.append({
                    'ticket': d.ticket,
                    'order': d.order,
                    'position': d.position_id if hasattr(d, 'position_id') else None,
                    'symbol': d.symbol,
                    'type': 'buy' if d.type == 0 else 'sell',
                    'entry': d.entry,
                    'volume': float(d.volume),
                    'price': float(d.price),
                    'profit': float(d.profit),
                    'commission': float(d.commission),
                    'swap': float(d.swap),
                    'time': datetime.fromtimestamp(d.time).isoformat(),
                    'comment': d.comment,
                })

        return jsonify({
            'deals': result,
            'count': len(result),
            'from': from_date.isoformat(),
            'to': to_date.isoformat(),
        })
    except Exception as ex:
        logger.error(f'Deal history error: {ex}')
        return jsonify({'error': str(ex)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('BRIDGE_PORT', 5000))
    logger.info(f'Starting MT5 Bridge on port {port}...')
    logger.info(f'MT5 package available: {mt5_available}')

    logger.info(f'Flask server starting — MT5 will connect on first API request')

    # Start Flask first, MT5 connects lazily on first request
    app.run(host='127.0.0.1', port=port, debug=False)
