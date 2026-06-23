import urllib.request, json

with open(r'C:\wamp64\www\trading-command-suite\nest\.env') as f:
    key = ''
    for line in f:
        if line.startswith('T212_API_KEY='):
            key = line.split('=', 1)[1].strip()
            break

headers = {'Authorization': f'Key {key}', 'Content-Type': 'application/json'}

# Get positions
req = urllib.request.Request('https://demo.trading212.com/api/v0/equity/portfolio', headers=headers)
positions = json.loads(urllib.request.urlopen(req).read())
hood = next((p for p in positions if 'HOOD' in p['ticker']), None)
print(f'HOOD: {hood["ticker"]} x {hood["quantity"]}' if hood else 'HOOD not found')

# Try sell with just ticker + quantity
body = json.dumps({'ticker': 'HOOD_US_EQ', 'quantity': 2}).encode()
req = urllib.request.Request('https://demo.trading212.com/api/v0/equity/orders/market', data=body, headers=headers, method='POST')
try:
    resp = urllib.request.urlopen(req)
    print(f'SELL result: {json.loads(resp.read())}')
except urllib.error.HTTPError as e:
    print(f'HTTP {e.code}: {e.read().decode()[:300]}')
