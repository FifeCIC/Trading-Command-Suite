import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ApiOfflineBanner from '../components/ApiOfflineBanner';
import './trading-styles.css';

const CATEGORY_LABELS = {
  active: '🎯 Active Trading',
  portfolio: '📊 Portfolio',
  specialty: '🔧 Specialty',
  automation: '⚙️ Automation',
};

export default function TradingStylesPage() {
  const qc = useQueryClient();
  const [seeded, setSeeded] = useState(false);

  const { data: styles, isLoading, isError } = useQuery({
    queryKey: ['planner', 'styles'],
    queryFn: () => apiGet('/api/planner/styles'),
    refetchInterval: 60000,
  });

  const seedMutation = useMutation({
    mutationFn: () => apiPost('/api/planner/styles/seed'),
    onSuccess: (data) => { qc.invalidateQueries({ queryKey: ['planner', 'styles'] }); setSeeded(true); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ styleKey, enabled }) => apiPatch(`/api/planner/styles/${styleKey}/toggle`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['planner', 'styles'] }),
  });

  useEffect(() => {
    if (styles && styles.length === 0 && !seeded) {
      seedMutation.mutate();
    }
  }, [styles]);

  const items = styles || [];
  const enabledCount = items.filter((s) => s.enabled).length;

  // Group by category
  const grouped = items.reduce((acc, style) => {
    const cat = style.category || 'active';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(style);
    return acc;
  }, {});

  return (
    <div className="ts-page">
      <motion.header className="ts-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1>🎨 Trading Styles</h1>
        <p className="ts-subtitle">
          Select the trading styles you use or want to explore. Future: your selections will adapt the UI throughout the app.
          {enabledCount > 0 && <span className="ts-count"> — {enabledCount} enabled</span>}
        </p>
      </motion.header>

      {isError && <ApiOfflineBanner />}
      {isLoading && <LoadingSkeleton variant="text" lines={6} />}

      {!isLoading && items.length === 0 && !seedMutation.isPending && (
        <div className="ts-empty">
          <p>No trading styles configured.</p>
          <button className="ts-seed-btn" onClick={() => seedMutation.mutate()}>Load Default Styles</button>
        </div>
      )}

      {seedMutation.isPending && <LoadingSkeleton variant="text" lines={3} />}

      <div className="ts-grid">
        {Object.entries(grouped).map(([category, catStyles]) => (
          <div key={category} className="ts-category">
            <h3 className="ts-cat-label">{CATEGORY_LABELS[category] || category}</h3>
            <div className="ts-cat-items">
              {catStyles.map((style, i) => (
                <motion.div
                  key={style.styleKey}
                  className={`ts-card ${style.enabled ? 'ts-enabled' : ''}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => toggleMutation.mutate({ styleKey: style.styleKey, enabled: !style.enabled })}
                >
                  <div className="ts-card-left">
                    <span className="ts-card-label">{style.label}</span>
                    {style.description && <span className="ts-card-desc">{style.description}</span>}
                  </div>
                  <div className={`ts-toggle ${style.enabled ? 'ts-toggle-on' : ''}`}>
                    <div className="ts-toggle-knob" />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="ts-future-note">
        <p>💡 Future: enabled styles will influence which pages, strategies, and tools are surfaced in the navigation and dashboard. Preferences stored here provide the foundation for UI adaptation.</p>
      </div>
    </div>
  );
}
