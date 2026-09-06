import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import PageInfoPopover from '../components/PageInfoPopover';
import './trading-settings.css';

/**
 * TradingSettingsPage — manual-trade defaults (#720).
 * One source of truth, two entry points: Settings → Trading and
 * Trading → Settings both render this same page (view id `trading-settings`).
 * Values persist in global_setting via /api/signals/trade-defaults.
 */

const FIELDS = [
  { key: 'size', label: 'Position size', unit: 'lots', step: 0.01, min: 0.001, max: 100 },
  { key: 'slPct', label: 'Stop loss', unit: '%', step: 0.5, min: 0, max: 50 },
  { key: 'tpPct', label: 'Take profit', unit: '%', step: 0.5, min: 0, max: 100 },
];

export default function TradingSettingsPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({ size: '0.01', slPct: '2', tpPct: '4' });
  const [saved, setSaved] = useState(false);

  const defaultsQuery = useQuery({
    queryKey: ['manual-trade-defaults'],
    queryFn: () => apiGet('/api/signals/trade-defaults'),
  });

  // Sync draft once the persisted values load (and on refetch).
  useEffect(() => {
    if (defaultsQuery.data) {
      setDraft({
        size: String(defaultsQuery.data.size),
        slPct: String(defaultsQuery.data.slPct),
        tpPct: String(defaultsQuery.data.tpPct),
      });
    }
  }, [defaultsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (values) => apiPut('/api/signals/trade-defaults', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manual-trade-defaults'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const submit = (e) => {
    e.preventDefault();
    const values = {
      size: parseFloat(draft.size),
      slPct: parseFloat(draft.slPct),
      tpPct: parseFloat(draft.tpPct),
    };
    saveMutation.mutate(values);
  };

  if (defaultsQuery.isLoading) {
    return <div className="ts-page"><LoadingSkeleton variant="card" count={1} /></div>;
  }

  return (
    <div className="ts-page">
      <motion.header className="ts-header" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1>Trading Settings
            <PageInfoPopover>
              Defaults applied when a Signals card places a manual trade without explicit
              size / stop-loss / take-profit. Same values from Settings or Trading.
            </PageInfoPopover>
          </h1>
          <p className="muted">Manual-trade defaults used by the Signals cards.</p>
        </div>
      </motion.header>

      {defaultsQuery.isError && <ApiOfflineBanner />}

      <motion.form
        className="ts-card"
        onSubmit={submit}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <div className="ts-grid">
          {FIELDS.map((f) => (
            <label key={f.key} className="ts-field">
              <span className="ts-field-label">{f.label}</span>
              <div className="ts-field-input">
                <input
                  type="number"
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  value={draft[f.key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
                <span className="ts-field-unit">{f.unit}</span>
              </div>
            </label>
          ))}
        </div>

        <footer className="ts-actions">
          <button type="submit" className="ts-save" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save defaults'}
          </button>
          {saved && <span className="ts-saved">✓ Saved</span>}
          {saveMutation.isError && (
            <span className="ts-error">{saveMutation.error?.message || 'Save failed'}</span>
          )}
        </footer>
      </motion.form>

      <p className="ts-note muted">
        These defaults are read at order time, so a save here affects the next manual trade
        immediately — no restart needed. Stored in <code>global_setting</code> (backup-safe).
      </p>
    </div>
  );
}
