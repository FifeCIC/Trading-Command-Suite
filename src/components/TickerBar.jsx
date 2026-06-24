import { useEffect, useRef, useState, useCallback } from 'react';
import { useTickerStore } from '../stores/useTickerStore';

const ICON_MAP = {
  sees: '◈',
  trading: '◆',
  alert: '▲',
  system: '●',
};

const SOURCE_LABEL = {
  sees: 'SEES Scoring',
  trading: 'Trading',
  alert: 'Alert',
  system: 'System',
};

const MIN_LIFE_MS = 5000;

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

export default function TickerBar() {
  const queue = useTickerStore((s) => s.queue);
  const index = useTickerStore((s) => s.index);
  const advance = useTickerStore((s) => s.advance);
  const [visible, setVisible] = useState(false);
  const [displayed, setDisplayed] = useState(null);
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef(null);
  const mountedRef = useRef(false);
  const hoverRef = useRef(null);

  const current = queue.length > 0 && index >= 0 && index < queue.length
    ? queue[index]
    : null;

  // Rotate every MIN_LIFE_MS (paused while hovering)
  useEffect(() => {
    if (!current) {
      setVisible(false);
      return;
    }

    if (mountedRef.current && displayed && displayed.id !== current.id) {
      setVisible(false);
      const swapTimer = setTimeout(() => {
        setDisplayed(current);
        setVisible(true);
      }, 300);
      return () => clearTimeout(swapTimer);
    }

    if (!mountedRef.current || !displayed) {
      setDisplayed(current);
      requestAnimationFrame(() => setVisible(true));
    }

    mountedRef.current = true;

    if (timerRef.current) clearTimeout(timerRef.current);
    if (!hovered) {
      timerRef.current = setTimeout(() => {
        advance();
      }, MIN_LIFE_MS);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [current?.id, hovered]);

  // Resume rotation when hover ends
  const handleMouseLeave = useCallback(() => {
    setHovered(false);
  }, []);

  const handleMouseEnter = useCallback(() => {
    setHovered(true);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!displayed) {
    return (
      <div className="ticker-bar ticker-bar--empty">
        <span className="ticker-icon">●</span>
        <span className="ticker-msg muted">Waiting for events…</span>
      </div>
    );
  }

  const icon = ICON_MAP[displayed.source] || '●';

  // Build recent-history list (skip current, take up to 4 prior)
  const recent = queue.filter((e) => e.id !== displayed.id).slice(0, 4);

  return (
    <div
      className={`ticker-bar ${visible ? 'ticker-visible' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      ref={hoverRef}
    >
      <span className={`ticker-icon ticker-src-${displayed.source}`}>{icon}</span>
      <span className="ticker-msg">{displayed.message}</span>

      {/* Hover popup */}
      <div className="ticker-popup">
        <div className="ticker-popup-header">
          <span className={`ticker-popup-dot ticker-src-${displayed.source}`} />
          <span className="ticker-popup-source">{SOURCE_LABEL[displayed.source] || displayed.source}</span>
          <span className="ticker-popup-time">{timeAgo(displayed.timestamp)}</span>
        </div>
        <p className="ticker-popup-body">{displayed.message}</p>
        {recent.length > 0 && (
          <div className="ticker-popup-history">
            <span className="ticker-popup-history-label">Recent</span>
            {recent.map((e) => (
              <div key={e.id} className="ticker-popup-row">
                <span className={`ticker-icon ticker-src-${e.source}`}>{ICON_MAP[e.source] || '●'}</span>
                <span className="ticker-popup-row-msg">{e.message}</span>
                <span className="ticker-popup-row-time">{timeAgo(e.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
