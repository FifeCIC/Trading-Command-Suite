import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';

const CONDITIONS = ['bull', 'bear', 'ranging', 'volatile', 'crash'];
const FACTOR_TEMPLATES = [
  'RSI oversold', 'MACD crossover', 'EMA structure bullish', 'ATR dip quality',
  'Volume confirmation', 'Support level test', 'Resistance breakout', 'Panic exhaustion',
  'Overhead supply', 'News sentiment positive', 'Earnings proximity',
];

export default function ScenarioAnalysisPage() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [symbol, setSymbol] = useState('SPY');
  const [condition, setCondition] = useState('ranging');
  const [factors, setFactors] = useState([]);
  const [selectedId, setSelectedId] = useState('');

  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: ['scenarios'],
    queryFn: () => apiGet('/api/scenarios'),
  });

  const detailQuery = useQuery({
    queryKey: ['scenario', selectedId],
    queryFn: () => apiGet(`/api/scenarios/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const createMutation = useMutation({
    mutationFn: () => apiPost('/api/scenarios', { name, description, symbol, marketCondition: condition, factors }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scenarios'] }); setName(''); setDescription(''); setFactors([]); },
  });

  const assessMutation = useMutation({
    mutationFn: (id) => apiPost(`/api/scenarios/${id}/assess`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenario', selectedId] }),
  });

  const scenarios = Array.isArray(listQuery.data?.scenarios) ? listQuery.data.scenarios : [];
  const detail = detailQuery.data;
  const assessment = detail?.assessment;

  function addFactor(name) {
    if (!factors.find((f) => f.name === name)) {
      setFactors([...factors, { name, present: true, weight: 0.8 }]);
    }
  }

  return (
    <div className="sa-page">
      <h1>Scenario Analysis</h1>
      <p className="sa-sub">Model market scenarios, list factors at play, and assess whether the system is ready to make good decisions.</p>

      <div className="sa-grid">
        <div className="sa-card">
          <h2>New Scenario</h2>
          <label>Name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Post-FOMC dip" /></label>
          <label>Symbol <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></label>
          <label>Condition
            <select value={condition} onChange={(e) => setCondition(e.target.value)}>
              {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>Description <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></label>

          <div className="sa-factors">
            <p className="sa-factors-label">Factors</p>
            <div className="sa-factor-chips">
              {FACTOR_TEMPLATES.map((f) => (
                <button key={f} type="button" className={`sa-factor-chip ${factors.find((x) => x.name === f) ? 'active' : ''}`} onClick={() => addFactor(f)}>
                  + {f}
                </button>
              ))}
            </div>
            {factors.map((f, i) => (
              <div key={i} className="sa-factor-row">
                <span>{f.name}</span>
                <label><input type="checkbox" checked={f.present} onChange={() => { const nf = [...factors]; nf[i] = { ...f, present: !f.present }; setFactors(nf); }} /> Present</label>
                <input type="range" min="0" max="1" step="0.1" value={f.weight} onChange={(e) => { const nf = [...factors]; nf[i] = { ...f, weight: Number(e.target.value) }; setFactors(nf); }} />
                <span>{f.weight}</span>
              </div>
            ))}
          </div>

          <button type="button" className="sa-create" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? 'Creating...' : 'Create Scenario'}
          </button>
        </div>

        <div className="sa-card">
          <h2>Saved Scenarios</h2>
          {scenarios.map((s) => (
            <div key={s.id} className={`sa-row ${selectedId === s.id ? 'sa-row--selected' : ''}`} onClick={() => setSelectedId(s.id)}>
              <strong>{s.name}</strong>
              <span className="sa-chip">{s.marketCondition}</span>
              <span>{s.symbol}</span>
              {s.assessment && <span className="sa-score">{s.assessment.readinessScore}%</span>}
            </div>
          ))}
          {scenarios.length === 0 && <p className="sa-empty">No scenarios yet</p>}
        </div>
      </div>

      {detail && (
        <div className="sa-card">
          <h2>{detail.name} — {detail.symbol} ({detail.marketCondition})</h2>
          <p>{detail.description}</p>
          {detail.factors?.length > 0 && (
            <div className="sa-factor-list">
              {detail.factors.map((f, i) => (
                <span key={i} className={`sa-tag ${f.present ? 'sa-tag--present' : 'sa-tag--absent'}`}>{f.name} ({f.weight})</span>
              ))}
            </div>
          )}
          <button type="button" onClick={() => assessMutation.mutate(detail.id)} disabled={assessMutation.isPending}>
            {assessMutation.isPending ? 'Assessing...' : 'Run Assessment'}
          </button>
          {assessment && (
            <div className="sa-assessment">
              <div className="sa-readiness">Readiness: {assessment.readinessScore}%</div>
              <p>{assessment.recommendation}</p>
              <p className="sa-triggered">Directives: {assessment.directivesTriggered?.join(', ') || 'none'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
