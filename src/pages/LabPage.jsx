import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';

/**
 * Lab Page — Top-level experimentation sandbox.
 *
 * Use this page for testing:
 *  - UI theming experiments (color schemes, typography, spacing)
 *  - Component prototypes and variations
 *  - New design concepts for existing pages
 *  - Animation and interaction ideas
 *  - Layout explorations
 *
 * Nothing here is production-bound. Break it, change it, delete it.
 */

// ── Mini component library for quick prototyping ──

function SwatchBox({ color, name }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          backgroundColor: color,
          border: '1px solid var(--color-border, #333)',
        }}
      />
      <code style={{ fontSize: 12 }}>{name}</code>
      <code style={{ fontSize: 11, opacity: 0.5 }}>{color}</code>
    </div>
  );
}

function PlaygroundBlock({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        border: '1px solid var(--color-border, #333)',
        borderRadius: 8,
        marginBottom: 16,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '10px 16px',
          background: 'var(--color-surface-raised, #1a1a2e)',
          border: 'none',
          color: 'var(--color-text, #e0e0e0)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        {open ? '▾' : '▸'} {title}
      </button>
      {open && <div style={{ padding: 16 }}>{children}</div>}
    </div>
  );
}

// ── Main Page ──

export default function LabPage() {
  const [counter, setCounter] = useState(0);
  const [text, setText] = useState('');
  const [themeIdea, setThemeIdea] = useState('');
  const [ideas, setIdeas] = useState([]);
  const [activeTab, setActiveTab] = useState('playground');
  const dropRef = useRef(null);
  const [dropMsg, setDropMsg] = useState('');

  const addIdea = useCallback(() => {
    if (!themeIdea.trim()) return;
    setIdeas((prev) => [
      { id: Date.now(), text: themeIdea, ts: new Date().toLocaleTimeString() },
      ...prev,
    ]);
    setThemeIdea('');
  }, [themeIdea]);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    setDropMsg(data ? `Dropped: "${data.slice(0, 50)}"` : 'Drop received (no data)');
  };

  // ── Theme token explorer ──
  const cssTokens = [
    { name: '--color-bg', value: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#0a0e17' },
    { name: '--color-surface', value: getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim() || '#111827' },
    { name: '--color-surface-raised', value: getComputedStyle(document.documentElement).getPropertyValue('--color-surface-raised').trim() || '#1a2332' },
    { name: '--color-text', value: getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim() || '#e0e0e0' },
    { name: '--color-text-muted', value: getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted').trim() || '#8892b0' },
    { name: '--color-accent', value: getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#5b8def' },
    { name: '--color-accent-2', value: getComputedStyle(document.documentElement).getPropertyValue('--color-accent-2').trim() || '#00d9ff' },
    { name: '--color-danger', value: getComputedStyle(document.documentElement).getPropertyValue('--color-danger').trim() || '#ff4d6a' },
    { name: '--color-success', value: getComputedStyle(document.documentElement).getPropertyValue('--color-success').trim() || '#00c896' },
    { name: '--color-warning', value: getComputedStyle(document.documentElement).getPropertyValue('--color-warning').trim() || '#ffb347' },
    { name: '--color-border', value: getComputedStyle(document.documentElement).getPropertyValue('--color-border').trim() || '#1e2d45' },
    { name: '--radius-sm', value: getComputedStyle(document.documentElement).getPropertyValue('--radius-sm').trim() || '4px' },
    { name: '--radius-md', value: getComputedStyle(document.documentElement).getPropertyValue('--radius-md').trim() || '6px' },
    { name: '--radius-lg', value: getComputedStyle(document.documentElement).getPropertyValue('--radius-lg').trim() || '12px' },
    { name: '--font-mono', value: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace' },
  ];

  const tabs = [
    { id: 'playground', label: '🧪 Playground' },
    { id: 'tokens', label: '🎨 Theme Tokens' },
    { id: 'ideas', label: '💡 Idea Board' },
    { id: 'dragdrop', label: '↔ Drag & Drop' },
  ];

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 64px' }}>
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h1 style={{ margin: 0, fontSize: 28 }}>
          🔬 Lab Sandbox
        </h1>
        <p style={{ color: 'var(--color-text-muted, #8892b0)', marginTop: 8 }}>
          A safe space for experimentation — UI theming, component prototypes, and design explorations.
        </p>
      </motion.div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, marginTop: 24, borderBottom: '1px solid var(--color-border, #333)' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 20px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--color-accent, #5b8def)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--color-accent, #5b8def)' : 'var(--color-text-muted, #8892b0)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 14,
              fontWeight: activeTab === tab.id ? 600 : 400,
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          style={{ marginTop: 24 }}
        >
          {activeTab === 'playground' && (
            <div>
              <PlaygroundBlock title="Counter (state test)">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setCounter((c) => c - 1)}
                    style={{
                      padding: '8px 16px',
                      background: 'var(--color-surface-raised, #1a2332)',
                      border: '1px solid var(--color-border, #333)',
                      borderRadius: 'var(--radius-md, 6px)',
                      color: 'var(--color-text, #e0e0e0)',
                      cursor: 'pointer',
                      fontSize: 18,
                    }}
                  >
                    −
                  </button>
                  <motion.span
                    key={counter}
                    initial={{ scale: 1.4 }}
                    animate={{ scale: 1 }}
                    style={{ fontSize: 24, fontWeight: 700, minWidth: 40, textAlign: 'center' }}
                  >
                    {counter}
                  </motion.span>
                  <button
                    type="button"
                    onClick={() => setCounter((c) => c + 1)}
                    style={{
                      padding: '8px 16px',
                      background: 'var(--color-accent, #5b8def)',
                      border: 'none',
                      borderRadius: 'var(--radius-md, 6px)',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 18,
                    }}
                  >
                    +
                  </button>
                </div>
              </PlaygroundBlock>

              <PlaygroundBlock title="Motion hover card">
                <motion.div
                  whileHover={{ scale: 1.03, boxShadow: '0 0 20px rgba(91,141,239,0.3)' }}
                  whileTap={{ scale: 0.97 }}
                  style={{
                    padding: 24,
                    background: 'var(--color-surface, #111827)',
                    borderRadius: 'var(--radius-lg, 12px)',
                    border: '1px solid var(--color-border, #333)',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <h3 style={{ margin: 0 }}>Hover &amp; tap me</h3>
                  <p style={{ margin: '8px 0 0', color: 'var(--color-text-muted, #8892b0)', fontSize: 13 }}>
                    Uses <code>whileHover</code> and <code>whileTap</code> from Motion.
                  </p>
                </motion.div>
              </PlaygroundBlock>

              <PlaygroundBlock title="Text input binding">
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Type something..."
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    background: 'var(--color-surface, #111827)',
                    border: '1px solid var(--color-border, #333)',
                    borderRadius: 'var(--radius-md, 6px)',
                    color: 'var(--color-text, #e0e0e0)',
                    fontFamily: 'inherit',
                    fontSize: 14,
                    boxSizing: 'border-box',
                  }}
                />
                {text && (
                  <p style={{ marginTop: 8, fontSize: 13, color: 'var(--color-text-muted, #8892b0)' }}>
                    Live: <strong>{text}</strong> ({text.length} chars)
                  </p>
                )}
              </PlaygroundBlock>

              <PlaygroundBlock title="Button variants">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {['Primary', 'Secondary', 'Danger', 'Ghost'].map((variant) => {
                    const styleMap = {
                      Primary: { background: 'var(--color-accent, #5b8def)', color: '#fff', border: 'none' },
                      Secondary: { background: 'var(--color-surface-raised, #1a2332)', color: 'var(--color-text, #e0e0e0)', border: '1px solid var(--color-border, #333)' },
                      Danger: { background: 'var(--color-danger, #ff4d6a)', color: '#fff', border: 'none' },
                      Ghost: { background: 'transparent', color: 'var(--color-text-muted, #8892b0)', border: '1px solid transparent' },
                    };
                    return (
                      <button
                        key={variant}
                        type="button"
                        style={{
                          padding: '8px 18px',
                          borderRadius: 'var(--radius-md, 6px)',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: 13,
                          fontWeight: 500,
                          ...styleMap[variant],
                        }}
                      >
                        {variant}
                      </button>
                    );
                  })}
                </div>
              </PlaygroundBlock>

              <PlaygroundBlock title="Notification badges">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Success', color: 'var(--color-success, #00c896)' },
                    { label: 'Warning', color: 'var(--color-warning, #ffb347)' },
                    { label: 'Error', color: 'var(--color-danger, #ff4d6a)' },
                    { label: 'Info', color: 'var(--color-accent, #5b8def)' },
                    { label: 'Neutral', color: 'var(--color-text-muted, #8892b0)' },
                  ].map((b) => (
                    <span
                      key={b.label}
                      style={{
                        display: 'inline-block',
                        padding: '4px 12px',
                        borderRadius: 99,
                        background: b.color + '22',
                        color: b.color,
                        border: `1px solid ${b.color}44`,
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      {b.label}
                    </span>
                  ))}
                </div>
              </PlaygroundBlock>
            </div>
          )}

          {activeTab === 'tokens' && (
            <div>
              <p style={{ color: 'var(--color-text-muted, #8892b0)', fontSize: 13 }}>
                Live CSS custom property values from the active theme pack.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, marginTop: 12 }}>
                {cssTokens.map((t) => (
                  <div
                    key={t.name}
                    style={{
                      padding: '10px 14px',
                      background: 'var(--color-surface, #111827)',
                      borderRadius: 'var(--radius-md, 6px)',
                      border: '1px solid var(--color-border, #333)',
                    }}
                  >
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted, #8892b0)', marginBottom: 4 }}>{t.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {t.name.startsWith('--color') && (
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            backgroundColor: t.value,
                            border: '1px solid var(--color-border, #333)',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <code style={{ fontSize: 12 }}>{t.value || '(unset)'}</code>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'ideas' && (
            <div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={themeIdea}
                  onChange={(e) => setThemeIdea(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addIdea()}
                  placeholder="Jot down a theme / component / design idea..."
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    background: 'var(--color-surface, #111827)',
                    border: '1px solid var(--color-border, #333)',
                    borderRadius: 'var(--radius-md, 6px)',
                    color: 'var(--color-text, #e0e0e0)',
                    fontFamily: 'inherit',
                    fontSize: 14,
                  }}
                />
                <button
                  type="button"
                  onClick={addIdea}
                  style={{
                    padding: '10px 20px',
                    background: 'var(--color-accent, #5b8def)',
                    border: 'none',
                    borderRadius: 'var(--radius-md, 6px)',
                    color: '#fff',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 14,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                  }}
                >
                  + Add
                </button>
              </div>

              {ideas.length === 0 && (
                <p style={{ color: 'var(--color-text-muted, #8892b0)', fontSize: 13, marginTop: 16 }}>
                  No ideas yet. Start brainstorming!
                </p>
              )}

              <div style={{ marginTop: 12 }}>
                <AnimatePresence>
                  {ideas.map((idea) => (
                    <motion.div
                      key={idea.id}
                      initial={{ opacity: 0, x: -20, height: 0 }}
                      animate={{ opacity: 1, x: 0, height: 'auto' }}
                      exit={{ opacity: 0, x: 20, height: 0 }}
                      transition={{ duration: 0.25 }}
                      style={{
                        padding: '10px 14px',
                        background: 'var(--color-surface, #111827)',
                        borderRadius: 'var(--radius-md, 6px)',
                        border: '1px solid var(--color-border, #333)',
                        marginBottom: 8,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        overflow: 'hidden',
                      }}
                    >
                      <span style={{ fontSize: 13 }}>{idea.text}</span>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted, #8892b0)' }}>{idea.ts}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {activeTab === 'dragdrop' && (
            <div>
              <p style={{ color: 'var(--color-text-muted, #8892b0)', fontSize: 13 }}>
                Drag text from anywhere onto the drop zone below.
              </p>
              <div
                ref={dropRef}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                style={{
                  padding: 40,
                  border: '2px dashed var(--color-border, #333)',
                  borderRadius: 'var(--radius-lg, 12px)',
                  textAlign: 'center',
                  color: 'var(--color-text-muted, #8892b0)',
                  transition: 'border-color 0.15s',
                  marginTop: 8,
                  background: dropMsg ? 'var(--color-surface-raised, #1a2332)' : 'transparent',
                }}
              >
                {dropMsg || 'Drop something here'}
              </div>
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted, #8892b0)' }}>
                  Try dragging selected text from this sentence onto the zone above.
                </p>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
