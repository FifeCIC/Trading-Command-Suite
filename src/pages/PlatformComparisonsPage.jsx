import { useEffect, useState } from 'react';
import LoadingSkeleton from '../components/LoadingSkeleton';
import './trading-platforms.css';

// ── Constants ──────────────────────────────────────────────

const ALL_PROVIDERS = [
  'trading212', 'interactive_brokers', 'alpaca', 'alphavantage',
  'polygon', 'tradier', 'finnhub', 'twelvedata', 'eodhd', 'iexcloud',
];

function titleFromProviderId(id) {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function toneForValue(value = '') {
  const v = String(value).toLowerCase();
  if (v.includes('yes') || v.includes('full') || v === 'available') return 'ok';
  if (v.includes('no') || v.includes('not available') || v.includes('unavailable')) return 'warn';
  if (v.includes('limited') || v.includes('partial') || v.includes('rate')) return 'neutral';
  return 'neutral';
}

// ── Component ──────────────────────────────────────────────

export default function PlatformComparisonsPage() {
  const [seed, setSeed] = useState(null);
  const [providers, setProviders] = useState(ALL_PROVIDERS);

  useEffect(() => {
    import('../data/provider-comparisons.seed.json').then((m) => {
      setSeed(m.default);
      if (m.default?.providerIds?.length) {
        setProviders(m.default.providerIds);
      }
    });
  }, []);

  useEffect(() => {
    fetch('/api/providers')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length) {
          setProviders((prev) => {
            const apiIds = data.map((p) => p.id || p.provider).filter(Boolean);
            return [...new Set([...prev, ...apiIds])];
          });
        }
      })
      .catch(() => {});
  }, []);

  if (!seed) {
    return (
      <div className="trading-platforms-page">
        <header className="tp-page-header"><h1>Platform Comparisons</h1></header>
        <LoadingSkeleton variant="card" count={3} />
        <LoadingSkeleton variant="table" rows={6} cols={5} className="ls-spacer-top" />
      </div>
    );
  }

  const categories = seed.categories || [];
  const matrix = seed.providers || {};

  return (
    <div className="trading-platforms-page pc-page">
      <header className="tp-page-header">
        <h1>Platform Comparisons</h1>
        <p>All providers shown. Scroll horizontally to compare every platform.</p>
      </header>

      {categories.map((category) => (
        <section key={category.id} className="tp-card pc-section">
          <h3>{category.title}</h3>
          <div className="pc-scroll-wrap">
            <table className="pc-table">
              <thead>
                <tr>
                  <th className="pc-sticky-col">Capability</th>
                  {providers.map((pid) => (
                    <th key={pid} className="pc-provider-head">{titleFromProviderId(pid)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {category.fields.map((field) => (
                  <tr key={field.id}>
                    <td className="pc-sticky-col pc-field-cell">{field.label}</td>
                    {providers.map((pid) => {
                      const entry = matrix[pid]?.[field.id] || {
                        value: '\u2014',
                        notes: '',
                      };
                      const tone = toneForValue(entry.value);
                      return (
                        <td key={`${pid}-${field.id}`} className={`pc-cell pc-cell--${tone}`}>
                          <span className={`tp-chip tp-chip--${tone}`}>{entry.value}</span>
                          {entry.notes && <p className="tp-cell-note">{entry.notes}</p>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {seed.directiveCapabilityAlpha?.length > 0 && (
        <section className="tp-card pc-section">
          <h3>Directive Capability Matrix (Alpha)</h3>
          <p className="tp-hint">
            Mirrors plugin alpha directives so SEES and scoring architecture can validate provider-readiness against required data types.
          </p>
          <table className="tp-config-table">
            <thead>
              <tr>
                <th>Directive</th>
                <th>Status</th>
                <th>Required Data</th>
              </tr>
            </thead>
            <tbody>
              {seed.directiveCapabilityAlpha.map((d) => (
                <tr key={d.id}>
                  <td>{d.label}</td>
                  <td><span className="tp-chip tp-chip--warn">{d.status}</span></td>
                  <td>{Array.isArray(d.requiredData) ? d.requiredData.join(', ') : 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Broker Trading Platforms Matrix ── */}
      {seed.brokerPlatforms && (
        <section className="tp-card pc-section">
          <h2>🏦 Trading Brokers & Execution Platforms</h2>
          <p className="tp-hint">
            Comparison of connected trading accounts — MT5, Trading212 GIA, and Stocks ISA.
            Data sourced from broker documentation and live account testing.
          </p>

          {seed.brokerPlatforms.categories.map((cat) => (
            <div key={cat.id} className="pc-broker-category">
              <h3>{cat.title}</h3>
              <div className="pc-scroll-wrap">
                <table className="pc-table">
                  <thead>
                    <tr>
                      <th className="pc-sticky-col">Specification</th>
                      {seed.brokerPlatforms.providers.map((pid) => {
                        const labels = { mt5: '📡 MT5', trading212: '🏦 T212 GIA', isa: '🏛️ ISA' };
                        return <th key={pid} className="pc-provider-head">{labels[pid] || pid}</th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {cat.fields.map((field) => (
                      <tr key={field.id}>
                        <td className="pc-sticky-col pc-field-cell">{field.label}</td>
                        {seed.brokerPlatforms.providers.map((pid) => {
                          const value = seed.brokerPlatforms.data[pid]?.[field.id] || '\u2014';
                          const tone = toneForValue(value);
                          return (
                            <td key={`${pid}-${field.id}`} className={`pc-cell pc-cell--${tone}`}>
                              <span className="pc-broker-value">{value}</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
