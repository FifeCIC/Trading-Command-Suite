import { useState, useEffect } from 'react';
import './ProtocolsPage.css';

const API = 'http://localhost:3201/api/scoring/gated/protocols';

const SOURCE_LABELS = { code: 'System', database: 'Database' };
const SOURCE_COLORS = { code: '#8b5cf6', database: '#3b82f6' };

export default function ProtocolsPage() {
  const [protocols, setProtocols] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { fetchProtocols(); }, []);

  const fetchProtocols = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data.protocols) ? data.protocols : [];
      setProtocols(list);
      if (list.length > 0 && !selected) setSelected(list[0]);
    } catch (e) {
      console.error('Failed to load protocols', e);
      setError(e.message);
      setProtocols([]);
    }
    setLoading(false);
  };

  const selectedProto = protocols.find(p => p.id === selected?.id) || protocols[0];

  if (loading) {
    return (
      <div className="protocols-page">
        <div className="protocols-loading">Loading protocols…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="protocols-page">
        <div className="protocols-error">
          <h2>Unable to load protocols</h2>
          <p>{error}</p>
          <button onClick={fetchProtocols}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="protocols-page">
      <div className="protocols-sidebar">
        <h2>Protocols</h2>
        <div className="protocols-count">{protocols.length} protocol{protocols.length !== 1 ? 's' : ''}</div>
        {protocols.length === 0 ? (
          <div className="protocols-empty">No protocols found.</div>
        ) : (
          <ul className="protocols-list">
            {protocols.map(p => (
              <li
                key={p.id}
                className={`protocols-item ${selectedProto?.id === p.id ? 'active' : ''}`}
                onClick={() => setSelected(p)}
              >
                <div className="protocols-item-name">{p.name}</div>
                <div className="protocols-item-meta">
                  <span className="protocols-source" style={{ background: SOURCE_COLORS[p.source] || '#888' }}>
                    {SOURCE_LABELS[p.source] || p.source}
                  </span>
                  <span>{p.directiveCount} directives</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="protocols-detail">
        {selectedProto ? (
          <>
            <div className="protocols-header">
              <h1>{selectedProto.name}</h1>
              <span
                className="protocols-source-badge"
                style={{ background: SOURCE_COLORS[selectedProto.source] || '#888' }}
              >
                {SOURCE_LABELS[selectedProto.source] || selectedProto.source}
              </span>
            </div>

            <p className="protocols-description">{selectedProto.description}</p>

            <div className="protocols-stats">
              <div className="protocols-stat">
                <div className="protocols-stat-value">{selectedProto.directiveCount}</div>
                <div className="protocols-stat-label">Directives</div>
              </div>
              <div className="protocols-stat">
                <div className="protocols-stat-value">{selectedProto.maxScore?.toLocaleString() ?? 'N/A'}</div>
                <div className="protocols-stat-label">Max Score</div>
              </div>
              <div className="protocols-stat">
                <div className={`protocols-stat-value ${selectedProto.active ? 'active' : 'inactive'}`}>
                  {selectedProto.active ? 'Active' : 'Inactive'}
                </div>
                <div className="protocols-stat-label">Status</div>
              </div>
            </div>

            <div className="protocols-id-section">
              <h3>Protocol ID</h3>
              <code className="protocols-id">{selectedProto.id}</code>
              <p className="protocols-id-hint">
                Use this ID in API calls: <code>?protocol={selectedProto.id}</code>
              </p>
            </div>

            <div className="protocols-usage">
              <h3>API Usage</h3>
              <pre className="protocols-code">{`GET /api/scoring/gated/{symbol}?protocol=${selectedProto.id}
GET /api/scoring/gated/{symbol}?protocol=${selectedProto.id}&timeframe=5m&bars=100
POST /api/backtest/run  {"symbol":"BTC-USD","protocolId":"${selectedProto.id}","slPct":2.5,"tpPct":2.5}`}</pre>
            </div>
          </>
        ) : (
          <div className="protocols-no-selection">Select a protocol to view details</div>
        )}
      </div>
    </div>
  );
}
