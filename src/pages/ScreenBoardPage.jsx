/**
 * ScreenBoardPage — /dashboard/screen?board=<id>
 * =============================================
 * The **screen window** view: one board, full-bleed, on one monitor. This is
 * what the cockpit opens on each detected display.
 *
 * Lives under the `dashboard` area on purpose: `AppShell` treats every
 * dashboard route as full-bleed (no breadcrumb, no section nav), so a screen
 * window gets the whole monitor without a shell-specific flag being added.
 *
 * The board id comes from `?board=`; an unknown or missing id falls back to the
 * cockpit board, which is always safe because `defaultWidgetsFor()` returns the
 * shipped dashboard set for it.
 *
 * The rendered content is the ordinary `WidgetBoard`, so anything you can
 * arrange on the Dashboard can be shown on a second monitor — the same board
 * document, synced live between windows via `subscribeBoard`'s storage listener.
 *
 * ⚠️ The BroadcastChannel handshake is what lets the cockpit know this window is
 * alive. Without it the cockpit would have to guess from its own window refs,
 * which it loses on reload while the screen windows keep running.
 */
import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import WidgetBoard from '../components/WidgetBoard';
import { boardLabel, defaultWidgetsFor } from '../core/board-defaults';
import { SCREEN_CHANNEL } from '../core/screen-profiles';

export default function ScreenBoardPage() {
  const [params] = useSearchParams();
  const boardId = useMemo(() => params.get('board') || 'dashboard', [params]);

  // Identify this window to the cockpit by its window name — that name encodes
  // the screen key the cockpit used to open it, so the two sides agree on
  // identity without either having to pass state through the URL.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const name = window.name || '';
    const key = name.startsWith('tcs-screen-') ? name.slice('tcs-screen-'.length) : name;
    const channel = new BroadcastChannel(SCREEN_CHANNEL);

    const announce = () => channel.postMessage({ type: 'screen-alive', key });
    channel.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'cockpit-ping') announce();
      if (data.type === 'cockpit-close-all') window.close();
    };
    announce();
    window.addEventListener('beforeunload', () => {
      channel.postMessage({ type: 'screen-closed', key });
    });

    return () => channel.close();
  }, []);

  return (
    <div className="dash-page">
      <WidgetBoard
        boardId={boardId}
        title={`${boardLabel(boardId)} — screen view`}
        defaultWidgets={defaultWidgetsFor(boardId)}
      />
    </div>
  );
}
