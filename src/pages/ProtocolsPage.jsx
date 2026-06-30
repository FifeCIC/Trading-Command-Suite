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
  const [styleFilter, setStyleFilter] = useState('All');

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

  // Derive unique styles from protocol data
  const styles = ['All', ...new Set(protocols.map(p => p.tradingStyle).filter(Boolean))];
  const filteredProtocols = styleFilter === 'All' ? protocols : protocols.filter(p => p.tradingStyle === styleFilter);

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
        <div className="protocols-count">{filteredProtocols.length} of {protocols.length} protocol{protocols.length !== 1 ? 's' : ''}</div>
        {/* Trading style filters */}
        <div className="protocols-filters">
          {styles.map(s => (
            <button
              key={s}
              className={`protocols-filter-chip ${styleFilter === s ? 'active' : ''}`}
              onClick={() => setStyleFilter(s)}
            >{s}</button>
          ))}
        </div>
        {filteredProtocols.length === 0 ? (
          <div className="protocols-empty">No protocols match this filter.</div>
        ) : (
          <ul className="protocols-list">
            {filteredProtocols.map(p => (
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

            {/* ── Trading Style Advisory ── */}
            {(selectedProto.tradingStyle || selectedProto.recommendedTimeframe || selectedProto.avgHoldTime) && (
              <div className="protocols-advisory">
                <h3>Trading Style</h3>
                <div className="protocols-advisory-grid">
                  {selectedProto.tradingStyle && (
                    <div className="protocols-advisory-item">
                      <div className="protocols-advisory-value">{selectedProto.tradingStyle}</div>
                      <div className="protocols-advisory-label">Style</div>
                    </div>
                  )}
                  {selectedProto.recommendedTimeframe && (
                    <div className="protocols-advisory-item">
                      <div className="protocols-advisory-value">{selectedProto.recommendedTimeframe}</div>
                      <div className="protocols-advisory-label">Timeframe</div>
                    </div>
                  )}
                  {selectedProto.avgHoldTime && (
                    <div className="protocols-advisory-item">
                      <div className="protocols-advisory-value">{selectedProto.avgHoldTime}</div>
                      <div className="protocols-advisory-label">Avg Hold</div>
                    </div>
                  )}
                  {selectedProto.winRateTarget && (
                    <div className="protocols-advisory-item">
                      <div className="protocols-advisory-value">{selectedProto.winRateTarget}</div>
                      <div className="protocols-advisory-label">Target Win Rate</div>
                    </div>
                  )}
                </div>
                {selectedProto.idealFor && (
                  <p className="protocols-advisory-ideal">{selectedProto.idealFor}</p>
                )}
              </div>
            )}

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

            {/* ── Directive Groups ── */}
            {selectedProto.groups && selectedProto.groups.length > 0 && (
              <div className="protocols-groups">
                <h3>Directive Groups</h3>
                {selectedProto.groups.map(group => (
                  <div key={group.id} className={`protocols-group-card ${group.isRiskGate ? 'risk-gate' : ''}`}>
                    <div className="protocols-group-header">
                      <span className="protocols-group-name">{group.name}</span>
                      <span className="protocols-group-weight">Weight: {(group.weight * 100).toFixed(0)}%</span>
                      {group.isRiskGate && (
                        <span className="protocols-risk-badge" title={`Multiplicative gate: ${Math.round(group.minMultiplier * 100)}%–${Math.round(group.maxMultiplier * 100)}% of signal survives`}>
                          ⚠ Gate {Math.round(group.minMultiplier * 100)}%–{Math.round(group.maxMultiplier * 100)}%
                        </span>
                      )}
                    </div>
                    <ul className="protocols-directive-list">
                      {group.directives.map(d => (
                        <li key={d.id} className={`protocols-directive ${d.maxScore !== 100 ? 'variable-max' : ''}`}>
                          <code className="protocols-directive-id">{d.id}</code>
                          <span className="protocols-directive-max">
                            {d.maxScore !== 100 ? `Max ${d.maxScore}` : '100'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

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
          <div className="protocols-empty-detail">Select a protocol to view details</div>
        )}
      </div>
    </div>
  );
}
