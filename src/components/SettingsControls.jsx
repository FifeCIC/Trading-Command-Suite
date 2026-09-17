/**
 * SettingsControls — the shared primitives every Settings page is built from.
 *
 * WHY THIS EXISTS (2026-09-16)
 * ----------------------------
 * Settings used to be ONE page (`src/pages/SettingsPage.jsx`) holding 13 unrelated
 * sections. That page grew the way such pages always grow: the control lived only there,
 * so the cheapest way to add a setting was to append a section — which is how "Database"
 * and "QA Testing" ended up filed beside "Trade Thresholds". Issue #617 asked for a
 * settings audit and a deliberate information architecture.
 *
 * The split (General / Appearance / Trading / Automation / Scoring) only survives if the
 * markup is cheap to reuse. Before this module, each of the 13 sections hand-wrote the
 * same `setting-row` / `setting-info` / `setting-control` triad and the same On/Off button
 * pair — ~8 copies of the toggle alone. A second copy of a shared primitive is the most
 * expensive kind of debt: both drift and only one gets the next fix.
 *
 * A new settings page now imports these three primitives plus `./settings.css` and looks
 * like every other settings page for free.
 *
 * ⚠️ `TogglePair` renders TWO buttons (On / Off) rather than a checkbox, deliberately.
 *   - The existing pages are built on button pairs; swapping in a checkbox would be a
 *     silent behaviour drift across ~8 controls at once.
 *   - The accessibility policy wants a ~44px target, which a button gives and a bare
 *     `<input type="checkbox">` does not.
 *   - Two buttons make the CURRENT state the pressed one, so the state is readable
 *     without inferring it from a checkmark's presence.
 *
 * ⚠️ `SettingRow` renders `hint` as `<p>` inside `.setting-info`, which is why hints read
 *   as explanatory prose rather than a tooltip: on 2026-09-10 the app stopped trading
 *   because a threshold was invisible, and the fix was to make the numbers and the reason
 *   for them visible on the page (see the Trade Thresholds docstring). Hints that only
 *   appear on hover would put that back.
 */

/**
 * SettingRow — one label + hint + control row.
 *
 * @param {string} label  the setting name (rendered as <strong>)
 * @param {string} [hint] explanatory text; plain string or JSX
 * @param {node} children the control itself (input, buttons, <code>, …)
 */
export function SettingRow({ label, children, hint }) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <strong>{label}</strong>
        {hint && <p>{hint}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

/**
 * SettingsSection — a titled block of SettingRows.
 *
 * `id` is load-bearing: it is the anchor that `?section=<id>` deep links scroll to, which
 * is how the market tape's ⚙ button lands the user ON the tape controls rather than at the
 * top of a long page. Renaming an id silently breaks that link, so keep them stable.
 */
export function SettingsSection({ id, title, desc, children }) {
  return (
    <section className="settings-section" id={id}>
      <h2>{title}</h2>
      {desc && <p className="settings-section-desc">{desc}</p>}
      {children}
    </section>
  );
}

/**
 * TogglePair — On / Off button pair. The active state is the pressed one.
 *
 * @param {boolean} value
 * @param {(next: boolean) => void} onChange
 * @param {string} [onLabel='On']   label for the true state (e.g. '◉ Show')
 * @param {string} [offLabel='Off'] label for the false state (e.g. '✕ Hide')
 */
export function TogglePair({ value, onChange, onLabel = 'On', offLabel = 'Off' }) {
  return (
    <div className="inline-actions">
      <button type="button" className={value ? 'cta' : ''} onClick={() => onChange(true)}>
        {onLabel}
      </button>
      <button type="button" className={!value ? 'cta' : ''} onClick={() => onChange(false)}>
        {offLabel}
      </button>
    </div>
  );
}

/**
 * MovedNote — tells the reader where a control went.
 *
 * ⚠️ Deliberately kept. When controls move between pages, the user's memory of "it was on
 * General" is the only index they have. Removing a section with no trace turns a
 * reorganise into a disappearance, and the next report is "the setting is gone" — which
 * costs more to answer than this one line costs to render.
 */
export function MovedNote({ children }) {
  return <p className="settings-hint-text">➡ {children}</p>;
}
