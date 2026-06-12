import { useState } from 'react';
import { apiGet } from '../core/api/client';

export default function ReportsPage() {
  const [csvLoading, setCsvLoading] = useState(false);
  const [jsonLoading, setJsonLoading] = useState(false);

  async function downloadCsv() {
    setCsvLoading(true);
    try {
      const res = await fetch('/api/export/portfolio/csv');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `portfolio-${new Date().toISOString().split('T')[0]}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } finally { setCsvLoading(false); }
  }

  async function downloadScores() {
    setJsonLoading(true);
    try {
      const date = new Date().toISOString().split('T')[0];
      const res = await fetch(`/api/export/scores/${date}/json`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `scores-${date}.json`;
      a.click(); URL.revokeObjectURL(url);
    } finally { setJsonLoading(false); }
  }

  return (
    <div className="rp-page">
      <h1>Reports &amp; Export</h1>

      <div className="rp-grid">
        <div className="rp-card">
          <h2>Portfolio CSV</h2>
          <p>Download your current positions as a CSV spreadsheet.</p>
          <button type="button" onClick={downloadCsv} disabled={csvLoading}>
            {csvLoading ? 'Downloading…' : 'Download CSV'}
          </button>
        </div>

        <div className="rp-card">
          <h2>Daily Scores JSON</h2>
          <p>Export today's SEES scores as JSON for external analysis.</p>
          <button type="button" onClick={downloadScores} disabled={jsonLoading}>
            {jsonLoading ? 'Downloading…' : 'Download JSON'}
          </button>
        </div>

        <div className="rp-card">
          <h2>Backtest Report</h2>
          <p>PDF reports for completed backtest runs (coming soon).</p>
          <button type="button" disabled>Coming Soon</button>
        </div>

        <div className="rp-card">
          <h2>Share Score Card</h2>
          <p>Generate a public HTML score card for any symbol.</p>
          <a href="/api/export/strategy/AAPL/share" target="_blank" rel="noopener noreferrer">
            <button type="button">View Example ↗</button>
          </a>
        </div>
      </div>
    </div>
  );
}
