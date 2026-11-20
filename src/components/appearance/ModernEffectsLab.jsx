/**
 * ModernEffectsLab — an ORIGINAL, token-driven "play lab" of modern CSS effects for the Appearance area.
 *
 * ⚠️ WHY THIS EXISTS. Owner, 2026-11-20: *"overall it's dull and boring … Go ahead and work on the
 * Appearance area. Please consider adding some animation and dynamic lighting effects to see what fun
 * we can inject into the UI. Think modern and make use of the browser's latest technologies."*
 *
 * ⚠️ ORIGINALITY IS NON-NEGOTIABLE. The owner linked several commercial themes for INSPIRATION. Ideas
 * are not owned — a spotlit card, an aurora gradient, a glowing border are fair to build. Their CSS,
 * markup, assets and class names are NOT, and none are copied here. Every effect below is written
 * against THIS app's tokens, so a theme-pack switch repaints it and it cannot drift from the real
 * components.
 *
 * ⚠️ MODERN, BUT HONEST. Each effect is either a token-based gradient, a pointer-driven custom property,
 * or an `@property`-animated angle — all plain CSS. The only JS is the pointer position, written
 * straight to a CSS variable (no React state, no re-render).
 *
 * ⚠️ ACCESSIBILITY (WCAG 2.2 AA). Text never sits on the moving glow: the aurora is a decorative frame
 * around a solid inner card. Every animation is disabled under `prefers-reduced-motion`. Colour never
 * carries meaning alone (tiles pair an icon with a label). Interactive controls are ≥ 40px tall.
 *
 * Nothing here is wired into app pages yet — it is a specimen to judge and then adopt, exactly what the
 * Appearance area is for.
 */
import { useCallback } from 'react';
import { useUiStore } from '../../stores/useUiStore.js';
import styles from './ModernEffectsLab.module.css';

const TILES = [
  { icon: '⚡', label: 'Signals', value: '1,284', note: 'queued today' },
  { icon: '🎯', label: 'Hit rate', value: '62.4%', note: 'last 30 sessions' },
  { icon: '🛡', label: 'Risk', value: 'Low', note: '2 of 5 slots' },
  { icon: '⏱', label: 'Latency', value: '38ms', note: 'bridge p95' },
];

const CARDS = [
  { icon: '🌐', title: 'Network', text: 'Providers, bridges and latency in one calm surface.' },
  { icon: '🧭', title: 'Operations', text: 'Short labels, live figures, and one clear next action.' },
  { icon: '✨', title: 'Highlights', text: 'A border that lights up as you reach for it.' },
];

const TONES = [
  { id: 'aurora', label: 'Aurora', hint: 'Accent-lit gradient that follows the active pack' },
  { id: 'aura', label: 'Aura', hint: 'The classic single-corner glow' },
  { id: 'slate', label: 'Slate', hint: 'A quiet linear wash' },
  { id: 'black', label: 'Off', hint: 'Plain background — the most readable' },
];

export default function ModernEffectsLab() {
  const backgroundTone = useUiStore((s) => s.backgroundTone);
  const setBackgroundTone = useUiStore((s) => s.setBackgroundTone);

  // Write the pointer position straight to the tile's CSS variables. No state, so no re-render on move.
  const spotlight = useCallback((e) => {
    const el = e.currentTarget;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, []);

  return (
    <section className="appearance-section">
      <h3>Modern effects — a play lab</h3>
      <p className="appearance-note">
        Original effects built from this app&rsquo;s tokens — no images, no libraries, no copied styles.
        Every animation stops under &ldquo;reduce motion&rdquo;, and nothing here is wired into app pages
        yet: judge it, then we adopt what earns its place.
      </p>

      {/* ── Aurora hero: decorative light frame around a solid, readable card ── */}
      <div className={styles.hero}>
        <div className={styles.aurora} aria-hidden="true" />
        <div className={styles.heroBody}>
          <p className={styles.eyebrow}>Dynamic lighting</p>
          <p className={styles.heroTitle}>Gradients drawn from the theme, in motion.</p>
          <p className={styles.heroText}>
            The glow behind this card is three accent-derived radial gradients drifting slowly. The text
            sits on a solid surface, so contrast never depends on where the light happens to be.
          </p>
        </div>
      </div>

      {/* ── Pointer spotlight tiles ── */}
      <div className={styles.tiles}>
        {TILES.map((t) => (
          <div key={t.label} className={styles.tile} onPointerMove={spotlight}>
            <span className={styles.tileIcon} aria-hidden="true">{t.icon}</span>
            <span className={styles.tileLabel}>{t.label}</span>
            <span className={styles.tileValue}>{t.value}</span>
            <span className={styles.tileNote}>{t.note}</span>
          </div>
        ))}
      </div>
      <p className={styles.caption}>Move the pointer over the tiles — a soft spotlight follows it.</p>

      {/* ── Highlight cards with an animated conic border ── */}
      <div className={styles.cards}>
        {CARDS.map((c) => (
          <article key={c.title} className={styles.glowCard}>
            <span className={styles.cardIcon} aria-hidden="true">{c.icon}</span>
            <h4 className={styles.cardTitle}>{c.title}</h4>
            <p className={styles.cardText}>{c.text}</p>
          </article>
        ))}
      </div>
      <p className={styles.caption}>Hover a card — the border lights and travels around it.</p>

      {/* ── Rounded container scale — the "generous radius" the owner asked for ── */}
      <div className={styles.radiusRow} role="img" aria-label="Container corner radii: subtle, medium, generous">
        <span className={`${styles.radiusChip} ${styles.rSubtle}`}>subtle</span>
        <span className={`${styles.radiusChip} ${styles.rMedium}`}>medium</span>
        <span className={`${styles.radiusChip} ${styles.rGenerous}`}>generous</span>
      </div>

      {/* ── Colour-on-background toggle (reuses the app's existing background-tone setting) ── */}
      <div className={styles.bgControl}>
        <div className={styles.bgControlHead}>
          <span className={styles.bgControlLabel}>Colour-tinted background</span>
          <span className={styles.bgControlState}>
            {backgroundTone === 'black' ? 'off' : backgroundTone}
          </span>
        </div>
        <p className={styles.bgControlHint}>
          A tinted page background makes containers stand out. This is the same setting the shell uses —
          switching it here and in Settings stays in step.
        </p>
        <div className={styles.bgButtons} role="group" aria-label="Background tone">
          {TONES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`${styles.bgBtn}${backgroundTone === t.id ? ` ${styles.bgBtnActive}` : ''}`}
              aria-pressed={backgroundTone === t.id}
              title={t.hint}
              onClick={() => setBackgroundTone(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
