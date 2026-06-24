"""
BTC Recorder — continuous 1-minute data capture from Binance.
Stores to MySQL marketbar table for backtesting.

Usage:
    python scripts/btc-recorder.py              # Default: 1m bars, runs until Ctrl+C
    python scripts/btc-recorder.py --keep        # Mark bars for long-term retention
    python scripts/btc-recorder.py --interval 5m # 5-minute bars

Each bar is inserted immediately. Duplicates (same symbol+timeframe+timestamp) are
skipped via INSERT IGNORE. The `provider` field is set to 'binance-live' to distinguish
from historical imports.
"""
import urllib.request, json, time, sys, uuid
from datetime import datetime, timezone
import mysql.connector

# ── Config ────────────────────────────────────────────────
SYMBOL = 'BTCUSDT'
DB_SYMBOL = 'BTC-USD'       # ticker in MySQL symbol table
INTERVAL = '1m'              # Binance interval: 1m, 5m, 15m, 1h
BARS_PER_FETCH = 5           # Fetch 5 bars each cycle (covers ~5 min gap)
FETCH_EVERY_SEC = 55         # Wait 55s between fetches (1m bars)
KEEP_LONG_TERM = '--keep' in sys.argv

print(f'BTC Recorder — {INTERVAL} bars, fetch every {FETCH_EVERY_SEC}s')
print(f'Mode: {"LONG-TERM (keep)" if KEEP_LONG_TERM else "TEMPORARY (rolling)"}')
print(f'Press Ctrl+C to stop')
print()

# ── DB Setup ──────────────────────────────────────────────
conn = mysql.connector.connect(
    host='localhost', port=3306,
    user='tradingcs', password='tradingcs_dev_2026',
    database='tradingcs'
)
cursor = conn.cursor()

# Find symbol ID
cursor.execute("SELECT id FROM symbol WHERE ticker=%s", (DB_SYMBOL,))
row = cursor.fetchone()
if not row:
    print(f'ERROR: Symbol {DB_SYMBOL} not found in database. Create it first.')
    sys.exit(1)
symbol_id = row[0]

provider_label = 'binance-live-keep' if KEEP_LONG_TERM else 'binance-live'

# ── Main Loop ─────────────────────────────────────────────
last_ts = None
bars_stored = 0
errors = 0

try:
    while True:
        try:
            url = f'https://api.binance.com/api/v3/klines?symbol={SYMBOL}&interval={INTERVAL}&limit={BARS_PER_FETCH}'
            data = json.loads(urllib.request.urlopen(url, timeout=10).read())

            inserted = 0
            for c in data:
                ts_ms = c[0]
                ts = datetime.fromtimestamp(ts_ms/1000, tz=timezone.utc)

                # Skip bars we already have
                if last_ts and ts_ms <= last_ts:
                    continue

                o, h, l, cl, v = float(c[1]), float(c[2]), float(c[3]), float(c[4]), float(c[5])

                # INSERT IGNORE to handle duplicates gracefully
                cursor.execute(
                    "INSERT IGNORE INTO marketbar (id, symbolId, provider, timeframe, timestamp, open, high, low, close, volume) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (str(uuid.uuid4()), symbol_id, provider_label, INTERVAL,
                     ts.strftime('%Y-%m-%d %H:%M:%S'), o, h, l, cl, v)
                )
                if cursor.rowcount > 0:
                    inserted += 1
                    last_ts = ts_ms

            conn.commit()
            bars_stored += inserted

            now_str = datetime.now(timezone.utc).strftime('%H:%M:%S')
            price = float(data[-1][4]) if data else 0
            mode_tag = '[KEEP]' if KEEP_LONG_TERM else '[TEMP]'
            print(f'{now_str} {mode_tag} BTC={price:.2f} | +{inserted} bars | total={bars_stored} | errors={errors}   ', end='\r')

        except Exception as e:
            errors += 1
            print(f'\n! Error: {e}')
            time.sleep(10)

        time.sleep(FETCH_EVERY_SEC)

except KeyboardInterrupt:
    print(f'\n\nStopped. {bars_stored} bars stored ({provider_label}).')

finally:
    cursor.close()
    conn.close()
