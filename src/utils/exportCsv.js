/**
 * exportCsv
 * =========
 * CSV export utility. Converts an array of data objects to CSV and
 * triggers a browser download via Blob + anchor click.
 *
 * @param {Array<Object>} data       - Array of row objects
 * @param {Array<{key: string, label: string, format?: (val) => string}>} columns
 *                                    - Column definitions
 * @param {string}        filename   - Output filename (e.g. "ranked-symbols.csv")
 * @param {Object}        [options]
 * @param {Array<string>} [options.comments] - Optional header comment lines (prefixed with #)
 */

export function exportCsv(data, columns, filename, options = {}) {
  const lines = []

  // Header comments
  if (options.comments) {
    for (const comment of options.comments) {
      lines.push(`# ${comment}`)
    }
  }

  // Header row
  lines.push(columns.map((c) => csvEscape(c.label)).join(','))

  // Data rows
  for (const row of data) {
    const values = columns.map((col) => {
      const raw = getNestedValue(row, col.key)
      const val = raw ?? ''
      return col.format ? col.format(val) : csvEscape(String(val))
    })
    lines.push(values.join(','))
  }

  // Trigger download
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/**
 * Get a nested value from an object using dot-path notation.
 * Example: getNestedValue({ a: { b: 1 } }, 'a.b') → 1
 */
function getNestedValue(obj, path) {
  if (!obj || !path) return obj
  const keys = String(path).split('.')
  let current = obj
  for (const key of keys) {
    if (current === null || current === undefined) return undefined
    current = current[key]
  }
  return current
}

/**
 * CSV-escape a value: wrap in quotes if it contains commas, quotes, or newlines.
 * Double any embedded quotes.
 */
function csvEscape(val) {
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}
