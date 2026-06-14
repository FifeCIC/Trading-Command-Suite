import re

dir = r'c:\wamp64\www\trading-command-suite\nest\src\modules\directives'

with open(dir + '/directives-registry.ts', 'r') as f:
    content = f.read()

suit = {}
def add(id, text):
    suit[id] = '  ' + text

add('rsi-oversold', "suitability: { regimeType:'ranging', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'mean-reversion' },")
add('macd-crossover', "suitability: { regimeType:'trending', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'trend' },")
add('ema-structure', "suitability: { regimeType:'trending', volatilityLevel:'any', instrumentTypes:['forex','stocks','indices'], minTimeframe:'1h', category:'trend' },")
add('atr-dip', "suitability: { regimeType:'ranging', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'4h', category:'mean-reversion' },")
add('volume-confirmation', "suitability: { regimeType:'trending', volatilityLevel:'any', instrumentTypes:['stocks','forex'], minTimeframe:'1h', category:'volume' },")
add('mfi', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'volume' },")
add('adx', "suitability: { regimeType:'trending', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'4h', category:'trend' },")
add('stochastic', "suitability: { regimeType:'ranging', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'mean-reversion' },")
add('rsi-overbought', "suitability: { regimeType:'ranging', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'mean-reversion' },")
add('momentum-continuation', "suitability: { regimeType:'trending', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'microstructure' },")
add('momentum-roc', "suitability: { regimeType:'trending', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'microstructure' },")
add('price-above-sma', "suitability: { regimeType:'trending', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'4h', category:'trend' },")
add('ma-crossover', "suitability: { regimeType:'trending', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'trend' },")
add('bollinger-bands', "suitability: { regimeType:'any', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'volatility' },")
add('bollinger-percent-b', "suitability: { regimeType:'ranging', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'mean-reversion' },")
add('cci', "suitability: { regimeType:'ranging', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'mean-reversion' },")
add('bollinger-squeeze', "suitability: { regimeType:'any', volatilityLevel:'low', instrumentTypes:['any'], minTimeframe:'1h', category:'volatility' },")
add('doji-pattern', "suitability: { regimeType:'any', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'pattern' },")
add('engulfing-pattern', "suitability: { regimeType:'any', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'pattern' },")
add('hammer-pattern', "suitability: { regimeType:'any', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'pattern' },")
add('obv', "suitability: { regimeType:'trending', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'volume' },")
add('volume-rhythm', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['stocks'], minTimeframe:'1d', category:'volume' },")
add('vwap', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['stocks'], minTimeframe:'1h', category:'volume' },")
add('volume-surge', "suitability: { regimeType:'any', volatilityLevel:'high', instrumentTypes:['any'], minTimeframe:'1h', category:'volume' },")
add('three-soldiers-pattern', "suitability: { regimeType:'trending', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'pattern' },")
add('parabolic-sar', "suitability: { regimeType:'trending', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'trend' },")
add('supertrend', "suitability: { regimeType:'trending', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'4h', category:'trend' },")
add('support-resistance', "suitability: { regimeType:'ranging', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'mean-reversion' },")
add('donchian-channel', "suitability: { regimeType:'trending', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'trend' },")
add('keltner-channel', "suitability: { regimeType:'ranging', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'mean-reversion' },")
add('chandelier-exit', "suitability: { regimeType:'any', volatilityLevel:'high', instrumentTypes:['any'], minTimeframe:'4h', category:'volatility' },")
add('atr-trailing-stop', "suitability: { regimeType:'any', volatilityLevel:'high', instrumentTypes:['any'], minTimeframe:'1h', category:'volatility' },")
add('range-contraction', "suitability: { regimeType:'any', volatilityLevel:'low', instrumentTypes:['any'], minTimeframe:'1h', category:'volatility' },")
add('sigma-score', "suitability: { regimeType:'ranging', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1d', category:'mean-reversion' },")
add('williams-r', "suitability: { regimeType:'ranging', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'mean-reversion' },")
add('demarker', "suitability: { regimeType:'ranging', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'mean-reversion' },")
add('awesome-oscillator', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'4h', category:'microstructure' },")
add('bulls-power', "suitability: { regimeType:'trending', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'microstructure' },")
add('bears-power', "suitability: { regimeType:'trending', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'microstructure' },")
add('force-index', "suitability: { regimeType:'trending', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'volume' },")
add('ease-of-movement', "suitability: { regimeType:'trending', volatilityLevel:'normal', instrumentTypes:['stocks'], minTimeframe:'1h', category:'volume' },")
add('chaikin-money-flow', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['stocks'], minTimeframe:'1d', category:'volume' },")
add('accumulation-distribution', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'volume' },")
add('vix-regime', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['indices'], minTimeframe:'1d', category:'macro' },")
add('news-sentiment', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['stocks'], minTimeframe:'1h', category:'macro' },")
add('earnings-proximity', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['stocks'], minTimeframe:'1d', category:'macro' },")
add('market-entropy', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'macro' },")
add('market-memory-zones', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'macro' },")
add('hurst-memory', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1d', category:'trend' },")
add('market-structure-bos', "suitability: { regimeType:'trending', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'trend' },")
add('falling-risk-pyramid', "suitability: { regimeType:'trending', volatilityLevel:'normal', instrumentTypes:['forex','stocks'], minTimeframe:'1h', category:'trend' },")
add('confluence-reversal', "suitability: { regimeType:'ranging', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'macro' },")
add('candle-pressure', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'5m', category:'microstructure' },")
add('price-time-gap', "suitability: { regimeType:'any', volatilityLevel:'high', instrumentTypes:['any'], minTimeframe:'15m', category:'microstructure' },")
add('fair-value-gap', "suitability: { regimeType:'any', volatilityLevel:'high', instrumentTypes:['any'], minTimeframe:'15m', category:'microstructure' },")
add('liquidity-sweep', "suitability: { regimeType:'any', volatilityLevel:'high', instrumentTypes:['any'], minTimeframe:'15m', category:'microstructure' },")
add('institutional-footprint', "suitability: { regimeType:'any', volatilityLevel:'high', instrumentTypes:['any'], minTimeframe:'1h', category:'microstructure' },")
add('pattern-density-sr', "suitability: { regimeType:'ranging', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'pattern' },")
add('price-action', "suitability: { regimeType:'ranging', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'mean-reversion' },")
add('overhead-supply', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'macro' },")
add('panic-exhaustion', "suitability: { regimeType:'trending', volatilityLevel:'high', instrumentTypes:['any'], minTimeframe:'1h', category:'macro' },")
add('session-timing-filter', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'session' },")
add('budget-gate', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'risk' },")
add('mt5-engulfing', "suitability: { regimeType:'any', volatilityLevel:'normal', instrumentTypes:['forex'], minTimeframe:'1h', category:'pattern' },")
add('mt5-harami', "suitability: { regimeType:'any', volatilityLevel:'normal', instrumentTypes:['forex'], minTimeframe:'1h', category:'pattern' },")
add('mt5-star-doji', "suitability: { regimeType:'any', volatilityLevel:'normal', instrumentTypes:['forex'], minTimeframe:'1h', category:'pattern' },")
add('mt5-hammer', "suitability: { regimeType:'any', volatilityLevel:'normal', instrumentTypes:['forex'], minTimeframe:'1h', category:'pattern' },")
add('mt5-dark-cloud-piercing', "suitability: { regimeType:'ranging', volatilityLevel:'normal', instrumentTypes:['forex'], minTimeframe:'1h', category:'pattern' },")
add('chaikin-mf', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['stocks'], minTimeframe:'1d', category:'volume' },")
add('accumulation-dist', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'volume' },")
add('volume-boundary', "suitability: { regimeType:'any', volatilityLevel:'any', instrumentTypes:['any'], minTimeframe:'1h', category:'volume' },")
add('mt5-engulfing-cci', "suitability: { regimeType:'any', volatilityLevel:'normal', instrumentTypes:['forex'], minTimeframe:'1h', category:'pattern' },")
add('donchian-breakout', "suitability: { regimeType:'trending', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'trend' },")
add('williams-percent-r', "suitability: { regimeType:'ranging', volatilityLevel:'normal', instrumentTypes:['any'], minTimeframe:'1h', category:'mean-reversion' },")

lines = content.split('\n')
result = []
current_id = None

for line in lines:
    result.append(line)
    m = re.match(r'^(\s+)id:\s*\'([^\']+)\'\s*,\s*$', line)
    if m:
        current_id = m.group(2)
    if current_id and current_id in suit and re.match(r'^\s+inputs:\s*\[', line):
        if line.strip().endswith('],'):
            result.append(suit[current_id])
            current_id = None
        else:
            current_id = None

with open(dir + '/directives-registry.ts', 'w') as f:
    f.write('\n'.join(result))

count = sum(1 for l in result if 'suitability:' in l)
print(f'Added suitability to {count} entries')
