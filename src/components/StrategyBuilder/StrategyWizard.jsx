import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../core/api/client';
import './strategy-wizard.css';

const STEPS = [
  { id: 1, label: 'Template' },
  { id: 2, label: 'Symbols' },
  { id: 3, label: 'Timeframe' },
  { id: 4, label: 'Directives' },
  { id: 5, label: 'Allocation' },
  { id: 6, label: 'Review' },
];

const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
const TIMEZONES = ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Australia/Sydney', 'Europe/Berlin', 'UTC'];
const QUICK_SYMBOL_GROUPS = [
  { id: 'tech', label: 'All Tech', symbols: ['AAPL', 'NVDA', 'MSFT', 'AMD', 'INTC', 'META', 'GOOGL', 'AMZN'] },
  { id: 'crypto', label: 'All Crypto', symbols: ['BTCUSD', 'ETHUSD', 'SOLUSD', 'DOGEUSD'] },
  { id: 'forex', label: 'All Forex', symbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'] },
];

// ── Draft persistence ──
const DRAFT_KEY = 'strategy-wizard-draft';

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { return null; }
}
function saveDraft(state) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch { /* noop */ }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
}

export default function StrategyWizard() {
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);

  // ── Step 1 state ──
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [startFresh, setStartFresh] = useState(false);

  // ── Step 2 state ──
  const [selectedSymbols, setSelectedSymbols] = useState([]);

  // ── Step 3 state ──
  const [timeframe, setTimeframe] = useState('H1');
  const [timezone, setTimezone] = useState('America/New_York');
  const [tradingStart, setTradingStart] = useState('09:00');
  const [tradingEnd, setTradingEnd] = useState('16:30');

  // ── Step 4 state ──
  const [directiveWeights, setDirectiveWeights] = useState({});
  const [excludedDirectives, setExcludedDirectives] = useState([]);
  const [expandedDirective, setExpandedDirective] = useState(null);

  // ── Step 5 state ──
  const [allocation, setAllocation] = useState('');

  // ── Step 6 state ──
  const [strategyName, setStrategyName] = useState('');
  const [saved, setSaved] = useState(false);

  // ── Data ──
  const templatesQuery = useQuery({
    queryKey: ['strategy-templates'],
    queryFn: () => apiGet('/api/strategies/saved'),
    staleTime: 60_000,
  });
  const templates = templatesQuery.data?.strategies || [];

  const directivesQuery = useQuery({
    queryKey: ['directives'],
    queryFn: () => apiGet('/api/directives'),
    staleTime: 60_000,
  });
  const allDirectives = directivesQuery.data || [];

  const activeSymbolsQuery = useQuery({
    queryKey: ['active-symbols'],
    queryFn: () => apiGet('/api/symbols/active'),
    staleTime: 60_000,
  });
  const activeSymbols = activeSymbolsQuery.data || [];

  // ── Load draft on mount ──
  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setStep(draft.step || 1);
      setSelectedTemplate(draft.selectedTemplate || null);
      setStartFresh(draft.startFresh || false);
      setSelectedSymbols(draft.selectedSymbols || []);
      setTimeframe(draft.timeframe || 'H1');
      setTimezone(draft.timezone || 'America/New_York');
      setTradingStart(draft.tradingStart || '09:00');
      setTradingEnd(draft.tradingEnd || '16:30');
      setDirectiveWeights(draft.directiveWeights || {});
      setExcludedDirectives(draft.excludedDirectives || []);
      setAllocation(draft.allocation || '');
      setStrategyName(draft.strategyName || '');
    }
  }, []);

  // ── Auto-save draft ──
  useEffect(() => {
    saveDraft({ step, selectedTemplate, startFresh, selectedSymbols, timeframe, timezone, tradingStart, tradingEnd, directiveWeights, excludedDirectives, allocation, strategyName });
  });

  // ── Derive template directives ──
  const templateDirectiveIds = selectedTemplate && !startFresh
    ? (selectedTemplate.directives || []).map((d) => (typeof d === 'string' ? d : d.id))
    : [];

  const templateDirectiveMeta = templateDirectiveIds
    .map((id) => allDirectives.find((d) => d.id === id))
    .filter(Boolean);

  // ── Default weights from template ──
  const defaultWeights = {};
  if (selectedTemplate && !startFresh) {
    (selectedTemplate.directives || []).forEach((d) => {
      if (typeof d === 'object') defaultWeights[d.id] = d.weight || 10;
      else defaultWeights[d] = 10;
    });
  }

  // ── Active directives (not excluded) ──
  const activeDirectives = templateDirectiveMeta.filter((d) => !excludedDirectives.includes(d.id));
  const hasTimeGated = activeDirectives.some((d) => d.activeWindow);

  // ── Save mutation ──
  const saveMutation = useMutation({
    mutationFn: () => apiPost('/api/strategies', {
      name: strategyName || selectedTemplate?.name || 'Wizard Strategy',
      description: selectedTemplate?.description || '',
      symbolFocus: selectedSymbols,
      timeframe,
      timezone,
      tradingHours: `${tradingStart}-${tradingEnd}`,
      directives: activeDirectives.map((d) => ({
        id: d.id,
        weight: directiveWeights[d.id] ?? defaultWeights[d.id] ?? 10,
      })),
      allocation: allocation || null,
    }),
    onSuccess: () => {
      setSaved(true);
      clearDraft();
    },
  });

  // ── Navigation ──
  const goNext = useCallback(() => {
    setDirection(1);
    setStep((s) => Math.min(6, s + 1));
  }, []);
  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => Math.max(1, s - 1));
  }, []);

  // ── Step 2 helpers ──
  function toggleSymbol(sym) {
    setSelectedSymbols((prev) => prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]);
  }
  function addSymbolGroup(groupId) {
    const group = QUICK_SYMBOL_GROUPS.find((g) => g.id === groupId);
    if (!group) return;
    setSelectedSymbols((prev) => [...new Set([...prev, ...group.symbols])]);
  }

  // ── Step 4 helpers ──
  function setWeight(id, w) {
    setDirectiveWeights((prev) => ({ ...prev, [id]: w }));
  }
  function toggleExclude(id) {
    setExcludedDirectives((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }
  function resetToDefault(id) {
    setDirectiveWeights((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }
  function isCustomised(id) {
    return directiveWeights[id] !== undefined && directiveWeights[id] !== (defaultWeights[id] || 10);
  }

  // ── Animation variants ──
  const slideVariants = {
    enter: (d) => ({ x: d > 0 ? 60 : -60, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d) => ({ x: d > 0 ? -60 : 60, opacity: 0 }),
  };

  return (
    <div className="sw-wizard">
      {/* Progress bar */}
      <div className="sw-progress">
        {STEPS.map((s) => (
          <div key={s.id} className={`sw-progress-step ${s.id === step ? 'active' : ''} ${s.id < step ? 'done' : ''}`}>
            <span className="sw-progress-dot">{s.id < step ? '✓' : s.id}</span>
            <span className="sw-progress-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="sw-content">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25 }}
            className="sw-step-body"
          >
            {/* ── Step 1: Pick Template ── */}
            {step === 1 && (
              <div>
                <h2>Step 1: Choose a Starting Point</h2>
                <p className="sw-desc">Pick a template or start from scratch.</p>

                <button
                  type="button"
                  className={`sw-template-card ${startFresh ? 'sw-selected' : ''}`}
                  onClick={() => { setStartFresh(true); setSelectedTemplate(null); }}
                >
                  <strong>✦ Start from Scratch</strong>
                  <span>No pre-selected directives. Build your strategy one directive at a time.</span>
                </button>

                {templatesQuery.isLoading && <p style={{ color: 'var(--ink-soft)', fontSize: 13 }}>Loading templates...</p>}

                <div className="sw-template-grid">
                  {(startFresh ? [] : templates).map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      className={`sw-template-card ${selectedTemplate?.id === tpl.id ? 'sw-selected' : ''}`}
                      onClick={() => { setSelectedTemplate(tpl); setStartFresh(false); setStrategyName(tpl.name || ''); }}
                    >
                      <strong>{tpl.name || 'Untitled'}</strong>
                      <span>{tpl.description?.slice(0, 80) || 'No description'}</span>
                      <div className="sw-template-meta">
                        <span>{(tpl.symbolFocus || []).length || 0} symbols</span>
                        <span>{(tpl.directives || []).length} directives</span>
                        {tpl.timeframe && <span>{tpl.timeframe}</span>}
                      </div>
                      {selectedTemplate?.id === tpl.id && <span className="sw-check">✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Step 2: Select Symbols ── */}
            {step === 2 && (
              <div>
                <h2>Step 2: Select Symbols</h2>
                <p className="sw-desc">Choose which symbols this strategy will monitor.</p>

                <div className="sw-quick-groups">
                  {QUICK_SYMBOL_GROUPS.map((g) => (
                    <button key={g.id} type="button" className="sw-quick-btn" onClick={() => addSymbolGroup(g.id)}>
                      + {g.label}
                    </button>
                  ))}
                  <button type="button" className="sw-quick-btn sw-quick-clear" onClick={() => setSelectedSymbols([])}>
                    Clear All
                  </button>
                </div>

                <p className="sw-count">{selectedSymbols.length} symbol{selectedSymbols.length !== 1 ? 's' : ''} selected</p>

                <div className="sw-symbol-grid">
                  {(selectedTemplate?.symbolFocus || activeSymbols.length > 0
                    ? [...new Set([...(selectedTemplate?.symbolFocus || []), ...activeSymbols.map((s) => s.symbol || s.ticker || s)])]
                    : ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMD', 'SPY', 'QQQ', 'EURUSD', 'BTCUSD']
                  ).map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      className={`sw-symbol-chip ${selectedSymbols.includes(sym) ? 'sw-symbol-selected' : ''}`}
                      onClick={() => toggleSymbol(sym)}
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Step 3: Timeframe & Hours ── */}
            {step === 3 && (
              <div>
                <h2>Step 3: Timeframe & Trading Hours</h2>
                <p className="sw-desc">Set when and at what interval this strategy runs.</p>

                <div className="sw-form-grid">
                  <label className="sw-field">
                    <span>Timeframe</span>
                    <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className="sw-select">
                      {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
                    </select>
                  </label>
                  <label className="sw-field">
                    <span>Timezone</span>
                    <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="sw-select">
                      {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>)}
                    </select>
                  </label>
                  <label className="sw-field">
                    <span>Start</span>
                    <input type="time" value={tradingStart} onChange={(e) => setTradingStart(e.target.value)} className="sw-input" />
                  </label>
                  <label className="sw-field">
                    <span>End</span>
                    <input type="time" value={tradingEnd} onChange={(e) => setTradingEnd(e.target.value)} className="sw-input" />
                  </label>
                </div>

                <div className="sw-preview">
                  <strong>Preview:</strong> This strategy will be active {tradingStart}–{tradingEnd} {timezone.replace('_', ' ')}, scoring on {timeframe} candles.
                </div>
              </div>
            )}

            {/* ── Step 4: Configure Directives ── */}
            {step === 4 && (
              <div>
                <h2>Step 4: Configure Directives</h2>
                <p className="sw-desc">
                  {templateDirectiveMeta.length} directive{templateDirectiveMeta.length !== 1 ? 's' : ''} from your template.
                  Adjust weights or exclude directives.
                </p>

                {templateDirectiveMeta.length === 0 && (
                  <p style={{ color: 'var(--ink-soft)', fontSize: 13, padding: '1rem', textAlign: 'center' }}>
                    No directives in this template. Go back and choose a template, or use the manual builder.
                  </p>
                )}

                <div className="sw-directive-list">
                  {templateDirectiveMeta.map((d) => {
                    const excluded = excludedDirectives.includes(d.id);
                    const customised = isCustomised(d.id);
                    const weight = directiveWeights[d.id] ?? defaultWeights[d.id] ?? 10;
                    const hasWindow = !!d.activeWindow;
                    const hasModifiers = !!(d.timeModifiers && d.timeModifiers.length > 0);
                    const expanded = expandedDirective === d.id;

                    return (
                      <div key={d.id} className={`sw-directive-card ${excluded ? 'sw-excluded' : ''} ${customised ? 'sw-customised' : ''}`}>
                        <div className="sw-directive-header">
                          <div className="sw-directive-info">
                            <strong>{d.name || d.label || d.id}</strong>
                            <span className="sw-directive-id">{d.id}</span>
                          </div>
                          <div className="sw-directive-badges">
                            {customised && <span className="sw-badge sw-badge-custom">Custom</span>}
                            {!customised && !excluded && <span className="sw-badge sw-badge-default">Default</span>}
                            {excluded && <span className="sw-badge sw-badge-excluded">Excluded</span>}
                          </div>
                        </div>

                        {d.description && <p className="sw-directive-desc">{d.description?.slice(0, 120)}</p>}

                        {/* Time-gated warning */}
                        {hasWindow && (
                          <div className="sw-warning">
                            ⚠️ This directive only scores during {d.activeWindow}
                          </div>
                        )}

                        {/* Time modifiers */}
                        {hasModifiers && (
                          <div className="sw-modifiers">
                            {d.timeModifiers.map((mod, i) => (
                              <span key={i} className="sw-modifier-chip">{mod.label || mod.type}: {mod.value || mod.adjustment}</span>
                            ))}
                          </div>
                        )}

                        {/* Weight slider */}
                        {!excluded && (
                          <div className="sw-weight-row">
                            <div className="sw-weight-header">
                              <span>Weight</span>
                              <span className="sw-weight-value">{weight}</span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={weight}
                              onChange={(e) => setWeight(d.id, Number(e.target.value))}
                              className="sw-slider"
                            />
                            <div className="sw-weight-labels">
                              <span>0</span>
                              <span className="sw-weight-default-marker" style={{ left: `${defaultWeights[d.id] || 10}%` }} title="Default weight">▼</span>
                              <span>100</span>
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="sw-directive-actions">
                          <button type="button" className="sw-action-btn" onClick={() => setExpandedDirective(expanded ? null : d.id)}>
                            {expanded ? '− Why this?' : '+ Why this directive?'}
                          </button>
                          {customised && (
                            <button type="button" className="sw-action-btn sw-action-reset" onClick={() => resetToDefault(d.id)}>
                              Reset to default
                            </button>
                          )}
                          <button type="button" className={`sw-action-btn ${excluded ? 'sw-action-include' : 'sw-action-exclude'}`} onClick={() => toggleExclude(d.id)}>
                            {excluded ? 'Include' : 'Exclude'}
                          </button>
                        </div>

                        {/* Expanded: why this directive */}
                        {expanded && (
                          <div className="sw-expanded">
                            <p>{d.description || d.longDescription || 'This directive contributes to the overall strategy score based on its category and weight.'}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Step 5: Allocation ── */}
            {step === 5 && (
              <div>
                <h2>Step 5: Risk & Allocation</h2>
                <p className="sw-desc">Set how much capital to allocate. Advanced risk settings coming in Q293.</p>

                <label className="sw-field" style={{ maxWidth: 300 }}>
                  <span>Allocate Amount (£)</span>
                  <input
                    type="number"
                    value={allocation}
                    onChange={(e) => setAllocation(e.target.value)}
                    placeholder="e.g. 5000"
                    className="sw-input"
                    min={0}
                  />
                </label>

                <div className="sw-note">
                  🔜 Advanced risk settings (position sizing, max drawdown, stop-loss integration) coming in Q293 — Auto Risk Sizing.
                </div>
              </div>
            )}

            {/* ── Step 6: Review ── */}
            {step === 6 && (
              <div>
                <h2>Step 6: Review & Create</h2>
                <p className="sw-desc">Review your strategy before creating it.</p>

                {saved ? (
                  <div className="sw-success">
                    <span>✅</span>
                    <strong>Strategy created successfully!</strong>
                    <p>It will appear in your Trading Strategies list.</p>
                  </div>
                ) : (
                  <>
                    <div className="sw-summary-card">
                      <label className="sw-field">
                        <span>Strategy Name</span>
                        <input
                          type="text"
                          value={strategyName}
                          onChange={(e) => setStrategyName(e.target.value)}
                          placeholder="My Strategy"
                          className="sw-input"
                        />
                      </label>

                      <div className="sw-summary-grid">
                        <div><span className="sw-summary-label">Template</span> <strong>{startFresh ? 'From Scratch' : selectedTemplate?.name || 'None'}</strong></div>
                        <div><span className="sw-summary-label">Symbols</span> <strong>{selectedSymbols.length}</strong></div>
                        <div><span className="sw-summary-label">Timeframe</span> <strong>{timeframe}</strong></div>
                        <div><span className="sw-summary-label">Trading Hours</span> <strong>{tradingStart}–{tradingEnd} {timezone.replace('_', ' ')}</strong></div>
                        <div><span className="sw-summary-label">Directives</span> <strong>{activeDirectives.length} active</strong></div>
                        <div><span className="sw-summary-label">Allocation</span> <strong>{allocation ? `£${allocation}` : 'Not set'}</strong></div>
                      </div>

                      {/* Warnings */}
                      {hasTimeGated && (
                        <div className="sw-warning" style={{ marginTop: 12 }}>
                          ⚠️ This strategy includes time-gated directives. They will only score during their configured time windows.
                        </div>
                      )}

                      {/* Directive summary */}
                      <details className="sw-summary-details" style={{ marginTop: 12 }}>
                        <summary>Directive weights ({activeDirectives.length})</summary>
                        <div className="sw-summary-directives">
                          {activeDirectives.map((d) => {
                            const w = directiveWeights[d.id] ?? defaultWeights[d.id] ?? 10;
                            const c = isCustomised(d.id);
                            return (
                              <div key={d.id} className="sw-summary-dir">
                                <span>{d.name || d.label || d.id}</span>
                                <span className="sw-summary-dir-weight">{w}{c ? ' (custom)' : ''}</span>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    </div>

                    <button
                      type="button"
                      className="sw-btn-create"
                      onClick={() => saveMutation.mutate()}
                      disabled={saveMutation.isPending || activeDirectives.length === 0}
                    >
                      {saveMutation.isPending ? 'Creating...' : '🚀 Create Strategy'}
                    </button>
                  </>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      {!saved && (
        <div className="sw-nav">
          {step > 1 && (
            <button type="button" className="sw-nav-btn sw-nav-back" onClick={goBack}>
              ← Back
            </button>
          )}
          <div style={{ flex: 1 }} />
          {step < 6 && (
            <button
              type="button"
              className="sw-nav-btn sw-nav-next"
              onClick={goNext}
              disabled={step === 1 && !startFresh && !selectedTemplate}
            >
              Next →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
