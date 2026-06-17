import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import './snapshot-library.css';

export default function SnapshotLibraryPage() {
  const [note, setNote] = useState('');
  const [capturing, setCapturing] = useState(false);
  const qc = useQueryClient();

  const snapshotsQuery = useQuery({
    queryKey: ['snapshots'],
    queryFn: () => apiGet('/api/snapshots'),
  });

  const snapshots = snapshotsQuery.data || [];

  async function handleCapture() {
    setCapturing(true);
    await apiPost('/api/snapshots', {
      symbol: 'NVDA',
      timeframe: '1d',
      notes: note || 'Manual snapshot',
      candleData: Array.from({ length: 100 }, (_, i) => ({
        timestamp: new Date(Date.now() - (99 - i) * 3600000).toISOString(),
        open: 140 + Math.random() * 5,
        high: 143 + Math.random() * 5,
        low: 139 + Math.random() * 5,
        close: 141 + Math.random() * 5,
        volume: 50000000 + Math.random() * 20000000,
      })),
    });
    setNote('');
    setCapturing(false);
    qc.invalidateQueries({ queryKey: ['snapshots'] });
  }

  async function handleDelete(id) {
    if (!confirm('Delete this snapshot?')) return;
    await fetch(`/api/snapshots/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['snapshots'] });
  }

  return (
    <main className="snp-page">
      <header className="snp-header">
        <h1>Market Snapshots</h1>
        <p>Capture and replay chart moments for training and analysis.</p>
      </header>

      <div className="snp-capture-bar">
        <input type="text" placeholder="Notes (optional)..." value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="snp-btn" onClick={handleCapture} disabled={capturing}>
          {capturing ? 'Capturing…' : '📸 Capture NVDA Snapshot'}
        </button>
      </div>

      <div className="snp-grid">
        {snapshots.length === 0 && <p className="snp-empty">No snapshots yet. Capture one above.</p>}
        {snapshots.map((s) => (
          <article key={s.id} className="snp-card">
            <div className="snp-card-header">
              <strong>{s.symbol}</strong>
              <span className="snp-chip">{s.timeframe}</span>
              {s.starred && <span className="snp-star">⭐</span>}
            </div>
            <p className="snp-notes">{s.notes || 'No notes'}</p>
            <div className="snp-meta">
              {s.candleData?.length || 0} candles · {new Date(s.createdAt).toLocaleDateString()}
            </div>
            <div className="snp-actions">
              <button type="button" className="snp-btn-sm" onClick={() => window.open(`/research/replay/${s.id}`, '_blank')}>
                ▶ Replay
              </button>
              <button type="button" className="snp-btn-sm snp-btn-del" onClick={() => handleDelete(s.id)}>
                🗑
              </button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
