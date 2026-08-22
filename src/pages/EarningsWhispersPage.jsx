import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../core/api/client'
import { formatCurrency } from '../core/format-utils'
import './earnings-whispers.css'

const PLACEHOLDER = `Paste the full Earnings Whispers email here — the per-symbol paragraphs, images and links included. Sections separated by ### headings will be split automatically.

Example:
### NVIDIA's AI Party Shows No Sign of a Hangover
NVIDIA ([NVDA](https://www.earningswhispers.com/stocks/NVDA)) is confirmed to report earnings on Wednesday, August 26, 2026 at approximately 4:20 PM ET... The consensus calls for $2.09 per share on revenue of $91.71 billion... the Earnings Whisper number sits a touch higher at $2.12 per share...`

function fmtBns(label) { return label ?? '—' }
function fmtPct(n) { return n == null ? '—' : `${n.toFixed(1)}%` }
function fmtMoney(n) { return n == null ? '—' : formatCurrency(n) }

export default function EarningsWhispersPage() {
  const [text, setText] = useState('')
  const [save, setSave] = useState(true)
  const [error, setError] = useState('')
  const queryClient = useQueryClient()

  const parseMutation = useMutation({
    mutationFn: () => apiPost('/api/earnings-whispers/parse', { text, save }),
    onSuccess: (data) => {
      setError('')
      if (data.saved) queryClient.invalidateQueries({ queryKey: ['earnings-whispers'] })
    },
    onError: (err) => setError(String(err?.message || err)),
  })

  const stored = useQuery({
    queryKey: ['earnings-whispers'],
    queryFn: () => apiGet('/api/earnings-whispers'),
    refetchInterval: 60_000,
  })

  const result = parseMutation.data ?? {}
  const entries = Array.isArray(result.entries) ? result.entries : []
  const batches = Array.isArray(stored.data?.batches) ? stored.data.batches : []

  return (
    <main className="ew-page">
      <header className="ew-page-header">
        <h1>Earnings Whispers</h1>
        <p>
          Paste Earnings Whispers email dumps here. Each symbol&apos;s paragraph is parsed for the
          consensus EPS/revenue, whisper number, guidance, beat expectations, implied move and
          positioning — then stored for long-term comparison against actual price action.
        </p>
      </header>

      <section className="ew-input-panel">
        <div className="ew-input-row">
          <label htmlFor="ew-email-text">Email dump</label>
          <label className="ew-save-toggle">
            <input
              type="checkbox"
              checked={save}
              onChange={(e) => setSave(e.target.checked)}
            />
            Save to database
          </label>
          <button
            type="button"
            className="ew-parse-btn"
            disabled={parseMutation.isPending || !text.trim()}
            onClick={() => parseMutation.mutate()}
          >
            {parseMutation.isPending ? 'Parsing…' : 'Parse'}
          </button>
        </div>
        <textarea
          id="ew-email-text"
          className="ew-email-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
        />
        {error && <p className="ew-error">{error}</p>}
      </section>

      {result.count != null && (
        <section className="ew-results-panel">
          <header className="ew-panel-header">
            <h2>Parsed {result.count} entr{result.count === 1 ? 'y' : 'ies'}</h2>
            {entries.length === 0 ? (
              <span className="ew-preview-badge">No symbols detected</span>
            ) : result.saved ? (
              <span className="ew-saved-badge">Saved to database</span>
            ) : save ? (
              <span className="ew-preview-badge">Could not save</span>
            ) : (
              <span className="ew-preview-badge">Preview only — enable Save to persist</span>
            )}
          </header>
          {entries.length === 0 && (
            <p className="ew-empty">
              No symbol paragraphs were detected. Paste the email with each symbol section including its
              ticker — plain Gmail text like “NVIDIA (NVDA)…” or markdown links like
              “[NVDA](https://www.earningswhispers.com/stocks/NVDA)” both work.
            </p>
          )}
          {entries.length > 0 && (
          <>
          <div className="ew-table-wrap">
            <table className="ew-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th>Reports</th>
                  <th>Consensus EPS</th>
                  <th>Consensus Rev</th>
                  <th>Whisper EPS</th>
                  <th>Guidance</th>
                  <th>Beat %</th>
                  <th>Implied Move</th>
                  <th>vs 200dma</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={`${e.symbol}-${i}`} className="ew-row">
                    <td><strong>{e.symbol}</strong></td>
                    <td>{e.name ?? '—'}</td>
                    <td>{e.reportDateLabel ?? '—'}</td>
                    <td>{fmtMoney(e.consensusEps)}</td>
                    <td>{fmtBns(e.consensusRevenueLabel)}</td>
                    <td>{fmtMoney(e.whisperEps)}</td>
                    <td>
                      {e.guidanceEpsLow != null || e.guidanceEpsHigh != null
                        ? `${fmtMoney(e.guidanceEpsLow)} – ${fmtMoney(e.guidanceEpsHigh)}`
                        : '—'}
                    </td>
                    <td>
                      {e.beatPct != null
                        ? `${fmtPct(e.beatPct)} ${e.beatSide === 'miss' ? 'miss' : 'beat'}`
                        : '—'}
                    </td>
                    <td>{fmtPct(e.impliedMovePct)}</td>
                    <td>{fmtPct(e.priceVs200dmaPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {entries.map((e, i) => (
            <details key={`d-${e.symbol}-${i}`} className="ew-entry-detail">
              <summary>
                {e.symbol} — {e.headline ?? 'No headline'}
              </summary>
              <div className="ew-entry-grid">
                <div><span className="ew-detail-label">Short interest</span>
                  {e.shortInterestChangePct != null
                    ? `${e.shortInterestDirection === 'down' ? '▼' : '▲'} ${fmtPct(e.shortInterestChangePct)} since last quarter`
                    : '—'}</div>
                <div><span className="ew-detail-label">Recent avg move</span>{fmtPct(e.recentAvgMovePct)}</div>
                <div><span className="ew-detail-label">Stock since last report</span>{fmtPct(e.stockChangePct)}</div>
                <div><span className="ew-detail-label">200dma price</span>{fmtMoney(e.dma200Price)}</div>
              </div>
              <p className="ew-raw-text">{e.rawText}</p>
            </details>
          ))}
          </>
          )}
        </section>
      )}

      <section className="ew-stored-panel">
        <header className="ew-panel-header">
          <h2>Stored</h2>
          <span className="ew-panel-meta">
            {stored.isLoading ? 'Loading…' : `${batches.length} import batch${batches.length === 1 ? '' : 'es'}`}
          </span>
        </header>
        {batches.length === 0 && !stored.isLoading && (
          <p className="ew-empty">Nothing stored yet — paste an email and parse with Save enabled.</p>
        )}
        <div className="ew-batch-list">
          {batches.map((b) => (
            <div key={b.id} className="ew-batch-row">
              <span className="ew-batch-date">
                {b.createdAt ? new Date(b.createdAt).toLocaleString() : '—'}
              </span>
              <span className="ew-batch-count">{b.entryCount} entries</span>
              <span className="ew-batch-count">{b.sourceName ?? 'Unknown source'}</span>
              <span className="ew-batch-status">{b.status}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
