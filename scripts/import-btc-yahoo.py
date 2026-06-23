import urllib.request, json, uuid
from datetime import datetime

url = 'https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?range=3mo&interval=1d'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
resp = urllib.request.urlopen(req, timeout=15)
data = json.loads(resp.read())
result = data['chart']['result'][0]
timestamps = result['timestamp']
quotes = result['indicators']['quote'][0]

btcId = '6fb5bd28-6ef3-11f1-b984-9c6b00b28963'
with open('C:/temp/btc_import.sql', 'w', encoding='utf-8') as f:
    for i in range(len(timestamps)):
        o = quotes['open'][i]
        if o is None:
            continue
        ts = datetime.utcfromtimestamp(timestamps[i]).strftime('%Y-%m-%d %H:%M:%S')
        h = quotes['high'][i]
        l = quotes['low'][i]
        c = quotes['close'][i]
        v = quotes['volume'][i] or 0
        uid = str(uuid.uuid4())
        f.write(f"INSERT IGNORE INTO marketbar (id, symbolId, provider, timeframe, timestamp, open, high, low, close, volume) VALUES ('{uid}', '{btcId}', 'yahoo', '1d', '{ts}', {o}, {h}, {l}, {c}, {v});\n")

print('SQL file written to C:/temp/btc_import.sql')
