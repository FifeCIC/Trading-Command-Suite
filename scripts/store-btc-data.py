"""Store Binance BTCUSDT 5m data into market_bar table for backtesting."""
import urllib.request, json, os, sys, uuid
from datetime import datetime, timezone

# Add nest directory to path for dotenv
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'nest'))

# Fetch from Binance
url = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=30'
data = json.loads(urllib.request.urlopen(url).read())

# Connect to MySQL
import mysql.connector
conn = mysql.connector.connect(
    host='localhost', port=3306,
    user='tradingcs', password='tradingcs_dev_2026',
    database='tradingcs'
)
cursor = conn.cursor()

# Find BTC-USD symbol ID
cursor.execute("SELECT id FROM symbol WHERE ticker='BTC-USD'")
row = cursor.fetchone()
if not row:
    print("ERROR: BTC-USD symbol not found")
    sys.exit(1)
symbol_id = row[0]

# Delete old 5m data for clean insert
cursor.execute("DELETE FROM marketbar WHERE symbolId=%s AND timeframe='5m'", (symbol_id,))
deleted = cursor.rowcount

# Insert new bars
inserted = 0
for c in data:
    ts = datetime.fromtimestamp(c[0]/1000, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    o, h, l, cl, v = float(c[1]), float(c[2]), float(c[3]), float(c[4]), float(c[5])
    cursor.execute(
        "INSERT INTO marketbar (id, symbolId, provider, timeframe, timestamp, open, high, low, close, volume) "
        "VALUES (%s, %s, 'binance', '5m', %s, %s, %s, %s, %s, %s)",
        (str(uuid.uuid4()), symbol_id, ts, o, h, l, cl, v)
    )
    inserted += 1

conn.commit()
print(f"Deleted {deleted} old bars, inserted {inserted} new BTC-USD 5m bars from Binance")
cursor.close()
conn.close()
