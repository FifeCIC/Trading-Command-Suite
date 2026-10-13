/**
 * ThemePacksChooser — the one place a theme pack is selected.
 * ===========================================================
 * ⚠️ THIS COMPONENT EXISTS SO THERE IS ONE CONTROL, NOT THREE (2026-10-13, owner request).
 * Pack selection was previously duplicated: a `Theme Pack` rail-block in the shell, a `Preview`
 * cards rail-block beside it, and a Theme Packs page with its own gallery. Three surfaces, one
 * setting — the classic drift setup where two of them get a fix and the third silently does not.
 * The rail copies were removed and the Theme Packs page is being retired; this is the survivor.
 *
 * ⚠️ CARD PRESENTATION IS THE OWNER'S CHOICE, and it is not decoration: *"I would like theme pack
 * selection to be like <article.theme-section-card.neon-lab-card> — Corner-only accents, full colored
 * outlines."* A pack is a COLOUR decision, so a swatch grid lets the choice be made by looking rather
 * than by reading a token name. It also makes an important limit visible at a glance: every card shows
 * exactly three colours, because a pack carries colours and nothing else.
 *
 * ⚠️ A PACK MUST NOT CHANGE STRUCTURE. This component therefore offers no spacing, size or layout
 * option — those are not theme properties. The counter-example is documented in App.jsx: the deleted
 * `ai-original` pack carried ~80 structural overrides, so the app's geometry depended on the colour
 * scheme that happened to be active.
 */
import { useUiStore } from '../stores/useUiStore';
// ⚠️ From the shared module, NOT from App.jsx — App.jsx imports THIS component, so importing the
// list back from App.jsx would be a cycle, and a cycle here resolves to `undefined` (a blank chooser
// with no error). See the note at the top of src/core/theme-cards.js.
import { THEME_CARDS } from '../core/theme-cards';

export default function ThemePacksChooser() {
  const themePack = useUiStore((state) => state.themePack);
  const setThemePack = useUiStore((state) => state.setThemePack);

  return (
    <div className="tp-grid">
      {THEME_CARDS.map((card) => {
        const active = themePack === card.id;
        return (
          <article
            key={card.id}
            className={`theme-section-card neon-lab-card${active ? ' is-active' : ''}`}
            data-pack={card.id}
          >
            {/* The swatch IS the information: the three colours the pack sets. */}
            <div className="tp-swatch" aria-hidden="true">
              <span className="tp-swatch-bg" style={{ background: card.colors[0] }} />
              <span className="tp-swatch-accent" style={{ background: card.colors[1] }} />
              <span className="tp-swatch-line" style={{ background: card.colors[2] }} />
            </div>
            <div className="tp-body">
              <h4 className="tp-name">{card.name}</h4>
              <p className="tp-desc">{card.description}</p>
              <div className="tp-bars" aria-hidden="true">
                {card.colors.map((c) => (
                  <span key={c} className="tp-bar" style={{ background: c }} title={c} />
                ))}
              </div>
            </div>
            <button
              type="button"
              className={`tp-choose${active ? ' is-active' : ''}`}
              aria-pressed={active}
              onClick={() => setThemePack(card.id)}
            >
              {active ? 'Selected' : 'Use this pack'}
            </button>
          </article>
        );
      })}
    </div>
  );
}
