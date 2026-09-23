/**
 * VariantSwitcher — Inline Old | New page-design toggle.
 * =======================================================
 * Shows "Old | New". New is the default; choosing Old adds `?variant=A`.
 *
 * ⚠️ NAMING (owner, 2026-09-23) — THIS IS NOT A/B TESTING.
 *
 * It was called `ABSwitcher` with `A` / `B` buttons, so **every search for "A/B" matched page
 * styling** — `ab-switcher`, `ab-btn`, `ABSwitcher`. In an app where the real A/B work is protocol
 * and strategy comparison, that noise is expensive.
 *
 * **"A/B" now means exactly ONE thing here: a LOCKED PAIR of protocols, or of strategies**
 * (`docs/SETTLED-DECISIONS.md` #23). A page design is a *variant*, and the two of them are
 * *Old* and *New*.
 *
 * The URL parameter deliberately stays `?variant=A`: several pages already read it
 * (`ProtocolsPage`, `SignalsOverviewPage`), and the string carries no "A/B" wording, so it does
 * not pollute a search. Renaming it would be churn with no search benefit.
 *
 * ⚠️ The labels stay WORDS ("Old" / "New") rather than letters on purpose. A letter needs a
 * legend to mean anything, and the previous pair required the reader to already know which of
 * A/B was the original — which is exactly the ambiguity this rename removes.
 */

import { useSearchParams } from 'react-router-dom';
import './variant-switcher.css';

export default function VariantSwitcher() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isOld = searchParams.get('variant') === 'A';
  const active = isOld ? 'old' : 'new';

  const toggle = (which) => {
    if (which === 'new') {
      searchParams.delete('variant');
    } else {
      searchParams.set('variant', 'A');
    }
    setSearchParams(searchParams, { replace: true });
  };

  return (
    <span className="variant-switcher" role="group" aria-label="Page design">
      <button
        type="button"
        className={`variant-btn ${active === 'old' ? 'variant-btn-active' : ''}`}
        onClick={() => toggle('old')}
        aria-pressed={active === 'old'}
        title="The previous page design"
      >
        Old
      </button>
      <button
        type="button"
        className={`variant-btn ${active === 'new' ? 'variant-btn-active' : ''}`}
        onClick={() => toggle('new')}
        aria-pressed={active === 'new'}
        title="The current page design (default)"
      >
        New
      </button>
    </span>
  );
}
