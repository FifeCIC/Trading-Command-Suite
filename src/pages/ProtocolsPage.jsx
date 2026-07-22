import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import './ProtocolsPage.css';

const SOURCE_LABELS = { code: 'System', database: 'Database' };
const SOURCE_COLORS = { code: '#8b5cf6', database: '#3b82f6' };

/** Classify a protocol by its directive/data dependencies */
function getProtocolType(proto) {
  const id = (proto.id || '').toLowerCase();
  const name = (proto.name || '').toLowerCase();
  const combined = id + ' ' + name;

  if (/news|sentiment|social/i.test(combined)) {
    return { label: 'News-Reactive', color: '#f59e0b', icon: '📰' };
  }
  if (/analyst|earnings|whisper/i.test(combined)) {
    return { label: 'Analyst-Driven', color: '#3b82f6', icon: '📊' };
  }
  if (/insider|congress/i.test(combined)) {
    return { label: 'Insider-Aware', color: '#a855f7', icon: '🔍' };
  }
  if (/macro|dxy|oil|gold|commodity/i.test(combined)) {
    return { label: 'Macro-Driven', color: '#14b8a6', icon: '🌍' };
  }
  return { label: 'Technical-Only', color: '#64748b', icon: '📈' };
}

export default function ProtocolsPage() {
  const [selected, setSelected] = useState(null);
  const [styleFilter, setStyleFilter] = useState('All');

  const protocolsQuery = useQuery({
    queryKey: ['protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols'),
    staleTime: 30_000,
  });

  const protocols = Array.isArray(protocolsQuery.data?.protocols)
    ? protocolsQuery.data.protocols
    : [];
  const loading = protocolsQuery.isLoading;
  const error = protocolsQuery.error?.message || null;

  useEffect(() => {
    if (protocols.length > 0 && !selected) setSelected(protocols[0]);
  }, [protocols, selected]);

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
                <div className="protocols-item-name">
                  {p.name}
                  <span className={`protocols-item-conn ${p.isFullyConnected ? 'connected' : p.connectionCount > 0 ? 'partial' : 'none'}`} title={p.isFullyConnected ? 'Fully connected — trading enabled' : p.connectionCount > 0 ? `${p.connectionCount} strategy(s), monitoring only` : 'No scoring strategies linked'} />
                </div>
                <div className="protocols-item-meta">
                  <span className="protocols-source" style={{ background: SOURCE_COLORS[p.source] || '#888' }}>
                    {SOURCE_LABELS[p.source] || p.source}
                  </span>
                  <span className="protocols-type-mini" style={{ color: getProtocolType(p).color, borderColor: getProtocolType(p).color }}>
                    {getProtocolType(p).label}
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
              <div style={{ flex: 1 }}>
                <h1>{selectedProto.name}</h1>
                <span
                  className="protocols-source-badge"
                  style={{ background: SOURCE_COLORS[selectedProto.source] || '#888' }}
                >
                  {SOURCE_LABELS[selectedProto.source] || selectedProto.source}
                </span>
                {(() => {
                  const pt = getProtocolType(selectedProto);
                  return (
                    <span className="protocols-type-badge" style={{ background: pt.color }}>
                      {pt.icon} {pt.label}
                    </span>
                  );
                })()}
              </div>
              <div className="protocols-id-section">
                <code className="protocols-id">{selectedProto.id}</code>
                <p className="protocols-id-hint">
                  API: <code>?protocol={selectedProto.id}</code>
                </p>
              </div>
            </div>

            <p className="protocols-description">{selectedProto.description}</p>

            {/* ── Merged Stats Grid ── */}
            <div className="protocols-stats">
              {selectedProto.tradingStyle && (
                <div className="protocols-stat">
                  <div className="protocols-stat-value">{selectedProto.tradingStyle}</div>
                  <div className="protocols-stat-label">Style</div>
                </div>
              )}
              {selectedProto.recommendedTimeframe && (
                <div className="protocols-stat">
                  <div className="protocols-stat-value">{selectedProto.recommendedTimeframe}</div>
                  <div className="protocols-stat-label">Timeframe</div>
                </div>
              )}
              {selectedProto.avgHoldTime && (
                <div className="protocols-stat">
                  <div className="protocols-stat-value">{selectedProto.avgHoldTime}</div>
                  <div className="protocols-stat-label">Avg Hold</div>
                </div>
              )}
              {selectedProto.winRateTarget && (
                <div className="protocols-stat">
                  <div className="protocols-stat-value">{selectedProto.winRateTarget}</div>
                  <div className="protocols-stat-label">Win Rate</div>
                </div>
              )}
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
            {selectedProto.idealFor && (
              <p className="protocols-advisory-ideal">{selectedProto.idealFor}</p>
            )}

            {/* ── META.Stack Connections ── */}
            <div className="protocols-connections">
              <h3>META.Stack Connections</h3>
              
              {/* Watchlists */}
              <div className="protocols-conn-row">
                <span className="protocols-conn-label">Watchlists</span>
                <span className="protocols-conn-value">
                  {selectedProto.linkedWatchlists?.length > 0
                    ? selectedProto.linkedWatchlists.map((w, i) => (
                        <span key={i} className="protocols-conn-chip" title={`Protocol scores symbols from '${w}' watchlist`}>👁 {w}</span>
                      ))
                    : <span className="protocols-conn-none" title="No watchlist linked — protocol may not be scoped to specific symbols">⚠ Not linked to any watchlist</span>
                  }
                </span>
              </div>

              {/* Scoring Strategies */}
              <div className="protocols-conn-row">
                <span className="protocols-conn-label">Strategies</span>
                <span className="protocols-conn-value">
                  {selectedProto.linkedStrategies?.length > 0
                    ? selectedProto.linkedStrategies.map((s, i) => (
                        <span key={i} className={`protocols-conn-chip ${s.trading ? 'protocols-conn-trading' : ''}`} title={s.trading ? `Strategy '${s.name}' → watchlist '${s.watchlist}' — trading enabled` : `Strategy '${s.name}' → watchlist '${s.watchlist}' (monitoring only)`}>
                          {s.trading ? '⚡' : '📋'} {s.name}
                        </span>
                      ))
                    : <span className="protocols-conn-none">Not used by any scoring strategy</span>
                  }
                </span>
              </div>

              {/* Connection summary */}
              <div className="protocols-conn-summary">
                {selectedProto.isFullyConnected
                  ? <span className="protocols-conn-ok">✅ Fully connected — protocol has active trading strategies</span>
                  : selectedProto.connectionCount > 0
                    ? <span className="protocols-conn-partial">🔗 Partially connected — {selectedProto.connectionCount} strategy(s), no active trading</span>
                    : <span className="protocols-conn-none">⚪ Isolated — protocol is not part of any META.Stack</span>
                }
              </div>
            </div>
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
                        <li key={d.id} className={`protocols-directive ${d.maxScore !== 100 ? 'variable-max' : ''}${d.description ? ' has-popover' : ''}`}>
                          <code className="protocols-directive-id">{d.name || d.id}</code>
                          {d.description && (
                            <span className="protocols-directive-popover">
                              <strong>{d.name || d.id}</strong>
                              <span>{d.description}</span>
                              <span className="protocols-directive-popover-score">Max: {d.maxScore}</span>
                            </span>
                          )}
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
