import { useMemo } from 'react';
import { useUiStore } from '../stores/useUiStore';
import { findTaggedElements } from '../dev-runtime/tags';

export default function DevOverlay() {
  const open = useUiStore((state) => state.devOverlayOpen);
  const close = useUiStore((state) => state.closeDevOverlay);

  const tags = useMemo(() => {
    if (!open) {
      return [];
    }

    return findTaggedElements();
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <aside className="dev-overlay" role="dialog" aria-label="Developer Runtime Overlay">
      <div className="dev-overlay-head">
        <h2>Developer Runtime</h2>
        <button type="button" onClick={close}>Close</button>
      </div>
      <p className="muted">Tagged elements discovered at runtime.</p>
      <ul className="dev-tag-list">
        {tags.map((item, index) => (
          <li key={`${item.tag}-${index}`}>
            <strong>{item.tag}</strong>
            <span>{item.meta}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
