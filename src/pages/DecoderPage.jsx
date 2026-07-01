import { useState, useCallback } from 'react';
import './decoder.css';

// Known format parsers
const FORMATS = {
  'earnings-whisper': {
    label: 'Earnings Whisper',
    description: 'Earnings Whisper email format — extracts ticker, estimates, sentiment, dates, and option activity.',
    icon: '📧',
    patterns: [
      { key: 'ticker', label: 'Ticker', regex: /\((\w{1,5})\)/g, multi: true },
      { key: 'companyName', label: 'Company', regex: /^###\s+(.+?)\s+(?:is|Earnings)/gm },
      { key: 'reportDate', label: 'Report Date', regex: /(?:report earnings on|to report earnings on)\s+(\w+day,?\s+\w+\s+\d{1,2},?\s+\d{4})/gi },
      { key: 'reportTime', label: 'Report Time', regex: /approximately\s+([\d:]+ [AP]M ET)/gi },
      { key: 'consensusEPS', label: 'Consensus EPS', regex: /consensus (?:earnings )?estimate is \$?([\d.-]+) per share/gi },
      { key: 'whisperEPS', label: 'Whisper EPS', regex: /Earnings Whisper ® number is \$?([\d.-]+) per share/gi },
      { key: 'revenueEst', label: 'Revenue Est', regex: /revenue of \$?([\d.]+)\s*(billion|million|trillion)/gi },
      { key: 'revenueGrowth', label: 'Rev Growth YoY', regex: /(\d+\.?\d*%)\s+year-over-year revenue growth/gi },
      { key: 'sentiment', label: 'Investor Sentiment', regex: /Investors are (\w+)/gi },
      { key: 'beatExpect', label: 'Expecting Beat %', regex: /(\d+\.?\d*%)\s+expecting a beat/gi },
      { key: 'shortChange', label: 'Short Interest Change', regex: /Short interest has (increased|decreased) by (\d+\.?\d*%)/gi },
      { key: 'priceDrift', label: 'Price Drift', regex: /stock has drifted (higher|lower) by (\d+\.?\d*%)/gi },
      { key: 'vs200Day', label: 'vs 200-day MA', regex: /(\d+\.?\d*%)\s+(above|below) its 200 day moving average/gi },
      { key: 'avg200Day', label: '200-day MA Price', regex: /200 day moving average of \$?([\d.]+)/gi },
      { key: 'optionMove', label: 'Option-Implied Move', regex: /pricing in a (\d+\.?\d*%) move on earnings/gi },
      { key: 'avgMove', label: 'Avg Quarterly Move', regex: /averaged a (\d+\.?\d*%) move in recent quarters/gi },
      { key: 'notableOptions', label: 'Notable Options', regex: /notable buying of ([\d,]+) contracts of the \$?([\d.]+) (call|put)/gi },
    ],
  },
  'csv': {
    label: 'CSV Data',
    description: 'Comma-separated values — auto-detects headers and shows a preview table.',
    icon: '📊',
  },
  'json': {
    label: 'JSON',
    description: 'JSON data — pretty-prints and validates structure.',
    icon: '🔄',
  },
  'generic': {
    label: 'Generic Text',
    description: 'Free-form text — basic statistics (word count, line count, URL extraction).',
    icon: '📝',
  },
};

function detectFormat(text) {
  if (!text || !text.trim()) return 'generic';
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  if (t.includes('Earnings Whisper') && t.includes('consensus earnings estimate')) return 'earnings-whisper';
  // Simple CSV detection
  const lines = t.split('\n').filter(Boolean);
  if (lines.length >= 3 && lines[0].includes(',') && lines[1].includes(',')) return 'csv';
  return 'generic';
}

function EarningsWhisperResult({ results }) {
  if (!results || results.length === 0) {
    return <p className="decoder-empty">No earnings data detected. Try pasting a complete Earnings Whisper email.</p>;
  }

  // Group by company
  const companies = [];
  let current = null;
  for (const r of results) {
    if (r.key === 'companyName') {
      current = { name: r.value, fields: [] };
      companies.push(current);
    } else if (current) {
      current.fields.push(r);
    }
  }

  return (
    <div className="decoder-results">
      {companies.map((co, ci) => (
        <div key={ci} className="decoder-company-card">
          <h3>{co.name || `Company ${ci + 1}`}</h3>
          <table className="decoder-fields-table">
            <tbody>
              {co.fields.map((f, fi) => (
                <tr key={fi}>
                  <td className="decoder-field-label">{f.label}</td>
                  <td className="decoder-field-value">
                    {Array.isArray(f.value)
                      ? f.value.map((v, vi) => <span key={vi} className="decoder-tag">{v}</span>)
                      : f.value || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function GenericResult({ text }) {
  if (!text || !text.trim()) return null;
  const lines = text.split('\n').filter(Boolean);
  const words = text.split(/\s+/).filter(Boolean);
  const urls = text.match(/https?:\/\/[^\s)]+/g) || [];
  return (
    <div className="decoder-generic-stats">
      <div className="decoder-stat"><span className="decoder-stat-value">{lines.length}</span><span className="decoder-stat-label">Lines</span></div>
      <div className="decoder-stat"><span className="decoder-stat-value">{words.length}</span><span className="decoder-stat-label">Words</span></div>
      <div className="decoder-stat"><span className="decoder-stat-value">{text.length}</span><span className="decoder-stat-label">Chars</span></div>
      <div className="decoder-stat"><span className="decoder-stat-value">{urls.length}</span><span className="decoder-stat-label">URLs</span></div>
    </div>
  );
}

export default function DecoderPage() {
  const [input, setInput] = useState('');
  const [detectedFormat, setDetectedFormat] = useState('generic');
  const [parseResults, setParseResults] = useState(null);
  const [aiEnabled, setAiEnabled] = useState(false);

  const handlePaste = useCallback((e) => {
    const text = e.clipboardData?.getData('text') || e.target.value;
    // Debounce detection on next tick
    setTimeout(() => {
      const format = detectFormat(text);
      setDetectedFormat(format);
    }, 0);
  }, []);

  const handleParse = useCallback(() => {
    const format = detectFormat(input);
    setDetectedFormat(format);

    if (format === 'earnings-whisper') {
      const fmt = FORMATS['earnings-whisper'];
      const results = [];
      for (const pattern of fmt.patterns) {
        const matches = [...input.matchAll(pattern.regex)];
        if (pattern.multi) {
          for (const m of matches) {
            results.push({ key: pattern.key, label: pattern.label, value: m[1] || m[0] });
          }
        } else {
          const m = matches[0];
          if (m) {
            let value = m[1] || m[0];
            // Clean up common extras
            if (pattern.key === 'revenueEst' && m[2]) value = `${m[1]} ${m[2]}`;
            if (pattern.key === 'shortChange' && m[2]) value = `${m[1]} ${m[2]}`;
            if (pattern.key === 'priceDrift' && m[2]) value = `${m[1]} ${m[2]}`;
            if (pattern.key === 'vs200Day' && m[2]) value = `${m[1]} ${m[2]}`;
            if (pattern.key === 'notableOptions') value = `${parseInt(m[1].replace(/,/g, '')).toLocaleString()} × $${m[2]} ${m[3]}s`;
            results.push({ key: pattern.key, label: pattern.label, value });
          }
        }
      }
      setParseResults({ format: 'earnings-whisper', results });
    } else {
      setParseResults({ format, raw: input });
    }
  }, [input]);

  const activeFormat = FORMATS[detectedFormat] || FORMATS.generic;

  return (
    <div className="decoder-page">
      <header className="decoder-header">
        <h1>Decoder</h1>
        <p>Paste structured content (Earnings Whisper emails, JSON, CSV) to extract key data points automatically.</p>
      </header>

      <div className="decoder-layout">
        {/* Input area */}
        <section className="decoder-input-section">
          <div className="decoder-format-bar">
            <span className="decoder-format-badge" title={`Detected: ${activeFormat.label}`}>
              {activeFormat.icon} {activeFormat.label}
            </span>
            <span className="decoder-format-desc">{activeFormat.description}</span>
          </div>

          <textarea
            className="decoder-textarea"
            placeholder={`Paste content here…\n\nEarnings Whisper emails, JSON payloads, CSV data, or any structured text.`}
            value={input}
            onChange={(e) => { setInput(e.target.value); handlePaste(e); }}
            rows={14}
          />

          <div className="decoder-actions">
            <button type="button" className="decoder-btn decoder-btn--primary" onClick={handleParse} disabled={!input.trim()}>
              Parse Content
            </button>
            <label className="decoder-ai-toggle">
              <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
              <span>AI Analysis</span>
              <span className="decoder-ai-badge">Coming Soon</span>
            </label>
          </div>

          {aiEnabled && (
            <div className="decoder-ai-placeholder">
              <p>🤖 AI-powered insight extraction will be activated here. The system will analyze parsed earnings data and provide:</p>
              <ul>
                <li>Beat/miss probability assessment</li>
                <li>Comparison to sector peers</li>
                <li>Option flow interpretation</li>
                <li>Historical accuracy of whisper vs actual</li>
              </ul>
            </div>
          )}
        </section>

        {/* Results area */}
        <section className="decoder-results-section">
          <h2>Results</h2>
          {!parseResults && (
            <p className="decoder-hint">Paste content and click "Parse Content" to extract data.</p>
          )}

          {parseResults?.format === 'earnings-whisper' && (
            <EarningsWhisperResult results={parseResults.results} />
          )}

          {parseResults?.format === 'json' && (
            <pre className="decoder-json-preview">{JSON.stringify(JSON.parse(parseResults.raw), null, 2)}</pre>
          )}

          {parseResults?.format === 'csv' && (
            <div className="decoder-csv-preview">
              <pre className="decoder-raw">{parseResults.raw}</pre>
            </div>
          )}

          {parseResults?.format === 'generic' && (
            <GenericResult text={parseResults.raw} />
          )}
        </section>
      </div>
    </div>
  );
}
