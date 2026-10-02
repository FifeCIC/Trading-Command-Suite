import { motion, AnimatePresence } from 'motion/react';
import { useState } from 'react';
import '../pages/theme-lab.css';
import PageInfoPopover from '../components/PageInfoPopover';

// ── Hook-owning demos, extracted as COMPONENTS ──────────────────────────────
//
// ⚠️ WHY THESE ARE SEPARATE COMPONENTS AND NOT `render:` CALLBACKS IN `demos`.
//
// The demo table below is invoked as `demo.render(...)` inside a `.map()` in the
// page body. That makes each `render` a PLAIN FUNCTION CALL during another
// component's render — not a component of its own. React only permits hooks in a
// component or a custom hook, so `useState` inside a `render:` callback violated
// the Rules of Hooks (`react-hooks/rules-of-hooks`, 2 occurrences here).
//
// It happened to appear to work because the hook slot was read during an
// enclosing render, but it is not safe: the state belongs to whichever component
// happened to be rendering, so it is shared between both stateful demos and is
// torn down by any parent re-render. Extracting them into real components gives
// each its own hook slot, which is what the demo intends.
//
// Adding a hook-using demo in future: add a component here and reference it from
// `demos`, do NOT inline `useState` in a `render:` callback.

/** AnimatePresence add/remove — owns its own list state. */
function AnimatePresenceDemo() {
  const [items, setItems] = useState(['AAPL', 'NVDA', 'TSLA']);
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
        <AnimatePresence>
          {items.map((s) => (
            <motion.div key={s} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 50 }}
              transition={{ duration: 0.25 }}
              style={{ padding: '0.4rem 0.65rem', background: 'var(--panel)', borderRadius: 6, border: '1px solid var(--line)', fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between' }}>
              {s} <button onClick={() => setItems(items.filter((i) => i !== s))} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>×</button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <button onClick={() => setItems([...items, 'AMD'])} className="tl-demo-btn" style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--ink-soft)', cursor: 'pointer' }}>+ Add AMD</button>
    </div>
  );
}

/** Real-world accordion chevron — owns its own open state. */
function AccordionChevronDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: 'var(--ink)', cursor: 'pointer', fontSize: '0.82rem', padding: '0.4rem 0' }}>
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.2 }}
          style={{ display: 'inline-block', fontSize: '0.75rem' }}
        >
          ▸
        </motion.span>
        {open ? '▾' : '▸'} Section Title
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: 'hidden', paddingLeft: '1.2rem' }}
          >
            <p style={{ margin: '0.4rem 0', fontSize: '0.78rem', color: 'var(--ink-soft)', padding: '0.5rem', background: 'var(--panel)', borderRadius: 6, border: '1px solid var(--line)' }}>
              This accordion pattern is used across the Architecture Framework page and Settings panels.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const demos = [
  {
    title: 'Fade In',
    code: '<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>',
    render: (key) => (
      <motion.div key={key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
        style={{ padding: '1rem', background: 'var(--panel)', borderRadius: 8, border: '1px solid var(--line)' }}>
        ✅ Faded in
      </motion.div>
    ),
  },
  {
    title: 'Slide Up',
    code: '<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>',
    render: (key) => (
      <motion.div key={key} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        style={{ padding: '1rem', background: 'var(--panel)', borderRadius: 8, border: '1px solid var(--line)' }}>
        📈 Slide up + fade
      </motion.div>
    ),
  },
  {
    title: 'Scale Bounce',
    code: '<motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.97 }}>',
    render: (key) => (
      <motion.div key={key} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.97 }} transition={{ type: 'spring', stiffness: 400 }}
        style={{ padding: '1rem', background: 'var(--accent)', color: '#fff', borderRadius: 8, cursor: 'pointer', textAlign: 'center' }}>
        🎯 Hover / tap me
      </motion.div>
    ),
  },
  {
    title: 'List Stagger',
    code: '<motion.li variants={...} initial="hidden" animate="show" staggerChildren={0.1}>',
    render: (key) => {
      const list = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
      const item = { hidden: { opacity: 0, x: -10 }, show: { opacity: 1, x: 0 } };
      return (
        <motion.ul key={key} variants={list} initial="hidden" animate="show" style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMD'].map((s) => (
            <motion.li key={s} variants={item} style={{ padding: '0.4rem 0.65rem', background: 'var(--panel)', borderRadius: 6, border: '1px solid var(--line)', fontSize: '0.82rem' }}>{s}</motion.li>
          ))}
        </motion.ul>
      );
    },
  },
  {
    title: 'AnimatePresence (add/remove)',
    code: '<AnimatePresence>\n  {items.map(i => <motion.div exit={{ opacity: 0, x: -50 }}>)}',
    // Component (owns its own useState) — see the note above AnimatePresenceDemo.
    render: () => <AnimatePresenceDemo />,
  },
  {
    title: 'Real-World: Accordion Chevron',
    code: '<motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2 }}>',
    // Component (owns its own useState) — see the note above AnimatePresenceDemo.
    render: () => <AccordionChevronDemo />,
  },
];

/**
 * MotionLabSection — the Motion Lab's examples, rendered INSIDE Theme Lab.
 *
 * ⚠️ This was `ThemeLabMotion`, a PAGE at /development/theme-lab-motion until 2026-10-01. The owner
 * deleted that view and said "add motion examples to the theme-lab page". So this exports a SECTION:
 * no `tl-page` wrapper and no `<h1>` — the host page owns the heading. The file is still imported by
 * ThemeLabPage.jsx, which is why scripts/delete-views.cjs kept it rather than deleting it with the view.
 */
export default function MotionLabSection() {
  const [key, setKey] = useState(0);
  return (
    <section className="tl-section">
      <h2>Motion Lab
        <PageInfoPopover>
          motion.dev — 3.5KB animation library. Fade, slide, scale, stagger, AnimatePresence.
        Status: ✅ Accepted for micro-interactions. Keep under 300ms, prefer GPU-friendly properties.
        </PageInfoPopover>
      </h2>

      <button onClick={() => setKey((k) => k + 1)} className="tl-demo-btn" style={{ marginBottom: '1rem', padding: '0.4rem 0.85rem', fontSize: '0.78rem', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--ink-soft)', cursor: 'pointer' }}>
        ⟳ Replay All
      </button>

      <div className="tl-lab-grid">
        {demos.map((demo) => (
          <div key={demo.title} className="tl-demo-card" style={{ padding: '1rem', background: 'rgba(0,0,0,0.1)', border: '1px solid var(--line)', borderRadius: 10 }}>
            <h3 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>{demo.title}</h3>
            <div style={{ marginBottom: '0.5rem', minHeight: 40 }}>{demo.render(key + demo.title)}</div>
            <pre style={{ fontSize: '0.65rem', color: 'var(--ink-soft)', background: 'rgba(0,0,0,0.2)', padding: '0.4rem 0.5rem', borderRadius: 6, overflow: 'auto', margin: 0 }}>{demo.code}</pre>
          </div>
        ))}
      </div>
    </section>
  );
}
