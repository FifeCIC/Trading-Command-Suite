const fs = require('fs')

const sourcePath = process.argv[2] || 'g:/My Drive/Project Management/Live/Trading-Command-Suite-Documentation/exit-wordpress/tradercore/admin/page/tradingplatforms/comparisons.php'
const outputPath = process.argv[3] || 'c:/wamp64/www/trading-command-suite/src/data/provider-comparisons.seed.json'

const text = fs.readFileSync(sourcePath, 'utf8')

function normalizeLabel(raw, fallback = '') {
  if (!raw) return fallback
  const quoted = raw.match(/'([^']+)'/)
  if (quoted) return quoted[1].replace(/\\'/g, "'")
  return raw.replace(/^'|'$/g, '').trim() || fallback
}

const categories = []
const catStart = text.indexOf('$comparison_categories = array(')
const dataStart = text.indexOf('$comparison_data = array(')
const catChunk = text.slice(catStart, dataStart)

const catRe = /^\t\t'([^']+)'\s*=>\s*array\(/gm
let m
while ((m = catRe.exec(catChunk)) !== null) {
  const id = m[1]
  const segmentEnd = catChunk.indexOf('\t\t),', m.index)
  const segment = catChunk.slice(m.index, segmentEnd > -1 ? segmentEnd + 5 : undefined)
  const titleMatch = segment.match(/'title'\s*=>\s*(.+),\s*\r?\n/)
  const title = normalizeLabel(titleMatch ? titleMatch[1] : id, id)
  const fields = []
  const fieldRe = /^\t\t\t\t'([^']+)'\s*=>\s*(.+),\s*$/gm
  let fm
  while ((fm = fieldRe.exec(segment)) !== null) {
    const fieldId = fm[1]
    const label = normalizeLabel(fm[2], fieldId)
    fields.push({ id: fieldId, label })
  }
  categories.push({ id, title, fields })
}

const ensureStart = text.indexOf('// Ensure all providers have complete data')
const dataChunk = text.slice(dataStart, ensureStart > -1 ? ensureStart : undefined)
const lines = dataChunk.split(/\r?\n/)
const providers = {}
let currentProvider = null
let currentField = null

for (const line of lines) {
  let match = line.match(/^\t\t'([^']+)'\s*=>\s*array\(/)
  if (match) {
    currentProvider = match[1]
    providers[currentProvider] = providers[currentProvider] || {}
    currentField = null
    continue
  }

  match = line.match(/^\t\t\t'([^']+)'\s*=>\s*array\(/)
  if (match && currentProvider) {
    currentField = match[1]
    providers[currentProvider][currentField] = providers[currentProvider][currentField] || {
      value: 'Pending',
      notes: 'Data pending migration',
    }
    continue
  }

  match = line.match(/^\t\t\t\t'value'\s*=>\s*'((?:[^'\\]|\\.)*)',/)
  if (match && currentProvider && currentField) {
    providers[currentProvider][currentField].value = match[1].replace(/\\'/g, "'")
    continue
  }

  match = line.match(/^\t\t\t\t'notes'\s*=>\s*'((?:[^'\\]|\\.)*)',/)
  if (match && currentProvider && currentField) {
    providers[currentProvider][currentField].notes = match[1].replace(/\\'/g, "'")
  }
}

const providerIds = Object.keys(providers)
const normalized = {
  source: {
    pluginFile: 'admin/page/tradingplatforms/comparisons.php',
    extractedAt: new Date().toISOString(),
    notes: 'Auto-extracted from plugin comparison table source by line-pattern parser.',
  },
  categories,
  providerIds,
  providers,
  directiveCapabilityAlpha: [
    { id: 'adx', label: 'ADX', status: 'Alpha Release', requiredData: ['adx', 'quote'] },
    { id: 'rsi', label: 'RSI', status: 'Alpha Release', requiredData: ['rsi', 'quote'] },
    { id: 'volume', label: 'Volume', status: 'Alpha Release', requiredData: ['volume', 'quote'] },
    { id: 'cci', label: 'CCI', status: 'Alpha Release', requiredData: ['cci', 'quote'] },
    { id: 'macd', label: 'MACD', status: 'Alpha Release', requiredData: ['macd', 'quote'] },
  ],
}

fs.mkdirSync(require('path').dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, JSON.stringify(normalized, null, 2))

console.log(`Wrote ${outputPath}`)
console.log(`Categories: ${categories.length}, Providers: ${providerIds.length}`)
