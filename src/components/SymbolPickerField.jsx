/**
 * SymbolPickerField — a symbol search box whose selection is written to `?symbol=` in the URL.
 *
 * WHY THIS EXISTS (2026-10-06, INV-NO-NEW-DUPLICATION)
 * --------------------------------------------------------------------------------------------
 * `SinglesMonitorPage` and `ProtocolTrailPage` both grew from the same owner request ("the page is
 * reachable only by URL — add a symbol search"), and both solved it by wrapping `SymbolAutocomplete`
 * in a byte-identical 12-line block. `validate-duplication.cjs` caught the pair growing 27 → 39 and
 * failed the build.
 *
 * ⚠️ The irony is in their own comments: each one says *"Reused, not rebuilt"* — and then rebuilt
 * the wrapper. Reusing `SymbolAutocomplete` is not the same as reusing the BEHAVIOUR around it, and
 * the behaviour is the part that has to stay identical: two copies would drift, and only one would
 * get the next fix (which is the argument this repo makes about every second implementation).
 *
 * WHAT IS SHARED, AND WHAT IS NOT: the block below is the shared part verbatim. The `16rem` width,
 * the first-ticker-wins parse, the URL write and the placeholder are all identical in both callers.
 * Each page keeps its OWN explanatory comment and its own empty-state hint — those are page history,
 * not shared behaviour, and they were never duplicated.
 *
 * WHY IT WRITES THE URL RATHER THAN LOCAL STATE: a chosen symbol stays deep-linkable and shareable.
 * `useSearchParams` is called HERE rather than passed in, so a caller cannot accidentally write to
 * a different parameter or forget to preserve the existing ones.
 */
import { useSearchParams } from 'react-router-dom';
import SymbolAutocomplete from './SymbolAutocomplete';

export default function SymbolPickerField({ value = '', placeholder = 'Search a symbol…' }) {
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <div style={{ minWidth: '16rem' }}>
      <SymbolAutocomplete
        value={value}
        onChange={(v) => {
          // ⚠️ FIRST TICKER ONLY, and this is load-bearing. `SymbolAutocomplete` is a MULTI-symbol
          // input by design (the watchlist forms use it that way), so a comma-separated string is a
          // normal thing for it to hand back. These two pages are single-symbol views, and the old
          // inline copies already took the first — kept here so both callers keep that behaviour.
          const first = String(v || '').split(/[,\s]+/).filter(Boolean)[0];
          if (!first) return;
          const next = new URLSearchParams(searchParams);
          next.set('symbol', first.toUpperCase());
          setSearchParams(next);
        }}
        placeholder={placeholder}
      />
    </div>
  );
}
