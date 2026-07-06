import { useState, useRef, useCallback, useEffect } from 'react';
import './DetachableWidget.css';

/**
 * DetachableWidget — A resizable, detachable panel shell for the command dashboard.
 *
 * Features:
 *  - Drag-to-reorder via handle (emits onDragStart / onDrop for parent grid)
 *  - Detach into a floating overlay (popout)
 *  - Minimize/restore toggle
 *  - Configurable size presets (sm, md, lg, full)
 *  - Footer slot for inline controls
 *
 * Usage:
 *   <DetachableWidget title="Market Ticker" size="md" onDetach={fn}>
 *     <YourContent />
 *   </DetachableWidget>
 */

const SIZE_MAP = {
  sm: { w: 280, h: 200 },
  md: { w: 360, h: 280 },
  lg: { w: 480, h: 360 },
  full: { w: 640, h: 480 },
};

export default function DetachableWidget({
  title = 'Widget',
  subtitle,
  size = 'md',
  colorAccent,
  actions,
  onDetach,
  onClose,
  onDragStart,
  onDrop,
  draggable = true,
  detachable = true,
  minimizable = true,
  closable = false,
  defaultMinimized = false,
  statusDot,
  badge,
  children,
  footer,
  className = '',
  contentScale = 1,
}) {
  const [minimized, setMinimized] = useState(defaultMinimized);
  const [detached, setDetached] = useState(false);
  const [floatingPos, setFloatingPos] = useState(null);
  const [floatingSize, setFloatingSize] = useState(null);
  const floatingRef = useRef(null);
  const floatingPosRef = useRef(null);
  const floatingSizeRef = useRef(null);
  const dragRef = useRef(null);  // { startX, startY, startPosX, startPosY, startW, startH, mode }

  // Keep refs in sync with state
  floatingPosRef.current = floatingPos;
  floatingSizeRef.current = floatingSize;

  const preset = SIZE_MAP[size] || SIZE_MAP.md;

  // ── Detach ───────────────────────────────────────────────
  const handleDetach = useCallback(() => {
    const rect = floatingRef.current?.getBoundingClientRect?.();
    setFloatingPos({
      x: rect ? rect.left : window.innerWidth / 2 - preset.w / 2,
      y: rect ? rect.top : 120,
    });
    setFloatingSize({ w: preset.w, h: preset.h });
    setDetached(true);
    onDetach?.();
  }, [onDetach, preset]);

  const handleReattach = useCallback(() => {
    setDetached(false);
    setFloatingPos(null);
  }, []);

  // ── Native drag via useEffect ──────────────────────────
  useEffect(() => {
    if (!detached) return;

    // Wait for DOM to render the floating elements
    const raf = requestAnimationFrame(() => {
      const titlebar = document.querySelector('.dw-floating-titlebar');
      const resizeHandle = document.querySelector('.dw-resize-handle');

      if (!titlebar) return;

      // ── Titlebar drag (move) ──────────────────────────
      const onTitlebarDown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const pos = floatingPosRef.current || { x: 200, y: 120 };
        dragRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          startPosX: pos.x,
          startPosY: pos.y,
          mode: 'move',
        };
      };

      titlebar.addEventListener('mousedown', onTitlebarDown);

      // ── Resize handle ──────────────────────────────────
      let onResizeDown = null;
      if (resizeHandle) {
        onResizeDown = (e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.preventDefault();
          const pos = floatingPosRef.current || { x: 200, y: 120 };
          const sz = floatingSizeRef.current || preset;
          dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startPosX: pos.x,
            startPosY: pos.y,
            startW: sz.w,
            startH: sz.h,
            mode: 'resize',
          };
        };
        resizeHandle.addEventListener('mousedown', onResizeDown);
      }

      // ── Global move / up (on window for reliable capture) ─
      const onWindowMove = (e) => {
        const ds = dragRef.current;
        if (!ds) return;

        if (ds.mode === 'move') {
          const nx = Math.max(0, ds.startPosX + (e.clientX - ds.startX));
          const ny = Math.max(0, ds.startPosY + (e.clientY - ds.startY));
          floatingPosRef.current = { x: nx, y: ny };
          setFloatingPos({ x: nx, y: ny });
        } else if (ds.mode === 'resize') {
          const nw = Math.max(240, ds.startW + (e.clientX - ds.startX));
          const nh = Math.max(160, ds.startH + (e.clientY - ds.startY));
          floatingSizeRef.current = { w: nw, h: nh };
          setFloatingSize({ w: nw, h: nh });
        }
      };

      const onWindowUp = () => {
        dragRef.current = null;
      };

      window.addEventListener('mousemove', onWindowMove);
      window.addEventListener('mouseup', onWindowUp);

      // ── Cleanup ────────────────────────────────────────
      return () => {
        titlebar.removeEventListener('mousedown', onTitlebarDown);
        if (resizeHandle && onResizeDown) {
          resizeHandle.removeEventListener('mousedown', onResizeDown);
        }
        window.removeEventListener('mousemove', onWindowMove);
        window.removeEventListener('mouseup', onWindowUp);
      };
    });

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [detached, preset]);

  // ── Keyboard close ───────────────────────────────────────
  useEffect(() => {
    if (!detached) return;
    const onKey = (e) => {
      if (e.key === 'Escape') handleReattach();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detached, handleReattach]);

  // ── Title bar ────────────────────────────────────────────
  const titleBar = (
    <div
      className={`dw-titlebar ${draggable ? 'dw-draggable' : ''}`}
      onMouseDown={draggable && !detached ? onDragStart : undefined}
    >
      <div className="dw-titlebar-left">
        {draggable && !detached && <span className="dw-grip">⠿</span>}
        {statusDot !== undefined && (
          <span className={`dw-status ${statusDot ? 'dw-status-on' : 'dw-status-off'}`} />
        )}
        <span className="dw-title">{title}</span>
        {subtitle && <span className="dw-subtitle">{subtitle}</span>}
        {badge && <span className="dw-badge">{badge}</span>}
      </div>
      <div className="dw-titlebar-right">
        {actions}
        {minimizable && (
          <button
            type="button"
            className="dw-btn-icon"
            title={minimized ? 'Expand' : 'Minimize'}
            onClick={() => setMinimized(!minimized)}
          >
            {minimized ? '□' : '−'}
          </button>
        )}
        {detachable && !detached && (
          <button
            type="button"
            className="dw-btn-icon"
            title="Detach"
            onClick={handleDetach}
          >
            ⤢
          </button>
        )}
        {closable && (
          <button
            type="button"
            className="dw-btn-icon dw-btn-close"
            title="Close"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );

  // ── Inline rendering ─────────────────────────────────────
  const scaleStyle = contentScale !== 1
    ? { '--dw-scale': contentScale, minHeight: `${200 * contentScale}px` }
    : {};
  const widgetBody = (
    <div
      className={`dw-widget ${minimized ? 'dw-minimized' : ''} ${className}`}
      style={colorAccent ? { borderLeftColor: colorAccent, ...scaleStyle } : scaleStyle}
      ref={floatingRef}
      data-size={size}
    >
      {titleBar}
      {!minimized && (
        <>
          <div className="dw-body">{children}</div>
          {footer && <div className="dw-footer">{footer}</div>}
        </>
      )}
    </div>
  );

  // ── Detached overlay ─────────────────────────────────────
  if (detached) {
    const pos = floatingPos || { x: 200, y: 120 };
    const sz = floatingSize || { w: preset.w, h: preset.h };

    return (
      <div className="dw-overlay" onMouseDown={(e) => {
        // Only reattach on direct backdrop click (not during drag)
        if (e.target === e.currentTarget && !dragRef.current) {
          handleReattach();
        }
      }}>
        <div
          className="dw-floating"
          style={{
            left: pos.x,
            top: pos.y,
            width: sz.w,
            minHeight: sz.h,
          }}
        >
          {/* Floating title bar */}
          <div
            className="dw-titlebar dw-floating-titlebar"
            style={{ touchAction: 'none' }}
          >
            <div className="dw-titlebar-left">
              <span className="dw-grip">⠿</span>
              {statusDot !== undefined && (
                <span className={`dw-status ${statusDot ? 'dw-status-on' : 'dw-status-off'}`} />
              )}
              <span className="dw-title">{title}</span>
              {subtitle && <span className="dw-subtitle">{subtitle}</span>}
              {badge && <span className="dw-badge">{badge}</span>}
            </div>
            <div className="dw-titlebar-right">
              {actions}
              {minimizable && (
                <button
                  type="button"
                  className="dw-btn-icon"
                  title={minimized ? 'Expand' : 'Minimize'}
                  onClick={() => setMinimized(!minimized)}
                >
                  {minimized ? '□' : '−'}
                </button>
              )}
              <button
                type="button"
                className="dw-btn-icon"
                title="Reattach"
                onClick={handleReattach}
              >
                ⤡
              </button>
              {closable && (
                <button
                  type="button"
                  className="dw-btn-icon dw-btn-close"
                  title="Close"
                  onClick={() => { setDetached(false); onClose?.(); }}
                >
                  ×
                </button>
              )}
            </div>
          </div>
          {!minimized && (
            <>
              <div className="dw-body dw-floating-body" style={{ minHeight: sz.h - 70 }}>
                {children}
              </div>
              {footer && <div className="dw-footer">{footer}</div>}
            </>
          )}
          {/* Resize handle */}
          <div
            className="dw-resize-handle"
            style={{ touchAction: 'none' }}
          />
        </div>
      </div>
    );
  }

  return widgetBody;
}
