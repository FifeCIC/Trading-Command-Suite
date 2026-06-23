import urllib.request, json

trades = [
    ('NZDUSD', 'sell', 0.01),
]

for sym, typ, vol in trades:
    try:
        data = json.dumps({'symbol': sym, 'type': typ, 'volume': vol, 'comment': 'TCS Demo'}).encode()
        req = urllib.request.Request('http://localhost:5001/order', data=data,
                                     headers={'Content-Type': 'application/json'}, method='POST')
        r = json.loads(urllib.request.urlopen(req, timeout=10).read())
        ticket = r.get('ticket', '?')
        price = r.get('price', '?')
        success = r.get('success', False)
        error = r.get('error', '')
        print(f'{sym} {typ.upper()} {vol}: ticket={ticket} price={price} success={success} {error}')
    except Exception as e:
        print(f'{sym}: ERROR - {e}')

# Final positions
req = urllib.request.Request('http://localhost:5001/positions')
positions = json.loads(urllib.request.urlopen(req, timeout=5).read())
print(f'\n--- Open Positions ({positions["count"]}) ---')
for p in positions['positions']:
    print(f'  #{p["ticket"]} {p["type"]} {p["symbol"]} x{p["volume"]} @ {p["priceOpen"]} | PnL: {p["profit"]}')
